import { URL } from 'node:url';
import type { TenantClient } from '../../../db/prisma.ts';
import type {
  ApprovalActionInput,
  FieldUpdateActionConfig,
  AssignTaskActionConfig,
  EmailNotificationActionConfig,
  InAppNotificationActionConfig,
  WebhookActionConfig,
  FunctionActionConfig,
} from './approvalProcess.types.ts';
import type { TriggerEvent } from './approvalProcess.constants.ts';

export class ApprovalActionService {
  /**
   * Evaluates dynamic system tokens in field update values.
   */
  resolveTokenValue(value: unknown, actorUserId?: string): unknown {
    if (typeof value !== 'string') return value;
    if (value === '$CURRENT_DATETIME') return new Date().toISOString();
    if (value === '$TODAY') return new Date().toISOString().split('T')[0];
    if (value === '$CURRENT_USER') return actorUserId || null;
    return value;
  }

  /**
   * Replaces merge tags like {{record.totalAmount}} in template strings.
   */
  interpolateMergeTags(template: string, record: Record<string, unknown>): string {
    if (!template) return '';
    return template.replace(/\{\{\s*record\.([\w.]+)\s*\}\}/g, (_match, path) => {
      const parts = path.split('.');
      let val: unknown = record;
      for (const p of parts) {
        if (val === null || val === undefined || typeof val !== 'object') {
          val = '';
          break;
        }
        val = (val as Record<string, unknown>)[p];
      }
      return String(val ?? '');
    });
  }

  /**
   * SSRF Protection: Checks if URL is safe to call.
   */
  isSafeWebhookUrl(urlString: string): { safe: boolean; reason?: string } {
    try {
      const parsed = new URL(urlString);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { safe: false, reason: 'Webhook URL must use HTTP or HTTPS protocol.' };
      }
      const hostname = parsed.hostname.toLowerCase();
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '0.0.0.0' ||
        hostname === '::1' ||
        hostname === '169.254.169.254' || // AWS metadata
        hostname.endsWith('.internal') ||
        hostname.endsWith('.local')
      ) {
        return { safe: false, reason: 'Private or local network hosts are not permitted.' };
      }
      // Check private IPv4 ranges
      const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
      if (ipv4Match) {
        const first = Number(ipv4Match[1]);
        const second = Number(ipv4Match[2]);
        if (first === 10) return { safe: false, reason: 'Private IP addresses (10.x.x.x) are blocked.' };
        if (first === 172 && second >= 16 && second <= 31)
          return { safe: false, reason: 'Private IP addresses (172.16-31.x.x) are blocked.' };
        if (first === 192 && second === 168)
          return { safe: false, reason: 'Private IP addresses (192.168.x.x) are blocked.' };
      }
      return { safe: true };
    } catch {
      return { safe: false, reason: 'Invalid URL format.' };
    }
  }

  /**
   * Executes a batch of actions for an approval event.
   */
  async executeActions(
    tx: TenantClient,
    organizationId: string,
    requestId: string,
    actions: ApprovalActionInput[],
    record: Record<string, unknown>,
    triggerEvent: TriggerEvent,
    moduleId: string,
    recordId: string,
    actorUserId?: string,
  ): Promise<void> {
    for (const action of actions) {
      if (action.triggerEvent !== triggerEvent) continue;

      let status = 'SUCCESS';
      let errorMessage: string | null = null;
      let payloadSent: Record<string, unknown> | null = null;
      let responseReceived: Record<string, unknown> | null = null;

      try {
        switch (action.actionType) {
          case 'UPDATE_FIELDS': {
            const config = action.actionConfig as FieldUpdateActionConfig;
            payloadSent = { updates: config.updates };
            await this.executeUpdateFields(
              tx,
              organizationId,
              moduleId,
              recordId,
              config,
              actorUserId,
            );
            break;
          }

          case 'ASSIGN_TASK': {
            const config = action.actionConfig as AssignTaskActionConfig;
            payloadSent = config as unknown as Record<string, unknown>;
            await this.executeAssignTask(tx, organizationId, requestId, config, record);
            break;
          }

          case 'EMAIL_NOTIFICATION': {
            const config = action.actionConfig as EmailNotificationActionConfig;
            const subject = this.interpolateMergeTags(config.subject, record);
            const message = this.interpolateMergeTags(config.message, record);
            payloadSent = { to: config.toRecipients, subject, message };
            await this.executeEmailNotification(tx, organizationId, config, subject, message);
            break;
          }

          case 'IN_APP_NOTIFICATION': {
            const config = action.actionConfig as InAppNotificationActionConfig;
            const title = this.interpolateMergeTags(config.title, record);
            const message = this.interpolateMergeTags(config.message, record);
            payloadSent = { title, message, recipientType: config.recipientType };
            await this.executeInAppNotification(tx, organizationId, requestId, config, title, message);
            break;
          }

          case 'WEBHOOK': {
            const config = action.actionConfig as WebhookActionConfig;
            payloadSent = { url: config.url, method: config.method };
            const webhookRes = await this.executeWebhook(config, record);
            responseReceived = webhookRes;
            break;
          }

          case 'FUNCTION': {
            const config = action.actionConfig as FunctionActionConfig;
            payloadSent = { functionName: config.functionName, params: config.parameters };
            break;
          }
        }
      } catch (err) {
        status = 'FAILED';
        errorMessage = (err as Error).message || String(err);
        console.error(`[ApprovalAction] Action ${action.actionType} failed:`, err);
      }

      // Record in approval_action_executions
      try {
        await tx.$executeRaw`
          INSERT INTO "approval_action_executions" (
            "organization_id", "request_id", "action_id", "action_type",
            "trigger_event", "status", "attempts", "error_message",
            "payload_sent", "response_received", "executed_at"
          ) VALUES (
            ${organizationId}::uuid, ${requestId}::uuid,
            ${action.id ? action.id : null}::uuid,
            ${action.actionType}, ${triggerEvent}, ${status}, 1,
            ${errorMessage},
            ${payloadSent ? JSON.stringify(payloadSent) : null}::jsonb,
            ${responseReceived ? JSON.stringify(responseReceived) : null}::jsonb,
            now()
          )
        `;
      } catch (logErr) {
        console.error('[ApprovalAction] Failed to log action execution:', logErr);
      }
    }
  }

  /**
   * Updates target record fields in database.
   */
  private async executeUpdateFields(
    tx: TenantClient,
    organizationId: string,
    moduleId: string,
    recordId: string,
    config: FieldUpdateActionConfig,
    actorUserId?: string,
  ): Promise<void> {
    if (!config.updates || config.updates.length === 0) return;

    const normalizedModule = moduleId.toLowerCase();
    for (const update of config.updates) {
      const resolvedValue = this.resolveTokenValue(update.value, actorUserId);
      const fieldId = update.fieldId;

      // Handle customFields.<key>
      if (fieldId.startsWith('customFields.') || fieldId.startsWith('cf_')) {
        const cfKey = fieldId.replace(/^customFields\./, '').replace(/^cf_/, '');
        const tableMap: Record<string, string> = {
          purchase_order: 'purchase_orders',
          bill: 'bills',
          item: 'items',
          vendor: 'vendors',
          customer: 'customers',
          job_order: 'job_orders',
        };
        const tableName = tableMap[normalizedModule];
        if (tableName) {
          await tx.$executeRawUnsafe(
            `UPDATE "${tableName}"
             SET "custom_fields" = jsonb_set(COALESCE("custom_fields", '{}'::jsonb), ARRAY['${cfKey}'], to_jsonb($1::text), true),
                 "updated_at" = now()
             WHERE "id" = $2::uuid AND "organization_id" = $3::uuid`,
            resolvedValue,
            recordId,
            organizationId,
          );
        }
      } else {
        // Standard column updates
        if (normalizedModule === 'purchase_order' && fieldId === 'status') {
          await tx.purchaseOrder.updateMany({
            where: { id: recordId, organizationId },
            data: { status: String(resolvedValue) },
          });
        } else if (normalizedModule === 'bill' && fieldId === 'status') {
          await tx.bill.updateMany({
            where: { id: recordId, organizationId },
            data: { status: String(resolvedValue) },
          });
        } else if (normalizedModule === 'job_order' && fieldId === 'status') {
          await tx.jobOrder.updateMany({
            where: { id: recordId, organizationId },
            data: { status: String(resolvedValue) },
          });
        } else if (normalizedModule === 'item' && fieldId === 'isActive') {
          await tx.item.updateMany({
            where: { id: recordId, organizationId },
            data: { isActive: Boolean(resolvedValue) },
          });
        }
      }
    }
  }

  private async executeAssignTask(
    tx: TenantClient,
    organizationId: string,
    requestId: string,
    config: AssignTaskActionConfig,
    record: Record<string, unknown>,
  ): Promise<void> {
    const targetUserId =
      config.assignedToUserId ||
      (record.ownerId as string) ||
      (record.createdBy as string);

    if (targetUserId) {
      await tx.$executeRaw`
        INSERT INTO "approval_notifications" (
          "organization_id", "request_id", "recipient_id", "title", "message", "type"
        ) VALUES (
          ${organizationId}::uuid, ${requestId}::uuid, ${targetUserId}::uuid,
          ${config.subject},
          ${config.description || config.subject},
          'TASK_ASSIGNED'
        )
      `;
    }
  }

  private async executeEmailNotification(
    _tx: TenantClient,
    _organizationId: string,
    config: EmailNotificationActionConfig,
    subject: string,
    _message: string,
  ): Promise<void> {
    // In dev / production, can integrate with ZeptoMail / Nodemailer
    console.log(`[ApprovalAction] Email dispatched: To=${config.toRecipients.join(',')} Subject="${subject}"`);
  }

  private async executeInAppNotification(
    tx: TenantClient,
    organizationId: string,
    requestId: string,
    config: InAppNotificationActionConfig,
    title: string,
    message: string,
  ): Promise<void> {
    let recipientId = config.userId;
    if (!recipientId) {
      // Find org owner as default recipient
      const owner = await tx.membership.findFirst({
        where: { organizationId, isOwner: true, isDeleted: false },
        select: { userId: true },
      });
      recipientId = owner?.userId;
    }

    if (recipientId) {
      await tx.$executeRaw`
        INSERT INTO "approval_notifications" (
          "organization_id", "request_id", "recipient_id", "title", "message", "type"
        ) VALUES (
          ${organizationId}::uuid, ${requestId}::uuid, ${recipientId}::uuid,
          ${title}, ${message}, 'APPROVAL_REQUIRED'
        )
      `;
    }
  }

  private async executeWebhook(
    config: WebhookActionConfig,
    record: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const check = this.isSafeWebhookUrl(config.url);
    if (!check.safe) {
      throw new Error(`SSRF Protection: ${check.reason}`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs || 8000);

    try {
      const bodyPayload = config.payloadTemplate
        ? this.interpolateMergeTags(config.payloadTemplate, record)
        : JSON.stringify({ record, timestamp: new Date().toISOString() });

      const response = await fetch(config.url, {
        method: config.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.headers || {}),
        },
        body: config.method === 'GET' ? undefined : bodyPayload,
        signal: controller.signal,
      });

      return {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const approvalActionService = new ApprovalActionService();
