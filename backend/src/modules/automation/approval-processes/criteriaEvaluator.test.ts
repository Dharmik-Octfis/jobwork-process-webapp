import { describe, it, expect } from 'vitest';
import { criteriaEvaluatorService } from './criteriaEvaluator.service.ts';
import type { ApprovalCriteria, FieldMetadata } from './approvalProcess.types.ts';

describe('CriteriaEvaluatorService', () => {
  const fieldsMap = new Map<string, FieldMetadata>([
    [
      'amount',
      {
        id: 'amount',
        moduleId: 'deal',
        apiName: 'amount',
        label: 'Amount',
        dataType: 'currency',
        required: true,
        isActive: true,
        isCustom: false,
      },
    ],
    [
      'stage',
      {
        id: 'stage',
        moduleId: 'deal',
        apiName: 'stage',
        label: 'Stage',
        dataType: 'select',
        required: true,
        isActive: true,
        isCustom: false,
      },
    ],
    [
      'vendor_name',
      {
        id: 'vendor_name',
        moduleId: 'purchase_order',
        apiName: 'vendor.name',
        label: 'Vendor Name',
        dataType: 'text',
        required: true,
        isActive: true,
        isCustom: false,
      },
    ],
    [
      'chitty_no',
      {
        id: 'chitty_no',
        moduleId: 'purchase_order',
        apiName: 'customFields.chitty_no',
        label: 'Chitty No',
        dataType: 'text',
        required: false,
        isActive: true,
        isCustom: true,
      },
    ],
  ]);

  it('evaluates simple numeric condition', () => {
    const record = { amount: 150000 };
    const cond = { id: 1, fieldId: 'amount', operator: 'greater_than', value: 100000 };
    const passed = criteriaEvaluatorService.evaluateCondition(record, cond, fieldsMap.get('amount'));
    expect(passed).toBe(true);

    const failed = criteriaEvaluatorService.evaluateCondition(
      { amount: 50000 },
      cond,
      fieldsMap.get('amount'),
    );
    expect(failed).toBe(false);
  });

  it('evaluates nested field and custom field conditions', () => {
    const record = {
      vendor: { name: 'Acme Corp' },
      customFields: { chitty_no: 'CH-999' },
    };

    const c1 = { id: 1, fieldId: 'vendor_name', operator: 'contains', value: 'acme' };
    const c2 = { id: 2, fieldId: 'chitty_no', operator: 'is', value: 'CH-999' };

    expect(criteriaEvaluatorService.evaluateCondition(record, c1, fieldsMap.get('vendor_name'))).toBe(
      true,
    );
    expect(criteriaEvaluatorService.evaluateCondition(record, c2, fieldsMap.get('chitty_no'))).toBe(
      true,
    );
  });

  it('validates pattern syntax and parentheses correctly', () => {
    expect(criteriaEvaluatorService.validatePattern('1 AND 2', [1, 2]).valid).toBe(true);
    expect(criteriaEvaluatorService.validatePattern('(1 AND (2 OR 3))', [1, 2, 3]).valid).toBe(true);
    expect(criteriaEvaluatorService.validatePattern('((1 AND 2) OR 3)', [1, 2, 3]).valid).toBe(true);

    // Invalid parentheses
    expect(criteriaEvaluatorService.validatePattern('(1 AND 2', [1, 2]).valid).toBe(false);
    expect(criteriaEvaluatorService.validatePattern('1 AND 2)', [1, 2]).valid).toBe(false);

    // Unknown condition id
    expect(criteriaEvaluatorService.validatePattern('1 AND 4', [1, 2, 3]).valid).toBe(false);
  });

  it('evaluates boolean patterns like (1 AND (2 OR 3)) accurately', () => {
    const criteria: ApprovalCriteria = {
      conditions: [
        { id: 1, fieldId: 'amount', operator: 'greater_than', value: 100000 },
        { id: 2, fieldId: 'stage', operator: 'is', value: 'Proposal' },
        { id: 3, fieldId: 'stage', operator: 'is', value: 'Negotiation' },
      ],
      pattern: '(1 AND (2 OR 3))',
    };

    // Case A: Amount > 100000 and Stage is Proposal -> True
    expect(
      criteriaEvaluatorService.evaluateCriteria(
        { amount: 120000, stage: 'Proposal' },
        criteria,
        fieldsMap,
      ),
    ).toBe(true);

    // Case B: Amount > 100000 and Stage is Negotiation -> True
    expect(
      criteriaEvaluatorService.evaluateCriteria(
        { amount: 150000, stage: 'Negotiation' },
        criteria,
        fieldsMap,
      ),
    ).toBe(true);

    // Case C: Amount > 100000 but Stage is Qualification -> False
    expect(
      criteriaEvaluatorService.evaluateCriteria(
        { amount: 200000, stage: 'Qualification' },
        criteria,
        fieldsMap,
      ),
    ).toBe(false);

    // Case D: Stage is Proposal but Amount < 100000 -> False
    expect(
      criteriaEvaluatorService.evaluateCriteria(
        { amount: 50000, stage: 'Proposal' },
        criteria,
        fieldsMap,
      ),
    ).toBe(false);
  });
});
