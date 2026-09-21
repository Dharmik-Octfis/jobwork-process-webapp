import { approvalExecutionService } from './approvalExecution.service.ts';
import { ensureApprovalTables } from './approvalTables.migration.ts';

export interface RecordTriggerPayload {
  organizationId: string;
  moduleId: string;
  recordId: string;
  recordTitle: string;
  triggerType: 'CREATE' | 'EDIT';
  record: Record<string, unknown>;
  actorUserId?: string;
}

/**
 * Centralized trigger service for CRM record mutations (Create / Edit).
 * Module services invoke this hook after persisting records.
 */
export class ApprovalTriggerService {
  /**
   * Evaluates active approval processes for the given record event and initiates approval if matched.
   * Runs reliably and returns the result without breaking the parent transaction.
   */
  async trigger(payload: RecordTriggerPayload): Promise<{ triggered: boolean; requestId?: string }> {
    try {
      await ensureApprovalTables();
      const result = await approvalExecutionService.evaluateAndTriggerApproval(
        payload.organizationId,
        payload.moduleId,
        payload.recordId,
        payload.recordTitle || `Record ${payload.recordId}`,
        payload.triggerType,
        payload.record,
        payload.actorUserId,
      );

      if (result.triggered) {
        console.log(
          `[ApprovalTriggerService] Approval process triggered for ${payload.moduleId} record ${payload.recordId} (Request ID: ${result.requestId})`,
        );
      }

      return result;
    } catch (error) {
      console.error(
        `[ApprovalTriggerService] Error evaluating approval for ${payload.moduleId} record ${payload.recordId}:`,
        error,
      );
      // Return un-triggered rather than crashing the caller
      return { triggered: false };
    }
  }
}

export const approvalTriggerService = new ApprovalTriggerService();
