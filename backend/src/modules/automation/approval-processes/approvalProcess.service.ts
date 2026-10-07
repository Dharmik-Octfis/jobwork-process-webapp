import { prisma, runAsTenant } from '../../../db/prisma.ts';
import { ApiError } from '../../../lib/apiError.ts';
import { criteriaEvaluatorService } from './criteriaEvaluator.service.ts';
import type {
  ApprovalProcessDetails,
  ApprovalProcessListItem,
  CreateApprovalProcessInput,
  UpdateApprovalProcessInput,
} from './approvalProcess.types.ts';

export class ApprovalProcessService {
  /**
   * Lists approval processes for an organization with pagination, search, and filters.
   */
  async listProcesses(
    organizationId: string,
    options: {
      page?: number;
      limit?: number;
      search?: string;
      moduleId?: string;
      status?: string;
      trigger?: string;
    },
  ): Promise<{ items: ApprovalProcessListItem[]; total: number; page: number; limit: number }> {
    return runAsTenant(organizationId, async (tx) => {
      const page = Math.max(1, options.page || 1);
      const limit = Math.min(100, Math.max(1, options.limit || 20));
      const offset = (page - 1) * limit;

      const searchPattern = options.search ? `%${options.search.trim()}%` : null;

      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          name: string;
          description: string | null;
          module_id: string;
          trigger_type: string;
          status: string;
          priority: number;
          current_version: number;
          rules_count: number;
          stages_count: number;
          created_by_name: string | null;
          updated_by_name: string | null;
          created_at: Date;
          updated_at: Date;
        }>
      >`
        SELECT p."id", p."name", p."description", p."module_id", p."trigger_type",
               p."status", p."priority", p."current_version",
               COUNT(DISTINCT r."id")::int as "rules_count",
               COUNT(DISTINCT s."id")::int as "stages_count",
               uc."full_name" as "created_by_name",
               uu."full_name" as "updated_by_name",
               p."created_at", p."updated_at"
        FROM "approval_processes" p
        LEFT JOIN "approval_process_rules" r ON r."process_id" = p."id" AND r."is_deleted" = false
        LEFT JOIN "approval_stages" s ON s."rule_id" = r."id" AND s."is_deleted" = false
        LEFT JOIN "users" uc ON uc."id" = p."created_by"
        LEFT JOIN "users" uu ON uu."id" = p."updated_by"
        WHERE p."organization_id" = ${organizationId}::uuid
          AND p."is_deleted" = false
          AND (${searchPattern}::text IS NULL OR p."name" ILIKE ${searchPattern})
          AND (${options.moduleId || null}::text IS NULL OR p."module_id" = ${options.moduleId})
          AND (${options.status || null}::text IS NULL OR p."status" = ${options.status})
          AND (${options.trigger || null}::text IS NULL OR p."trigger_type" = ${options.trigger})
        GROUP BY p."id", uc."full_name", uu."full_name"
        ORDER BY p."priority" ASC, p."updated_at" DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

      const countRows = await tx.$queryRaw<Array<{ total: number }>>`
        SELECT count(*)::int as "total"
        FROM "approval_processes" p
        WHERE p."organization_id" = ${organizationId}::uuid
          AND p."is_deleted" = false
          AND (${searchPattern}::text IS NULL OR p."name" ILIKE ${searchPattern})
          AND (${options.moduleId || null}::text IS NULL OR p."module_id" = ${options.moduleId})
          AND (${options.status || null}::text IS NULL OR p."status" = ${options.status})
          AND (${options.trigger || null}::text IS NULL OR p."trigger_type" = ${options.trigger})
      `;

      const total = countRows[0]?.total ?? 0;

      let moduleNameMap = new Map<string, string>();
      try {
        const appModules = await prisma.appModule.findMany({
          select: { id: true, code: true, name: true },
        });
        for (const m of appModules) {
          moduleNameMap.set(m.id.toLowerCase(), m.name);
          moduleNameMap.set(m.code.toLowerCase(), m.name);
        }
      } catch {
        // Fallback to formatting
      }

      return {
        items: rows.map((r) => {
          const modKey = (r.module_id || '').toLowerCase();
          const cleanName = moduleNameMap.get(modKey) || r.module_id.replace(/_/g, ' ').toUpperCase();
          return {
            id: r.id,
            name: r.name,
            description: r.description,
            moduleId: r.module_id,
            moduleName: cleanName,
            triggerType: r.trigger_type as any,
            status: r.status as any,
            priority: r.priority,
            currentVersion: r.current_version,
            rulesCount: r.rules_count,
            stagesCount: r.stages_count,
            createdByName: r.created_by_name || undefined,
            updatedByName: r.updated_by_name || undefined,
            createdAt: r.created_at.toISOString(),
            updatedAt: r.updated_at.toISOString(),
          };
        }),
        total,
        page,
        limit,
      };
    });
  }

  /**
   * Creates a new approval process in Draft status with a default initial rule.
   */
  async createProcess(
    organizationId: string,
    input: CreateApprovalProcessInput,
    userId?: string,
  ): Promise<{ id: string }> {
    const result = await runAsTenant(organizationId, async (tx) => {
      // Find max priority to append at end
      const maxPriRows = await tx.$queryRaw<Array<{ max_pri: number | null }>>`
        SELECT MAX("priority") as "max_pri"
        FROM "approval_processes"
        WHERE "organization_id" = ${organizationId}::uuid AND "is_deleted" = false
      `;
      const nextPriority = (maxPriRows[0]?.max_pri ?? -1) + 1;

      // Insert process
      const procRows = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO "approval_processes" (
          "organization_id", "name", "description", "module_id",
          "trigger_type", "status", "priority", "current_version",
          "created_by", "updated_by"
        ) VALUES (
          ${organizationId}::uuid, ${input.name.trim()}, ${input.description?.trim() || null},
          ${input.moduleId.toLowerCase()}, ${input.triggerType}, 'DRAFT',
          ${nextPriority}, 1,
          ${userId ? userId : null}::uuid, ${userId ? userId : null}::uuid
        )
        RETURNING "id"
      `;

      const processId = procRows[0]!.id;

      // Create initial default rule "Rule 1"
      const ruleRows = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO "approval_process_rules" (
          "organization_id", "process_id", "name", "rule_order",
          "criteria", "criteria_pattern", "created_by", "updated_by"
        ) VALUES (
          ${organizationId}::uuid, ${processId}::uuid, 'Rule 1', 1,
          '[]'::jsonb, '1',
          ${userId ? userId : null}::uuid, ${userId ? userId : null}::uuid
        )
        RETURNING "id"
      `;

      const ruleId = ruleRows[0]!.id;

      // Create default Stage 1 under Rule 1
      await tx.$executeRaw`
        INSERT INTO "approval_stages" (
          "organization_id", "rule_id", "name", "stage_order",
          "approver_type", "approver_config", "approval_mode",
          "assign_task_for_approvers", "record_modification_config",
          "created_by", "updated_by"
        ) VALUES (
          ${organizationId}::uuid, ${ruleId}::uuid, 'Stage 1', 1,
          'USER', '{"userIds": []}'::jsonb, 'ANYONE',
          false, '{"allowApproverEditPending": false, "allowUserEditRejected": false}'::jsonb,
          ${userId ? userId : null}::uuid, ${userId ? userId : null}::uuid
        )
      `;

      return { id: processId };
    });

    // If activateImmediately is requested, attempt activation after the creation transaction commits.
    // Activation validates that rules and stages exist — if they don't (fresh process), it will throw
    // an ApiError which is propagated to the HTTP layer.
    if (input.activateImmediately) {
      await this.activateProcess(organizationId, result.id, userId);
    }

    return result;
  }

  /**
   * Retrieves complete configuration tree for an approval process.
   */
  async getProcessById(organizationId: string, processId: string): Promise<ApprovalProcessDetails> {
    return runAsTenant(organizationId, async (tx) => {
      const procRows = await tx.$queryRaw<
        Array<{
          id: string;
          organization_id: string;
          name: string;
          description: string | null;
          module_id: string;
          trigger_type: string;
          status: string;
          priority: number;
          current_version: number;
          created_by: string | null;
          updated_by: string | null;
          created_by_name: string | null;
          updated_by_name: string | null;
          created_at: Date;
          updated_at: Date;
        }>
      >`
        SELECT p."id", p."organization_id", p."name", p."description",
               p."module_id", p."trigger_type", p."status", p."priority",
               p."current_version", p."created_by", p."updated_by",
               uc."full_name" as "created_by_name",
               uu."full_name" as "updated_by_name",
               p."created_at", p."updated_at"
        FROM "approval_processes" p
        LEFT JOIN "users" uc ON uc."id" = p."created_by"
        LEFT JOIN "users" uu ON uu."id" = p."updated_by"
        WHERE p."id" = ${processId}::uuid
          AND p."organization_id" = ${organizationId}::uuid
          AND p."is_deleted" = false
      `;

      const proc = procRows[0];
      if (!proc) throw ApiError.notFound('Approval process not found.');

      // Load Rules
      const ruleRows = await tx.$queryRaw<
        Array<{
          id: string;
          process_id: string;
          name: string;
          rule_order: number;
          criteria: any;
          criteria_pattern: string;
        }>
      >`
        SELECT "id", "process_id", "name", "rule_order", "criteria", "criteria_pattern"
        FROM "approval_process_rules"
        WHERE "process_id" = ${processId}::uuid AND "is_deleted" = false
        ORDER BY "rule_order" ASC
      `;

      // Load all stages for these rules
      const stageRows = await tx.$queryRaw<
        Array<{
          id: string;
          rule_id: string;
          name: string;
          stage_order: number;
          approver_type: string;
          approver_config: any;
          approval_mode: string;
          assign_task_for_approvers: boolean;
          record_modification_config: any;
        }>
      >`
        SELECT "id", "rule_id", "name", "stage_order", "approver_type",
               "approver_config", "approval_mode", "assign_task_for_approvers",
               "record_modification_config"
        FROM "approval_stages"
        WHERE "rule_id" IN (SELECT "id" FROM "approval_process_rules" WHERE "process_id" = ${processId}::uuid AND "is_deleted" = false)
          AND "is_deleted" = false
        ORDER BY "stage_order" ASC
      `;

      // Load all actions
      const actionRows = await tx.$queryRaw<
        Array<{
          id: string;
          rule_id: string;
          stage_id: string | null;
          trigger_event: string;
          action_type: string;
          action_config: any;
        }>
      >`
        SELECT "id", "rule_id", "stage_id", "trigger_event", "action_type", "action_config"
        FROM "approval_actions"
        WHERE "rule_id" IN (SELECT "id" FROM "approval_process_rules" WHERE "process_id" = ${processId}::uuid AND "is_deleted" = false)
          AND "is_deleted" = false
      `;

      // Load Admins
      const adminRows = await tx.$queryRaw<
        Array<{
          id: string;
          user_id: string;
          can_override: boolean;
          can_reassign: boolean;
          full_name: string | null;
          email: string;
        }>
      >`
        SELECT a."id", a."user_id", a."can_override", a."can_reassign",
               u."full_name", u."email"
        FROM "approval_process_admins" a
        JOIN "users" u ON u."id" = a."user_id"
        WHERE a."process_id" = ${processId}::uuid
      `;

      // Group stages and actions by ruleId
      const stagesByRule = new Map<string, typeof stageRows>();
      for (const s of stageRows) {
        const list = stagesByRule.get(s.rule_id) || [];
        list.push(s);
        stagesByRule.set(s.rule_id, list);
      }

      const actionsByRule = new Map<string, typeof actionRows>();
      for (const a of actionRows) {
        const list = actionsByRule.get(a.rule_id) || [];
        list.push(a);
        actionsByRule.set(a.rule_id, list);
      }

      const rules = ruleRows.map((r) => {
        const rStages = (stagesByRule.get(r.id) || []).map((s) => {
          const approverConfig =
            typeof s.approver_config === 'string'
              ? JSON.parse(s.approver_config)
              : s.approver_config || {};
          const recordModificationConfig =
            typeof s.record_modification_config === 'string'
              ? JSON.parse(s.record_modification_config)
              : s.record_modification_config || {};
          return {
            id: s.id,
            name: s.name,
            stageOrder: s.stage_order,
            approverType: s.approver_type as any,
            approverConfig,
            approverDefinition: {
              type: s.approver_type as any,
              userIds: approverConfig.userIds || [],
              roleIds: approverConfig.roleIds || [],
              fieldId: approverConfig.lookupFieldId,
            },
            approvalMode: s.approval_mode as any,
            assignTaskForApprovers: s.assign_task_for_approvers,
            recordModificationConfig,
            recordModification: recordModificationConfig,
            stageApprovalActions: [],
          };
        });

        const rActions = actionsByRule.get(r.id) || [];
        const finalActions = rActions
          .filter((a) => a.trigger_event === 'FINAL_APPROVAL')
          .map((a) => ({
            id: a.id,
            stageId: a.stage_id,
            triggerEvent: 'FINAL_APPROVAL' as const,
            actionType: a.action_type as any,
            actionConfig:
              typeof a.action_config === 'string'
                ? JSON.parse(a.action_config)
                : a.action_config || {},
            config:
              typeof a.action_config === 'string'
                ? JSON.parse(a.action_config)
                : a.action_config || {},
          }));

        const rejectionActions = rActions
          .filter((a) => a.trigger_event === 'REJECTION')
          .map((a) => ({
            id: a.id,
            stageId: a.stage_id,
            triggerEvent: 'REJECTION' as const,
            actionType: a.action_type as any,
            actionConfig:
              typeof a.action_config === 'string'
                ? JSON.parse(a.action_config)
                : a.action_config || {},
            config:
              typeof a.action_config === 'string'
                ? JSON.parse(a.action_config)
                : a.action_config || {},
          }));

        const rawCriteria =
          typeof r.criteria === 'string' ? JSON.parse(r.criteria) : r.criteria || [];
        const conditionsList = Array.isArray(rawCriteria)
          ? rawCriteria
          : Array.isArray(rawCriteria.conditions)
          ? rawCriteria.conditions
          : [];

        return {
          id: r.id,
          processId: r.process_id,
          name: r.name,
          ruleOrder: r.rule_order,
          criteria: {
            conditions: conditionsList,
            pattern: r.criteria_pattern || '1',
          },
          criteriaPattern: r.criteria_pattern || '1',
          stages: rStages,
          finalActions,
          finalApprovalActions: finalActions,
          rejectionActions,
        };
      });

      return {
        id: proc.id,
        organizationId: proc.organization_id,
        name: proc.name,
        description: proc.description,
        moduleId: proc.module_id,
        triggerType: proc.trigger_type as any,
        status: proc.status as any,
        priority: proc.priority,
        currentVersion: proc.current_version,
        rulesCount: rules.length,
        rules,
        admins: adminRows.map((ad) => ({
          id: ad.id,
          userId: ad.user_id,
          fullName: ad.full_name || undefined,
          email: ad.email,
          canOverride: ad.can_override,
          canReassign: ad.can_reassign,
        })),
        createdBy: proc.created_by,
        createdByName: proc.created_by_name || undefined,
        updatedBy: proc.updated_by,
        updatedByName: proc.updated_by_name || undefined,
        createdAt: proc.created_at.toISOString(),
        updatedAt: proc.updated_at.toISOString(),
      };
    });
  }

  /**
   * Updates full configuration tree of an approval process.
   * If process is ACTIVE, automatically snapshots the current version before updating.
   */
  async updateProcess(
    organizationId: string,
    processId: string,
    input: UpdateApprovalProcessInput,
    userId?: string,
  ): Promise<{ id: string; version: number }> {
    return runAsTenant(organizationId, async (tx) => {
      const existing = await this.getProcessById(organizationId, processId);

      // Validate rules & criteria patterns
      for (const rule of input.rules || []) {
        if (!rule.name || rule.name.trim() === '') {
          throw new ApiError(400, 'Rule name is required.');
        }
        const rCrit = Array.isArray(rule.criteria)
          ? rule.criteria
          : Array.isArray((rule.criteria as any)?.conditions)
          ? (rule.criteria as any).conditions
          : [];
        const rPat = rule.criteriaPattern || (rule.criteria as any)?.pattern || '1';

        if (rCrit.length > 0) {
          const conditionIds = rCrit.map((c: any) => c.id);
          const patternCheck = criteriaEvaluatorService.validatePattern(
            rPat,
            conditionIds,
          );
          if (!patternCheck.valid) {
            throw new ApiError(400, `Rule "${rule.name}": ${patternCheck.error}`);
          }
        }
        if (!rule.stages || rule.stages.length === 0) {
          throw new ApiError(400, `Rule "${rule.name}" must contain at least one approval stage.`);
        }
      }

      // If active, save version snapshot of existing configuration
      let nextVersion = existing.currentVersion;
      if (existing.status === 'ACTIVE') {
        nextVersion = existing.currentVersion + 1;
        await tx.$executeRaw`
          INSERT INTO "approval_process_versions" (
            "organization_id", "process_id", "version_number", "snapshot", "created_by"
          ) VALUES (
            ${organizationId}::uuid, ${processId}::uuid, ${existing.currentVersion},
            ${JSON.stringify(existing)}::jsonb,
            ${userId ? userId : null}::uuid
          )
        `;
      }

      // Update process header
      const targetModuleId = (input.moduleId || existing.moduleId).toLowerCase();
      await tx.$executeRaw`
        UPDATE "approval_processes"
        SET "name" = ${input.name.trim()},
            "description" = ${input.description?.trim() || null},
            "module_id" = ${targetModuleId},
            "trigger_type" = ${input.triggerType || existing.triggerType},
            "current_version" = ${nextVersion},
            "updated_by" = ${userId ? userId : null}::uuid,
            "updated_at" = now()
        WHERE "id" = ${processId}::uuid AND "organization_id" = ${organizationId}::uuid
      `;

      // Soft delete old rules and their children
      await tx.$executeRaw`
        UPDATE "approval_actions" SET "is_deleted" = true
        WHERE "rule_id" IN (SELECT "id" FROM "approval_process_rules" WHERE "process_id" = ${processId}::uuid)
      `;
      await tx.$executeRaw`
        UPDATE "approval_stages" SET "is_deleted" = true
        WHERE "rule_id" IN (SELECT "id" FROM "approval_process_rules" WHERE "process_id" = ${processId}::uuid)
      `;
      await tx.$executeRaw`
        UPDATE "approval_process_rules" SET "is_deleted" = true
        WHERE "process_id" = ${processId}::uuid
      `;

      // Insert new rules, stages, and actions
      for (let rIdx = 0; rIdx < (input.rules || []).length; rIdx++) {
        const rInput = input.rules[rIdx]!;
        const rConditions = Array.isArray(rInput.criteria)
          ? rInput.criteria
          : Array.isArray((rInput.criteria as any)?.conditions)
          ? (rInput.criteria as any).conditions
          : [];
        const rPattern = rInput.criteriaPattern || (rInput.criteria as any)?.pattern || '1';

        const rRows = await tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO "approval_process_rules" (
            "organization_id", "process_id", "name", "rule_order",
            "criteria", "criteria_pattern", "created_by", "updated_by"
          ) VALUES (
            ${organizationId}::uuid, ${processId}::uuid, ${rInput.name.trim()},
            ${rIdx + 1},
            ${JSON.stringify(rConditions)}::jsonb,
            ${rPattern},
            ${userId ? userId : null}::uuid, ${userId ? userId : null}::uuid
          )
          RETURNING "id"
        `;
        const newRuleId = rRows[0]!.id;

        // Insert stages
        for (let sIdx = 0; sIdx < (rInput.stages || []).length; sIdx++) {
          const stg = rInput.stages[sIdx]!;
          const approverType = stg.approverType || (stg as any).approverDefinition?.type || 'USER';
          const approverConfig = stg.approverConfig || {
            userIds: (stg as any).approverDefinition?.userIds || [],
            roleIds: (stg as any).approverDefinition?.roleIds || [],
            lookupFieldId: (stg as any).approverDefinition?.fieldId,
          };
          const recordMod = stg.recordModificationConfig || (stg as any).recordModification || {};

          await tx.$executeRaw`
            INSERT INTO "approval_stages" (
              "organization_id", "rule_id", "name", "stage_order",
              "approver_type", "approver_config", "approval_mode",
              "assign_task_for_approvers", "record_modification_config",
              "created_by", "updated_by"
            ) VALUES (
              ${organizationId}::uuid, ${newRuleId}::uuid, ${stg.name.trim()},
              ${sIdx + 1},
              ${approverType},
              ${JSON.stringify(approverConfig)}::jsonb,
              ${stg.approvalMode || 'ANYONE'},
              ${Boolean(stg.assignTaskForApprovers)},
              ${JSON.stringify(recordMod)}::jsonb,
              ${userId ? userId : null}::uuid, ${userId ? userId : null}::uuid
            )
          `;
        }

        // Insert final actions
        const finalActions = rInput.finalActions || (rInput as any).finalApprovalActions || [];
        for (const fa of finalActions) {
          const actionConfig = fa.actionConfig || (fa as any).config || {};
          await tx.$executeRaw`
            INSERT INTO "approval_actions" (
              "organization_id", "rule_id", "trigger_event", "action_type",
              "action_config", "created_by", "updated_by"
            ) VALUES (
              ${organizationId}::uuid, ${newRuleId}::uuid, 'FINAL_APPROVAL',
              ${fa.actionType},
              ${JSON.stringify(actionConfig)}::jsonb,
              ${userId ? userId : null}::uuid, ${userId ? userId : null}::uuid
            )
          `;
        }

        // Insert rejection actions
        for (const ra of rInput.rejectionActions || []) {
          const actionConfig = ra.actionConfig || (ra as any).config || {};
          await tx.$executeRaw`
            INSERT INTO "approval_actions" (
              "organization_id", "rule_id", "trigger_event", "action_type",
              "action_config", "created_by", "updated_by"
            ) VALUES (
              ${organizationId}::uuid, ${newRuleId}::uuid, 'REJECTION',
              ${ra.actionType},
              ${JSON.stringify(actionConfig)}::jsonb,
              ${userId ? userId : null}::uuid, ${userId ? userId : null}::uuid
            )
          `;
        }
      }

      // Update Admins
      const adminList =
        input.admins ||
        (input as any).adminUserIds?.map((uid: string) => ({ userId: uid })) ||
        [];
      if (input.admins !== undefined || (input as any).adminUserIds !== undefined) {
        await tx.$executeRaw`
          DELETE FROM "approval_process_admins" WHERE "process_id" = ${processId}::uuid
        `;
        for (const admin of adminList) {
          await tx.$executeRaw`
            INSERT INTO "approval_process_admins" (
              "organization_id", "process_id", "user_id", "can_override", "can_reassign"
            ) VALUES (
              ${organizationId}::uuid, ${processId}::uuid, ${admin.userId}::uuid,
              ${admin.canOverride ?? true}, ${admin.canReassign ?? true}
            )
            ON CONFLICT ("process_id", "user_id") DO NOTHING
          `;
        }
      }

      return { id: processId, version: nextVersion };
    });
  }

  /**
   * Activates approval process after verifying rules and stage configurations.
   */
  async activateProcess(organizationId: string, processId: string, userId?: string): Promise<void> {
    return runAsTenant(organizationId, async (tx) => {
      const details = await this.getProcessById(organizationId, processId);

      if (!details.rules || details.rules.length === 0) {
        throw new ApiError(400, 'Cannot activate process with no rules.');
      }

      for (const rule of details.rules) {
        if (!rule.stages || rule.stages.length === 0) {
          throw new ApiError(400, `Rule "${rule.name}" must have at least one stage.`);
        }
        for (const stage of rule.stages) {
          if (stage.approverType === 'USER') {
            const uids = stage.approverConfig.userIds || [];
            if (uids.length === 0) {
              throw new ApiError(400, `Stage "${stage.name}" has no users selected as approvers.`);
            }
          } else if (stage.approverType === 'ROLE') {
            const rids = stage.approverConfig.roleIds || [];
            if (rids.length === 0) {
              throw new ApiError(400, `Stage "${stage.name}" has no roles selected as approvers.`);
            }
          }
        }
      }

      // Take initial snapshot
      await tx.$executeRaw`
        INSERT INTO "approval_process_versions" (
          "organization_id", "process_id", "version_number", "snapshot", "created_by"
        ) VALUES (
          ${organizationId}::uuid, ${processId}::uuid, ${details.currentVersion},
          ${JSON.stringify(details)}::jsonb,
          ${userId ? userId : null}::uuid
        )
      `;

      await tx.$executeRaw`
        UPDATE "approval_processes"
        SET "status" = 'ACTIVE',
            "updated_by" = ${userId ? userId : null}::uuid,
            "updated_at" = now()
        WHERE "id" = ${processId}::uuid AND "organization_id" = ${organizationId}::uuid
      `;
    });
  }

  /**
   * Deactivates approval process.
   */
  async deactivateProcess(organizationId: string, processId: string, userId?: string): Promise<void> {
    return runAsTenant(organizationId, async (tx) => {
      await tx.$executeRaw`
        UPDATE "approval_processes"
        SET "status" = 'INACTIVE',
            "updated_by" = ${userId ? userId : null}::uuid,
            "updated_at" = now()
        WHERE "id" = ${processId}::uuid AND "organization_id" = ${organizationId}::uuid
      `;
    });
  }

  /**
   * Duplicates an existing process as a Draft copy.
   */
  async duplicateProcess(organizationId: string, processId: string, userId?: string): Promise<{ id: string }> {
    const original = await this.getProcessById(organizationId, processId);
    const newName = `Copy of ${original.name}`;

    return this.createProcess(
      organizationId,
      {
        name: newName,
        description: original.description || undefined,
        moduleId: original.moduleId,
        triggerType: original.triggerType,
      },
      userId,
    ).then(async ({ id: newId }) => {
      await this.updateProcess(
        organizationId,
        newId,
        {
          name: newName,
          description: original.description || undefined,
          moduleId: original.moduleId,
          triggerType: original.triggerType,
          rules: original.rules.map((r) => ({
            name: r.name,
            ruleOrder: r.ruleOrder,
            criteria: r.criteria,
            criteriaPattern: r.criteriaPattern,
            stages: r.stages.map((s) => ({
              name: s.name,
              stageOrder: s.stageOrder,
              approverType: s.approverType,
              approverConfig: s.approverConfig,
              approvalMode: s.approvalMode,
              assignTaskForApprovers: s.assignTaskForApprovers,
              recordModificationConfig: s.recordModificationConfig,
            })),
            finalActions: r.finalActions.map((fa) => ({
              triggerEvent: 'FINAL_APPROVAL' as const,
              actionType: fa.actionType,
              actionConfig: fa.actionConfig,
            })),
            rejectionActions: r.rejectionActions.map((ra) => ({
              triggerEvent: 'REJECTION' as const,
              actionType: ra.actionType,
              actionConfig: ra.actionConfig,
            })),
          })),
          admins: original.admins.map((ad) => ({
            userId: ad.userId,
            canOverride: ad.canOverride,
            canReassign: ad.canReassign,
          })),
        },
        userId,
      );
      return { id: newId };
    });
  }

  /**
   * Soft deletes an approval process.
   */
  async deleteProcess(organizationId: string, processId: string, userId?: string): Promise<void> {
    return runAsTenant(organizationId, async (tx) => {
      // Check for in-flight requests
      const pendingRows = await tx.$queryRaw<Array<{ count: number }>>`
        SELECT count(*)::int as "count"
        FROM "approval_requests"
        WHERE "process_id" = ${processId}::uuid
          AND "status" IN ('PENDING', 'IN_PROGRESS')
      `;

      if ((pendingRows[0]?.count ?? 0) > 0) {
        throw new ApiError(400, 'Cannot delete an approval process with active pending approval requests.');
      }

      await tx.$executeRaw`
        UPDATE "approval_processes"
        SET "is_deleted" = true,
            "updated_by" = ${userId ? userId : null}::uuid,
            "updated_at" = now()
        WHERE "id" = ${processId}::uuid AND "organization_id" = ${organizationId}::uuid
      `;
    });
  }

  /**
   * Reorders priority sequence of approval processes for an organization.
   */
  async reorderProcesses(organizationId: string, processIds: string[]): Promise<void> {
    return runAsTenant(organizationId, async (tx) => {
      for (let i = 0; i < processIds.length; i++) {
        const id = processIds[i]!;
        await tx.$executeRaw`
          UPDATE "approval_processes"
          SET "priority" = ${i + 1},
              "updated_at" = now()
          WHERE "id" = ${id}::uuid AND "organization_id" = ${organizationId}::uuid
        `;
      }
    });
  }
}

export const approvalProcessService = new ApprovalProcessService();
