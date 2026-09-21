import { runAsTenant, prisma } from '../../../db/prisma.ts';
import { criteriaEvaluatorService } from './criteriaEvaluator.service.ts';
import { approverResolverService } from './approverResolver.service.ts';
import { approvalActionService } from './approvalAction.service.ts';
import { moduleMetadataService } from './moduleMetadata.service.ts';
import type {
  ApprovalRequestDetails,
  ApprovalActionInput,
} from './approvalProcess.types.ts';
import { ApiError } from '../../../lib/apiError.ts';

/** Maps known module codes / table names to canonical table names for record status updates */
const MODULE_TABLE_MAP: Record<string, string> = {
  purchase_orders: 'purchase_orders',
  purchase_order: 'purchase_orders',
  po: 'purchase_orders',
  bills: 'bills',
  bill: 'bills',
  job_orders: 'job_orders',
  job_order: 'job_orders',
  items: 'items',
  item: 'items',
  vendors: 'vendors',
  vendor: 'vendors',
  customers: 'customers',
  customer: 'customers',
  sales_orders: 'sales_orders',
  sales_order: 'sales_orders',
  invoices: 'invoices',
  invoice: 'invoices',
};

/** Status values to set on underlying records at each approval lifecycle event */
const APPROVAL_STATUS_PENDING = 'Pending Approval';
const APPROVAL_STATUS_APPROVED = 'Approved';
const APPROVAL_STATUS_REJECTED = 'Rejected';

export interface ApprovalRequestListItem {
  id: string;
  moduleId: string;
  moduleName: string;
  recordId: string;
  recordTitle: string;
  processId: string;
  processName: string;
  status: string;
  currentStageId: string | null;
  currentStageName?: string;
  currentStageOrder?: number;
  currentStageApprovers?: Array<{
    id: string;
    userId: string;
    fullName?: string;
    email: string;
    status: string;
  }>;
  requesterId: string | null;
  requesterName?: string;
  submittedAt: string;
  completedAt: string | null;
  isApproverForCurrentUser?: boolean;
}

export class ApprovalExecutionService {
  /**
   * Resolves all string representations (UUID, code, entity name, table name) for a given
   * module identifier so that approval_processes.module_id can be matched with ANY().
   */
  private async resolveAllModuleAliases(moduleId: string): Promise<string[]> {
    const normalized = moduleId.trim().toLowerCase();
    const aliases = new Set<string>();
    aliases.add(normalized);

    // Attempt to look up matching app_modules rows
    try {
      const appModules = await prisma.appModule.findMany({
        where: { isActive: true },
        select: { id: true, code: true, name: true },
      });

      // Module code variants of the incoming id
      const codeAliases: Record<string, string[]> = {
        purchase_orders: ['po', 'purchase_order', 'purchase_orders'],
        bills: ['bill', 'bills'],
        job_orders: ['job_order', 'job_orders'],
        items: ['item', 'items'],
        vendors: ['vendor', 'vendors'],
        customers: ['customer', 'customers'],
        sales_orders: ['sales_order', 'sales_orders'],
        invoices: ['invoice', 'invoices'],
        quotations: ['quotation', 'quotations'],
        item_assemblies: ['assembly', 'assemblies', 'item_assembly'],
        job_issues: ['job_issue', 'issues'],
        job_receipts: ['job_receipt', 'receipts'],
      };

      // Collect all variants to check
      const variantsToCheck = new Set<string>([normalized]);
      for (const [table, aliases_list] of Object.entries(codeAliases)) {
        if (aliases_list.includes(normalized) || table === normalized) {
          aliases_list.forEach((a) => variantsToCheck.add(a));
          variantsToCheck.add(table);
        }
      }

      for (const mod of appModules) {
        const modCode = mod.code.toLowerCase();
        const modName = mod.name.toLowerCase().replace(/\s+/g, '_');
        // Check if this app_module matches the incoming identifier
        if (
          modCode === normalized ||
          mod.id.toLowerCase() === normalized ||
          modName === normalized ||
          Array.from(variantsToCheck).some(
            (v) => v === modCode || v === mod.id.toLowerCase() || v === modName,
          )
        ) {
          aliases.add(mod.id.toLowerCase());
          aliases.add(modCode);
          aliases.add(modName);
          // Add table name if known
          const tableName = MODULE_TABLE_MAP[modCode] || MODULE_TABLE_MAP[modName];
          if (tableName) aliases.add(tableName);
        }
      }
    } catch (err) {
      console.error('[ApprovalExecutionService] Error resolving module aliases:', err);
    }

    // Also add known table-name variants for the incoming identifier
    const tableVariants = MODULE_TABLE_MAP[normalized];
    if (tableVariants) {
      aliases.add(tableVariants);
      // Add singular/plural
      if (!tableVariants.endsWith('s')) aliases.add(`${tableVariants}s`);
    }

    return Array.from(aliases);
  }

  /**
   * Updates the status column of the underlying CRM record when an approval lifecycle event occurs.
   * Silently fails so approval engine errors never block the parent operation.
   */
  private async updateRecordStatus(
    organizationId: string,
    moduleId: string,
    recordId: string,
    newStatus: string,
  ): Promise<void> {
    try {
      const normalized = moduleId.trim().toLowerCase();
      const tableName = MODULE_TABLE_MAP[normalized];
      if (!tableName) {
        // Try to infer via aliases
        const aliases = await this.resolveAllModuleAliases(normalized);
        const resolved = aliases.find((a) => MODULE_TABLE_MAP[a]);
        if (!resolved) return;
        const resolvedTable = MODULE_TABLE_MAP[resolved]!;
        await runAsTenant(organizationId, async (tx) => {
          await tx.$executeRawUnsafe(
            `UPDATE "${resolvedTable}" SET "status" = $1, "updated_at" = now() WHERE "id" = $2::uuid AND "organization_id" = $3::uuid`,
            newStatus,
            recordId,
            organizationId,
          );
        });
        return;
      }
      await runAsTenant(organizationId, async (tx) => {
        await tx.$executeRawUnsafe(
          `UPDATE "${tableName}" SET "status" = $1, "updated_at" = now() WHERE "id" = $2::uuid AND "organization_id" = $3::uuid`,
          newStatus,
          recordId,
          organizationId,
        );
      });
    } catch (err) {
      console.error(
        `[ApprovalExecutionService] Failed to update record status for ${moduleId}/${recordId}:`,
        err,
      );
    }
  }

  /**
   * Evaluates records on Create/Edit and triggers an approval process if criteria match.
   */
  async evaluateAndTriggerApproval(
    organizationId: string,
    moduleId: string,
    recordId: string,
    recordTitle: string,
    triggerType: 'CREATE' | 'EDIT',
    record: Record<string, unknown>,
    actorUserId?: string,
  ): Promise<{ triggered: boolean; requestId?: string }> {
    // Resolve all possible aliases for this module before opening the transaction
    const moduleAliases = await this.resolveAllModuleAliases(moduleId);

    return runAsTenant(organizationId, async (tx) => {
      const normalizedModule = moduleId.toLowerCase();

      // Find active approval processes for this module using any of its aliases
      const processes = await tx.$queryRaw<
        Array<{
          id: string;
          name: string;
          trigger_type: string;
          priority: number;
          current_version: number;
        }>
      >`
        SELECT "id", "name", "trigger_type", "priority", "current_version"
        FROM "approval_processes"
        WHERE "organization_id" = ${organizationId}::uuid
          AND "module_id" = ANY(${moduleAliases}::text[])
          AND "status" = 'ACTIVE'
          AND "is_deleted" = false
        ORDER BY "priority" ASC, "created_at" ASC
      `;

      if (processes.length === 0) {
        return { triggered: false };
      }

      // Check for already active approval request for this record to prevent duplicates
      const activeRequests = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "approval_requests"
        WHERE "organization_id" = ${organizationId}::uuid
          AND "module_id" = ANY(${moduleAliases}::text[])
          AND "record_id" = ${recordId}
          AND "status" IN ('PENDING', 'IN_PROGRESS')
        FOR UPDATE
      `;

      if (activeRequests.length > 0) {
        return { triggered: false, requestId: activeRequests[0]!.id };
      }

      // Load field metadata map for criteria evaluation
      const fields = await moduleMetadataService.getModuleFields(organizationId, normalizedModule);
      const fieldMap = new Map(fields.map((f) => [f.id, f]));

      for (const proc of processes) {
        // Match trigger type — DB stores CREATE_ONLY / EDIT_ONLY / CREATE_OR_EDIT
        const pTrigger = proc.trigger_type?.toUpperCase() || '';
        // CREATE_OR_EDIT (or legacy BOTH) always matches
        if (pTrigger !== 'CREATE_OR_EDIT' && pTrigger !== 'BOTH') {
          const isCreateOnly = pTrigger === 'CREATE_ONLY' || pTrigger === 'CREATE';
          const isEditOnly = pTrigger === 'EDIT_ONLY' || pTrigger === 'EDIT';
          if (triggerType === 'CREATE' && isEditOnly) continue;
          if (triggerType === 'EDIT' && isCreateOnly) continue;
        }

        // Fetch rules for process ordered by rule_order ASC
        const rules = await tx.$queryRaw<
          Array<{
            id: string;
            name: string;
            rule_order: number;
            criteria: any;
            criteria_pattern: string;
          }>
        >`
          SELECT "id", "name", "rule_order", "criteria", "criteria_pattern"
          FROM "approval_process_rules"
          WHERE "process_id" = ${proc.id}::uuid AND "is_deleted" = false
          ORDER BY "rule_order" ASC
        `;

        for (const rule of rules) {
          const criteriaObj = {
            conditions: typeof rule.criteria === 'string' ? JSON.parse(rule.criteria) : rule.criteria || [],
            pattern: rule.criteria_pattern || '',
          };

          const matched = criteriaEvaluatorService.evaluateCriteria(record, criteriaObj, fieldMap);
          if (!matched) continue;

          // Matched! Load stages for this rule
          const stages = await tx.$queryRaw<
            Array<{
              id: string;
              name: string;
              stage_order: number;
              approver_type: string;
              approver_config: any;
              approval_mode: string;
              assign_task_for_approvers: boolean;
              record_modification_config: any;
            }>
          >`
            SELECT "id", "name", "stage_order", "approver_type", "approver_config",
                   "approval_mode", "assign_task_for_approvers", "record_modification_config"
            FROM "approval_stages"
            WHERE "rule_id" = ${rule.id}::uuid AND "is_deleted" = false
            ORDER BY "stage_order" ASC
          `;

          if (stages.length === 0) continue;

          // Fetch latest version snapshot id
          const versionRows = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "approval_process_versions"
            WHERE "process_id" = ${proc.id}::uuid
            ORDER BY "version_number" DESC LIMIT 1
          `;
          const versionId = versionRows[0]?.id || null;

          // Insert immutable approval request instance
          const reqRows = await tx.$queryRaw<Array<{ id: string }>>`
            INSERT INTO "approval_requests" (
              "organization_id", "process_id", "process_version_id", "rule_id",
              "module_id", "record_id", "record_title", "record_snapshot",
              "status", "requester_id", "submitted_at"
            ) VALUES (
              ${organizationId}::uuid, ${proc.id}::uuid,
              ${versionId ? versionId : null}::uuid,
              ${rule.id}::uuid,
              ${normalizedModule}, ${recordId}, ${recordTitle},
              ${JSON.stringify(record)}::jsonb,
              'IN_PROGRESS',
              ${actorUserId ? actorUserId : null}::uuid,
              now()
            )
            RETURNING "id"
          `;

          const requestId = reqRows[0]!.id;

          // Create immutable request stages and resolve initial stage approvers
          let firstStageInstanceId: string | null = null;
          for (let i = 0; i < stages.length; i++) {
            const stg = stages[i]!;
            const stgRows = await tx.$queryRaw<Array<{ id: string }>>`
              INSERT INTO "approval_request_stages" (
                "organization_id", "request_id", "stage_id", "stage_order",
                "name", "status", "approval_mode", "started_at"
              ) VALUES (
                ${organizationId}::uuid, ${requestId}::uuid, ${stg.id}::uuid,
                ${stg.stage_order}, ${stg.name},
                ${i === 0 ? 'PENDING' : 'PENDING'},
                ${stg.approval_mode}, ${new Date()}
              )
              RETURNING "id"
            `;

            if (i === 0) {
              firstStageInstanceId = stgRows[0]!.id;
              // Set current stage on request
              await tx.$executeRaw`
                UPDATE "approval_requests"
                SET "current_stage_id" = ${stg.id}::uuid
                WHERE "id" = ${requestId}::uuid
              `;

              // Resolve concrete approver user IDs for Stage 1
              const config =
                typeof stg.approver_config === 'string'
                  ? JSON.parse(stg.approver_config)
                  : stg.approver_config || {};

              const resolvedApprovers = await approverResolverService.resolveApprovers(
                tx,
                organizationId,
                stg.approver_type as any,
                config,
                record,
                actorUserId,
              );

              for (const appr of resolvedApprovers) {
                await tx.$executeRaw`
                  INSERT INTO "approval_request_approvers" (
                    "organization_id", "request_stage_id", "user_id", "status"
                  ) VALUES (
                    ${organizationId}::uuid, ${firstStageInstanceId}::uuid,
                    ${appr.userId}::uuid, 'PENDING'
                  )
                `;
              }
            }
          }

          // Initial immutable audit history log
          await tx.$executeRaw`
            INSERT INTO "approval_history" (
              "organization_id", "request_id", "event_type", "actor_id",
              "previous_status", "new_status", "comment", "metadata"
            ) VALUES (
              ${organizationId}::uuid, ${requestId}::uuid, 'SUBMITTED',
              ${actorUserId ? actorUserId : null}::uuid,
              null, 'IN_PROGRESS',
              ${`Approval process "${proc.name}" triggered by Rule "${rule.name}".`},
              ${JSON.stringify({ processId: proc.id, ruleId: rule.id, priority: proc.priority })}::jsonb
            )
          `;

          // Update the underlying CRM record status to 'Pending Approval'
          await this.updateRecordStatus(organizationId, normalizedModule, recordId, APPROVAL_STATUS_PENDING);

          return { triggered: true, requestId };
        }
      }

      return { triggered: false };
    });
  }

  /**
   * Approver acts to approve the current stage.
   */
  async approveStage(
    organizationId: string,
    requestId: string,
    approverUserId: string,
    comment?: string,
    ipAddress?: string,
    _userAgent?: string,
  ): Promise<{ success: boolean; requestStatus: string }> {
    return runAsTenant(organizationId, async (tx) => {
      // Row-level lock on request
      const reqRows = await tx.$queryRaw<
        Array<{
          id: string;
          status: string;
          process_id: string;
          rule_id: string;
          module_id: string;
          record_id: string;
          record_title: string;
          record_snapshot: any;
          current_stage_id: string | null;
        }>
      >`
        SELECT "id", "status", "process_id", "rule_id", "module_id",
               "record_id", "record_title", "record_snapshot", "current_stage_id"
        FROM "approval_requests"
        WHERE "id" = ${requestId}::uuid AND "organization_id" = ${organizationId}::uuid
        FOR UPDATE
      `;

      const request = reqRows[0];
      if (!request) throw ApiError.notFound('Approval request not found.');
      if (request.status !== 'IN_PROGRESS' && request.status !== 'PENDING') {
        throw new ApiError(400, `Cannot approve a request with status ${request.status}.`);
      }

      // Find current stage instance
      const stageRows = await tx.$queryRaw<
        Array<{
          id: string;
          stage_id: string;
          stage_order: number;
          name: string;
          approval_mode: string;
          status: string;
        }>
      >`
        SELECT "id", "stage_id", "stage_order", "name", "approval_mode", "status"
        FROM "approval_request_stages"
        WHERE "request_id" = ${requestId}::uuid AND "stage_id" = ${request.current_stage_id}::uuid
        LIMIT 1
      `;

      const currentStageInstance = stageRows[0];
      if (!currentStageInstance) {
        throw new ApiError(400, 'Active approval stage instance not found.');
      }

      // Verify user is an approver or admin
      const approverRow = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT "id", "status" FROM "approval_request_approvers"
        WHERE "request_stage_id" = ${currentStageInstance.id}::uuid
          AND "user_id" = ${approverUserId}::uuid
      `;

      const adminRow = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "approval_process_admins"
        WHERE "process_id" = ${request.process_id}::uuid
          AND "user_id" = ${approverUserId}::uuid
      `;

      const isOwner = await tx.membership.findFirst({
        where: { organizationId, userId: approverUserId, isOwner: true, isDeleted: false },
      });

      if (approverRow.length === 0 && adminRow.length === 0 && !isOwner) {
        throw new ApiError(403, 'You are not authorized to approve this stage.');
      }

      // Update approver status
      if (approverRow.length > 0) {
        await tx.$executeRaw`
          UPDATE "approval_request_approvers"
          SET "status" = 'APPROVED',
              "action_taken_at" = now(),
              "comment" = ${comment || null}
          WHERE "id" = ${approverRow[0]!.id}::uuid
        `;
      }

      // Check if stage is satisfied based on approval_mode
      let stageCompleted = false;
      if (
        currentStageInstance.approval_mode === 'ANYONE' ||
        currentStageInstance.approval_mode === 'FIRST_RESPONSE' ||
        adminRow.length > 0 ||
        isOwner
      ) {
        stageCompleted = true;
      } else if (currentStageInstance.approval_mode === 'EVERYONE') {
        const remaining = await tx.$queryRaw<Array<{ count: number }>>`
          SELECT count(*)::int as "count" FROM "approval_request_approvers"
          WHERE "request_stage_id" = ${currentStageInstance.id}::uuid
            AND "status" = 'PENDING'
        `;
        stageCompleted = (remaining[0]?.count ?? 0) === 0;
      } else {
        stageCompleted = true;
      }

      // Log history
      await tx.$executeRaw`
        INSERT INTO "approval_history" (
          "organization_id", "request_id", "event_type", "actor_id",
          "previous_status", "new_status", "comment", "metadata"
        ) VALUES (
          ${organizationId}::uuid, ${requestId}::uuid, 'APPROVED',
          ${approverUserId}::uuid, 'IN_PROGRESS', 'IN_PROGRESS',
          ${comment || `Stage "${currentStageInstance.name}" approved.`},
          ${JSON.stringify({ stageId: currentStageInstance.stage_id, stageName: currentStageInstance.name, ip: ipAddress })}::jsonb
        )
      `;

      if (!stageCompleted) {
        return { success: true, requestStatus: 'IN_PROGRESS' };
      }

      // Stage completed! Mark stage APPROVED
      await tx.$executeRaw`
        UPDATE "approval_request_stages"
        SET "status" = 'APPROVED', "completed_at" = now()
        WHERE "id" = ${currentStageInstance.id}::uuid
      `;

      // Check for next stage
      const nextStageRows = await tx.$queryRaw<
        Array<{
          id: string;
          stage_id: string;
          stage_order: number;
          name: string;
          approval_mode: string;
        }>
      >`
        SELECT "id", "stage_id", "stage_order", "name", "approval_mode"
        FROM "approval_request_stages"
        WHERE "request_id" = ${requestId}::uuid
          AND "stage_order" > ${currentStageInstance.stage_order}
        ORDER BY "stage_order" ASC LIMIT 1
      `;

      const recordData =
        typeof request.record_snapshot === 'string'
          ? JSON.parse(request.record_snapshot)
          : request.record_snapshot || {};

      if (nextStageRows.length > 0) {
        // Move to next stage
        const nextStage = nextStageRows[0]!;
        await tx.$executeRaw`
          UPDATE "approval_requests"
          SET "current_stage_id" = ${nextStage.stage_id}::uuid
          WHERE "id" = ${requestId}::uuid
        `;

        // Fetch stage definition to resolve approvers
        const stageDef = await tx.$queryRaw<
          Array<{
            approver_type: string;
            approver_config: any;
          }>
        >`
          SELECT "approver_type", "approver_config"
          FROM "approval_stages"
          WHERE "id" = ${nextStage.stage_id}::uuid
        `;

        if (stageDef.length > 0) {
          const config =
            typeof stageDef[0]!.approver_config === 'string'
              ? JSON.parse(stageDef[0]!.approver_config)
              : stageDef[0]!.approver_config || {};

          const resolved = await approverResolverService.resolveApprovers(
            tx,
            organizationId,
            stageDef[0]!.approver_type as any,
            config,
            recordData,
          );

          for (const appr of resolved) {
            await tx.$executeRaw`
              INSERT INTO "approval_request_approvers" (
                "organization_id", "request_stage_id", "user_id", "status"
              ) VALUES (
                ${organizationId}::uuid, ${nextStage.id}::uuid,
                ${appr.userId}::uuid, 'PENDING'
              )
            `;
          }
        }

        await tx.$executeRaw`
          INSERT INTO "approval_history" (
            "organization_id", "request_id", "event_type", "actor_id",
            "previous_status", "new_status", "comment", "metadata"
          ) VALUES (
            ${organizationId}::uuid, ${requestId}::uuid, 'STAGE_STARTED',
            null, 'IN_PROGRESS', 'IN_PROGRESS',
            ${`Advanced to Stage "${nextStage.name}".`},
            ${JSON.stringify({ stageId: nextStage.stage_id, stageName: nextStage.name })}::jsonb
          )
        `;

        return { success: true, requestStatus: 'IN_PROGRESS' };
      } else {
        // Final stage approved! Mark request FINAL_APPROVED
        await tx.$executeRaw`
          UPDATE "approval_requests"
          SET "status" = 'FINAL_APPROVED', "completed_at" = now(), "current_stage_id" = null
          WHERE "id" = ${requestId}::uuid
        `;

        // Update the underlying CRM record status to 'Approved'
        await this.updateRecordStatus(organizationId, request.module_id, request.record_id, APPROVAL_STATUS_APPROVED);

        // Execute Final Actions
        const actions = await tx.$queryRaw<
          Array<{
            id: string;
            action_type: string;
            trigger_event: string;
            action_config: any;
          }>
        >`
          SELECT "id", "action_type", "trigger_event", "action_config"
          FROM "approval_actions"
          WHERE "rule_id" = ${request.rule_id}::uuid
            AND "trigger_event" = 'FINAL_APPROVAL'
            AND "is_deleted" = false
        `;

        const parsedActions: ApprovalActionInput[] = actions.map((a) => ({
          id: a.id,
          triggerEvent: 'FINAL_APPROVAL',
          actionType: a.action_type as any,
          actionConfig:
            typeof a.action_config === 'string'
              ? JSON.parse(a.action_config)
              : a.action_config || {},
        }));

        await approvalActionService.executeActions(
          tx,
          organizationId,
          requestId,
          parsedActions,
          recordData,
          'FINAL_APPROVAL',
          request.module_id,
          request.record_id,
          approverUserId,
        );

        await tx.$executeRaw`
          INSERT INTO "approval_history" (
            "organization_id", "request_id", "event_type", "actor_id",
            "previous_status", "new_status", "comment"
          ) VALUES (
            ${organizationId}::uuid, ${requestId}::uuid, 'ACTION_EXECUTED',
            ${approverUserId}::uuid, 'IN_PROGRESS', 'FINAL_APPROVED',
            'All stages completed. Final approval actions executed.'
          )
        `;

        return { success: true, requestStatus: 'FINAL_APPROVED' };
      }
    });
  }

  /**
   * Approver acts to reject the request.
   */
  async rejectRequest(
    organizationId: string,
    requestId: string,
    approverUserId: string,
    reason: string,
    ipAddress?: string,
    _userAgent?: string,
  ): Promise<{ success: boolean; requestStatus: string }> {
    return runAsTenant(organizationId, async (tx) => {
      const reqRows = await tx.$queryRaw<
        Array<{
          id: string;
          status: string;
          rule_id: string;
          module_id: string;
          record_id: string;
          record_title: string;
          record_snapshot: any;
          current_stage_id: string | null;
        }>
      >`
        SELECT "id", "status", "rule_id", "module_id", "record_id",
               "record_title", "record_snapshot", "current_stage_id"
        FROM "approval_requests"
        WHERE "id" = ${requestId}::uuid AND "organization_id" = ${organizationId}::uuid
        FOR UPDATE
      `;

      const request = reqRows[0];
      if (!request) throw ApiError.notFound('Approval request not found.');
      if (request.status !== 'IN_PROGRESS' && request.status !== 'PENDING') {
        throw new ApiError(400, `Cannot reject a request with status ${request.status}.`);
      }

      // Mark current stage REJECTED
      if (request.current_stage_id) {
        await tx.$executeRaw`
          UPDATE "approval_request_stages"
          SET "status" = 'REJECTED', "completed_at" = now()
          WHERE "request_id" = ${requestId}::uuid AND "stage_id" = ${request.current_stage_id}::uuid
        `;
      }

      // Mark request REJECTED
      await tx.$executeRaw`
        UPDATE "approval_requests"
        SET "status" = 'REJECTED', "completed_at" = now(), "current_stage_id" = null
        WHERE "id" = ${requestId}::uuid
      `;

      // Update the underlying CRM record status to 'Rejected'
      await this.updateRecordStatus(organizationId, request.module_id, request.record_id, APPROVAL_STATUS_REJECTED);

      // Log history
      await tx.$executeRaw`
        INSERT INTO "approval_history" (
          "organization_id", "request_id", "event_type", "actor_id",
          "previous_status", "new_status", "comment", "metadata"
        ) VALUES (
          ${organizationId}::uuid, ${requestId}::uuid, 'REJECTED',
          ${approverUserId}::uuid, ${request.status}, 'REJECTED',
          ${reason || 'Request was rejected.'},
          ${JSON.stringify({ reason, ip: ipAddress })}::jsonb
        )
      `;

      // Execute Rejection Actions
      const actions = await tx.$queryRaw<
        Array<{
          id: string;
          action_type: string;
          trigger_event: string;
          action_config: any;
        }>
      >`
        SELECT "id", "action_type", "trigger_event", "action_config"
        FROM "approval_actions"
        WHERE "rule_id" = ${request.rule_id}::uuid
          AND "trigger_event" = 'REJECTION'
          AND "is_deleted" = false
      `;

      const parsedActions: ApprovalActionInput[] = actions.map((a) => ({
        id: a.id,
        triggerEvent: 'REJECTION',
        actionType: a.action_type as any,
        actionConfig:
          typeof a.action_config === 'string'
            ? JSON.parse(a.action_config)
            : a.action_config || {},
      }));

      const recordData =
        typeof request.record_snapshot === 'string'
          ? JSON.parse(request.record_snapshot)
          : request.record_snapshot || {};

      await approvalActionService.executeActions(
        tx,
        organizationId,
        requestId,
        parsedActions,
        recordData,
        'REJECTION',
        request.module_id,
        request.record_id,
        approverUserId,
      );

      return { success: true, requestStatus: 'REJECTED' };
    });
  }

  /**
   * Cancel an active approval request.
   */
  async cancelRequest(
    organizationId: string,
    requestId: string,
    actorUserId: string,
    reason?: string,
  ): Promise<{ success: boolean; requestStatus: string }> {
    return runAsTenant(organizationId, async (tx) => {
      const reqRows = await tx.$queryRaw<
        Array<{ id: string; status: string }>
      >`
        SELECT "id", "status"
        FROM "approval_requests"
        WHERE "id" = ${requestId}::uuid AND "organization_id" = ${organizationId}::uuid
        FOR UPDATE
      `;

      const request = reqRows[0];
      if (!request) throw ApiError.notFound('Approval request not found.');
      if (request.status !== 'IN_PROGRESS' && request.status !== 'PENDING') {
        throw new ApiError(400, `Cannot cancel a request with status ${request.status}.`);
      }

      await tx.$executeRaw`
        UPDATE "approval_requests"
        SET "status" = 'CANCELLED', "completed_at" = now(), "current_stage_id" = null
        WHERE "id" = ${requestId}::uuid
      `;

      await tx.$executeRaw`
        INSERT INTO "approval_history" (
          "organization_id", "request_id", "event_type", "actor_id",
          "previous_status", "new_status", "comment"
        ) VALUES (
          ${organizationId}::uuid, ${requestId}::uuid, 'CANCELLED',
          ${actorUserId}::uuid, ${request.status}, 'CANCELLED',
          ${reason || 'Approval request was cancelled.'}
        )
      `;

      return { success: true, requestStatus: 'CANCELLED' };
    });
  }

  /**
   * Fetch full request details, current stage, approver statuses, and execution history.
   */
  async getRequestDetails(organizationId: string, requestId: string): Promise<ApprovalRequestDetails> {
    return runAsTenant(organizationId, async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          organization_id: string;
          process_id: string;
          process_name: string;
          process_version_id: string | null;
          rule_id: string | null;
          rule_name: string | null;
          module_id: string;
          record_id: string;
          record_title: string;
          record_snapshot: any;
          status: string;
          current_stage_id: string | null;
          requester_id: string | null;
          requester_name: string | null;
          submitted_at: Date;
          completed_at: Date | null;
        }>
      >`
        SELECT r."id", r."organization_id", r."process_id", p."name" as "process_name",
               r."process_version_id", r."rule_id", ru."name" as "rule_name",
               r."module_id", r."record_id", r."record_title", r."record_snapshot",
               r."status", r."current_stage_id", r."requester_id",
               u."full_name" as "requester_name",
               r."submitted_at", r."completed_at"
        FROM "approval_requests" r
        JOIN "approval_processes" p ON p."id" = r."process_id"
        LEFT JOIN "approval_process_rules" ru ON ru."id" = r."rule_id"
        LEFT JOIN "users" u ON u."id" = r."requester_id"
        WHERE r."id" = ${requestId}::uuid AND r."organization_id" = ${organizationId}::uuid
      `;

      const req = rows[0];
      if (!req) throw ApiError.notFound('Approval request not found.');

      // Load request stages
      const stages = await tx.$queryRaw<
        Array<{
          id: string;
          stage_id: string | null;
          stage_order: number;
          name: string;
          status: string;
          approval_mode: string;
        }>
      >`
        SELECT "id", "stage_id", "stage_order", "name", "status", "approval_mode"
        FROM "approval_request_stages"
        WHERE "request_id" = ${requestId}::uuid
        ORDER BY "stage_order" ASC
      `;

      // Load approvers for stages
      const approvers = await tx.$queryRaw<
        Array<{
          id: string;
          request_stage_id: string;
          user_id: string;
          full_name: string | null;
          email: string;
          status: string;
          action_taken_at: Date | null;
          comment: string | null;
        }>
      >`
        SELECT a."id", a."request_stage_id", a."user_id", u."full_name",
               u."email", a."status", a."action_taken_at", a."comment"
        FROM "approval_request_approvers" a
        JOIN "users" u ON u."id" = a."user_id"
        WHERE a."request_stage_id" IN (
          SELECT "id" FROM "approval_request_stages" WHERE "request_id" = ${requestId}::uuid
        )
      `;

      const approversByStage = new Map<string, typeof approvers>();
      for (const a of approvers) {
        const list = approversByStage.get(a.request_stage_id) || [];
        list.push(a);
        approversByStage.set(a.request_stage_id, list);
      }

      // Load history
      const history = await tx.$queryRaw<
        Array<{
          id: string;
          event_type: string;
          actor_id: string | null;
          actor_name: string | null;
          previous_status: string | null;
          new_status: string | null;
          comment: string | null;
          created_at: Date;
        }>
      >`
        SELECT h."id", h."event_type", h."actor_id", u."full_name" as "actor_name",
               h."previous_status", h."new_status", h."comment", h."created_at"
        FROM "approval_history" h
        LEFT JOIN "users" u ON u."id" = h."actor_id"
        WHERE h."request_id" = ${requestId}::uuid
        ORDER BY h."created_at" ASC
      `;

      // Load action execution logs
      const actions = await tx.$queryRaw<
        Array<{
          id: string;
          action_type: string;
          trigger_event: string;
          status: string;
          attempts: number;
          error_message: string | null;
          executed_at: Date | null;
        }>
      >`
        SELECT "id", "action_type", "trigger_event", "status", "attempts",
               "error_message", "executed_at"
        FROM "approval_action_executions"
        WHERE "request_id" = ${requestId}::uuid
        ORDER BY "executed_at" DESC
      `;

      return {
        id: req.id,
        organizationId: req.organization_id,
        processId: req.process_id,
        processName: req.process_name,
        processVersionId: req.process_version_id,
        ruleId: req.rule_id,
        ruleName: req.rule_name || undefined,
        moduleId: req.module_id,
        moduleName: req.module_id.replace(/_/g, ' ').toUpperCase(),
        recordId: req.record_id,
        recordTitle: req.record_title,
        recordSnapshot:
          typeof req.record_snapshot === 'string'
            ? JSON.parse(req.record_snapshot)
            : req.record_snapshot || {},
        status: req.status as any,
        currentStageId: req.current_stage_id,
        requesterId: req.requester_id,
        requesterName: req.requester_name || undefined,
        submittedAt: req.submitted_at.toISOString(),
        completedAt: req.completed_at ? req.completed_at.toISOString() : null,
        stages: stages.map((s) => ({
          id: s.id,
          stageId: s.stage_id,
          stageOrder: s.stage_order,
          name: s.name,
          status: s.status,
          approvalMode: s.approval_mode,
          approvers: (approversByStage.get(s.id) || []).map((ap) => ({
            id: ap.id,
            userId: ap.user_id,
            fullName: ap.full_name || undefined,
            email: ap.email,
            status: ap.status,
            actionTakenAt: ap.action_taken_at ? ap.action_taken_at.toISOString() : null,
            comment: ap.comment,
          })),
        })),
        history: history.map((h) => ({
          id: h.id,
          eventType: h.event_type,
          actorId: h.actor_id,
          actorName: h.actor_name || undefined,
          previousStatus: h.previous_status,
          newStatus: h.new_status,
          comment: h.comment,
          createdAt: h.created_at.toISOString(),
        })),
        actions: actions.map((ac) => ({
          id: ac.id,
          actionType: ac.action_type,
          triggerEvent: ac.trigger_event,
          status: ac.status,
          attempts: ac.attempts,
          errorMessage: ac.error_message,
          executedAt: ac.executed_at ? ac.executed_at.toISOString() : '',
        })),
      };
    });
  }

  /**
   * Fetch all approval cycles and history for a single CRM record (Zoho-style record-wise history).
   */
  async getRecordApprovalHistory(
    organizationId: string,
    moduleId: string,
    recordId: string,
  ): Promise<{
    activeRequest: ApprovalRequestDetails | null;
    allRequests: ApprovalRequestDetails[];
  }> {
    // Resolve aliases before entering the transaction
    const moduleAliases = await this.resolveAllModuleAliases(moduleId);

    return runAsTenant(organizationId, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT "id", "status"
        FROM "approval_requests"
        WHERE "organization_id" = ${organizationId}::uuid
          AND "module_id" = ANY(${moduleAliases}::text[])
          AND "record_id" = ${recordId}
        ORDER BY "submitted_at" DESC
      `;

      if (rows.length === 0) {
        return { activeRequest: null, allRequests: [] };
      }

      const allRequests: ApprovalRequestDetails[] = [];
      let activeRequest: ApprovalRequestDetails | null = null;

      for (const row of rows) {
        const details = await this.getRequestDetails(organizationId, row.id);
        allRequests.push(details);
        if (!activeRequest && (details.status === 'IN_PROGRESS' || details.status === 'PENDING')) {
          activeRequest = details;
        }
      }

      return { activeRequest, allRequests };
    });
  }

  /**
   * List approval requests with tab filtering, search, pagination, and current stage approvers.
   */
  async listRequests(
    organizationId: string,
    options: {
      userId?: string;
      tab?: 'all' | 'pending' | 'my' | 'approved' | 'rejected';
      status?: string;
      moduleId?: string;
      search?: string;
      page?: number;
      limit?: number;
    },
  ): Promise<{
    items: ApprovalRequestListItem[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    return runAsTenant(organizationId, async (tx) => {
      const page = Math.max(1, Number(options.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(options.limit) || 20));
      const offset = (page - 1) * limit;
      const currentUserId = options.userId || null;
      const searchPattern = options.search ? `%${options.search.trim()}%` : null;
      const tab = options.tab || 'all';

      // Check if current user is an Organization Owner
      const isOwnerRow = await tx.$queryRaw<Array<{ is_owner: boolean }>>`
        SELECT "is_owner" FROM "memberships"
        WHERE "organization_id" = ${organizationId}::uuid
          AND "user_id" = ${currentUserId}::uuid
          AND "is_active" = true
          AND "is_deleted" = false
        LIMIT 1
      `;
      const isOrgOwner = isOwnerRow[0]?.is_owner ?? false;

      // Status conditions based on tab or status filter
      let statusFilter: string[] | null = null;
      if (options.status) {
        statusFilter = [options.status];
      } else if (tab === 'pending') {
        statusFilter = ['PENDING', 'IN_PROGRESS'];
      } else if (tab === 'approved') {
        statusFilter = ['APPROVED', 'FINAL_APPROVED'];
      } else if (tab === 'rejected') {
        statusFilter = ['REJECTED'];
      } else if (tab === 'my') {
        statusFilter = ['PENDING', 'IN_PROGRESS'];
      }

      const normalizedModule = options.moduleId ? options.moduleId.toLowerCase() : null;

      // Query requests
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          module_id: string;
          record_id: string;
          record_title: string;
          process_id: string;
          process_name: string;
          status: string;
          current_stage_id: string | null;
          current_stage_name: string | null;
          current_stage_order: number | null;
          requester_id: string | null;
          requester_name: string | null;
          submitted_at: Date;
          completed_at: Date | null;
          is_approver: boolean;
        }>
      >`
        SELECT r."id", r."module_id", r."record_id", r."record_title",
               r."process_id", p."name" as "process_name", r."status",
               r."current_stage_id", stg."name" as "current_stage_name", stg."stage_order" as "current_stage_order",
               r."requester_id", u."full_name" as "requester_name",
               r."submitted_at", r."completed_at",
               (
                 ${isOrgOwner}::boolean OR
                 EXISTS (
                   SELECT 1 FROM "approval_request_approvers" ap
                   JOIN "approval_request_stages" rs ON rs."id" = ap."request_stage_id"
                   WHERE rs."request_id" = r."id"
                     AND rs."stage_id" = r."current_stage_id"
                     AND ap."user_id" = ${currentUserId}::uuid
                     AND ap."status" = 'PENDING'
                 ) OR
                 EXISTS (
                   SELECT 1 FROM "approval_process_admins" pa
                   WHERE pa."process_id" = r."process_id"
                     AND pa."user_id" = ${currentUserId}::uuid
                 )
               ) as "is_approver"
        FROM "approval_requests" r
        JOIN "approval_processes" p ON p."id" = r."process_id"
        LEFT JOIN "approval_stages" stg ON stg."id" = r."current_stage_id"
        LEFT JOIN "users" u ON u."id" = r."requester_id"
        WHERE r."organization_id" = ${organizationId}::uuid
          AND (${statusFilter ? statusFilter : null}::text[] IS NULL OR r."status" = ANY(${statusFilter}::text[]))
          AND (${normalizedModule}::text IS NULL OR r."module_id" = ${normalizedModule})
          AND (
            ${searchPattern}::text IS NULL OR
            r."record_title" ILIKE ${searchPattern} OR
            p."name" ILIKE ${searchPattern} OR
            u."full_name" ILIKE ${searchPattern}
          )
          AND (
            (${isOrgOwner}::boolean AND ${tab !== 'my'}::boolean) OR
            EXISTS (
              SELECT 1 FROM "approval_request_approvers" ap
              JOIN "approval_request_stages" rs ON rs."id" = ap."request_stage_id"
              WHERE rs."request_id" = r."id"
                AND rs."stage_id" = r."current_stage_id"
                AND ap."user_id" = ${currentUserId}::uuid
                AND ap."status" = 'PENDING'
            ) OR
            EXISTS (
              SELECT 1 FROM "approval_process_admins" pa
              WHERE pa."process_id" = r."process_id"
                AND pa."user_id" = ${currentUserId}::uuid
            ) OR
            (
              ${tab !== 'my'}::boolean AND (
                r."requester_id" = ${currentUserId}::uuid OR
                EXISTS (
                  SELECT 1 FROM "approval_request_approvers" ap
                  JOIN "approval_request_stages" rs ON rs."id" = ap."request_stage_id"
                  WHERE rs."request_id" = r."id"
                    AND ap."user_id" = ${currentUserId}::uuid
                )
              )
            )
          )
        ORDER BY r."submitted_at" DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

      // Count total matching
      const countRows = await tx.$queryRaw<Array<{ total: number }>>`
        SELECT count(r."id")::int as "total"
        FROM "approval_requests" r
        JOIN "approval_processes" p ON p."id" = r."process_id"
        LEFT JOIN "users" u ON u."id" = r."requester_id"
        WHERE r."organization_id" = ${organizationId}::uuid
          AND (${statusFilter ? statusFilter : null}::text[] IS NULL OR r."status" = ANY(${statusFilter}::text[]))
          AND (${normalizedModule}::text IS NULL OR r."module_id" = ${normalizedModule})
          AND (
            ${searchPattern}::text IS NULL OR
            r."record_title" ILIKE ${searchPattern} OR
            p."name" ILIKE ${searchPattern} OR
            u."full_name" ILIKE ${searchPattern}
          )
          AND (
            (${isOrgOwner}::boolean AND ${tab !== 'my'}::boolean) OR
            EXISTS (
              SELECT 1 FROM "approval_request_approvers" ap
              JOIN "approval_request_stages" rs ON rs."id" = ap."request_stage_id"
              WHERE rs."request_id" = r."id"
                AND rs."stage_id" = r."current_stage_id"
                AND ap."user_id" = ${currentUserId}::uuid
                AND ap."status" = 'PENDING'
            ) OR
            EXISTS (
              SELECT 1 FROM "approval_process_admins" pa
              WHERE pa."process_id" = r."process_id"
                AND pa."user_id" = ${currentUserId}::uuid
            ) OR
            (
              ${tab !== 'my'}::boolean AND (
                r."requester_id" = ${currentUserId}::uuid OR
                EXISTS (
                  SELECT 1 FROM "approval_request_approvers" ap
                  JOIN "approval_request_stages" rs ON rs."id" = ap."request_stage_id"
                  WHERE rs."request_id" = r."id"
                    AND ap."user_id" = ${currentUserId}::uuid
                )
              )
            )
          )
      `;

      const total = countRows[0]?.total ?? rows.length;

      // Batch load current stage approvers for the listed rows
      const requestIds = rows.map((r) => r.id);
      let approverMap = new Map<string, Array<{ id: string; userId: string; fullName?: string; email: string; status: string }>>();

      if (requestIds.length > 0) {
        const approverRows = await tx.$queryRaw<
          Array<{
            request_id: string;
            id: string;
            user_id: string;
            full_name: string | null;
            email: string;
            status: string;
          }>
        >`
          SELECT rs."request_id", ap."id", ap."user_id", u."full_name", u."email", ap."status"
          FROM "approval_request_approvers" ap
          JOIN "approval_request_stages" rs ON rs."id" = ap."request_stage_id"
          JOIN "approval_requests" r ON r."id" = rs."request_id" AND rs."stage_id" = r."current_stage_id"
          JOIN "users" u ON u."id" = ap."user_id"
          WHERE rs."request_id" = ANY(${requestIds}::uuid[])
        `;

        for (const row of approverRows) {
          const list = approverMap.get(row.request_id) || [];
          list.push({
            id: row.id,
            userId: row.user_id,
            fullName: row.full_name || undefined,
            email: row.email,
            status: row.status,
          });
          approverMap.set(row.request_id, list);
        }
      }

      const items: ApprovalRequestListItem[] = rows.map((r) => ({
        id: r.id,
        moduleId: r.module_id,
        moduleName: r.module_id.replace(/_/g, ' ').toUpperCase(),
        recordId: r.record_id,
        recordTitle: r.record_title,
        processId: r.process_id,
        processName: r.process_name,
        status: r.status,
        currentStageId: r.current_stage_id,
        currentStageName: r.current_stage_name || undefined,
        currentStageOrder: r.current_stage_order || undefined,
        currentStageApprovers: approverMap.get(r.id) || [],
        requesterId: r.requester_id,
        requesterName: r.requester_name || undefined,
        submittedAt: r.submitted_at.toISOString(),
        completedAt: r.completed_at ? r.completed_at.toISOString() : null,
        isApproverForCurrentUser: r.is_approver,
      }));

      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    });
  }
}

export const approvalExecutionService = new ApprovalExecutionService();
