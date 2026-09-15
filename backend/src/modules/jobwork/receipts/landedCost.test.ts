import { describe, it, expect } from 'vitest';
import { Prisma } from '../../../../generated/prisma/client.ts';
import {
  drawPerUnit,
  materialByOutput,
  needTable,
  outputValues,
  usedByItem,
  type CostPlan,
} from './landedCost.ts';

/**
 * 🔴 The landed-cost arithmetic (docs/JOBWORK_LANDED_COST_PLAN.md §3–§4), checked
 * against the plan's worked examples A–G without a database. The postings that
 * carry these numbers are covered by `jobReceipts.landedCost.test.ts`.
 */

const d = (value: number | string) => new Prisma.Decimal(value);
const money = (value: Prisma.Decimal) => value.toFixed(2);
const noOutstanding = new Map<string, Prisma.Decimal>();

const single = (plannedQty: number, expectedQty: number): CostPlan => ({
  inputs: [{ itemId: 'cotton', plannedQty: d(plannedQty) }],
  outputs: [{ itemId: 'dyed', expectedQty: d(expectedQty), components: [] }],
});

/** One receipt of one plain output against one input, costed end to end. */
function receiveSingle(
  plan: CostPlan,
  accepted: number,
  outstanding: number,
  unitCost: number,
  rate: number,
  typed?: number,
) {
  const needs = needTable(
    plan,
    ['cotton'],
    [{ itemId: 'dyed', acceptedQty: d(accepted), reworkQty: d(0) }],
    false,
  );
  const { used, capped } = usedByItem(
    needs,
    ['cotton'],
    typed === undefined ? new Map() : new Map([['cotton', d(typed)]]),
    new Map([['cotton', d(outstanding)]]),
  );
  const consumed = used.get('cotton')!.times(unitCost).toDecimalPlaces(4);
  const material = materialByOutput(needs, new Map([['cotton', consumed]])).get('dyed')!;
  const { charge, acceptedValue } = outputValues(material, d(rate), d(accepted), d(0));
  return {
    need: needs.get('cotton')?.get('dyed')?.toString(),
    used: used.get('cotton')!.toString(),
    capped,
    material: money(material),
    charge: money(charge),
    perUnit: acceptedValue.dividedBy(accepted).toFixed(2),
  };
}

describe('landed cost — the worked examples', () => {
  it('A: partial receipts, loss as planned — both at ₹22.53 and nothing left over', () => {
    const plan = single(1000, 950);
    const first = receiveSingle(plan, 500, 1000, 10, 12);
    expect(first).toMatchObject({
      need: '526.3158',
      material: '5263.16',
      charge: '6000.00',
      perUnit: '22.53',
    });
    const second = receiveSingle(plan, 450, 1000 - 526.3158, 10, 12);
    expect(second).toMatchObject({
      need: '473.6842',
      material: '4736.84',
      charge: '5400.00',
      perUnit: '22.53',
    });
    expect(d(1000).minus(first.used).minus(second.used).toString()).toBe('0');
  });

  it('B: more loss than planned leaves 31.5789 m at the processor', () => {
    const plan = single(1000, 950);
    const first = receiveSingle(plan, 500, 1000, 10, 12);
    const second = receiveSingle(plan, 420, 1000 - 526.3158, 10, 12);
    expect(second).toMatchObject({ need: '442.1053', perUnit: '22.53' });
    expect(d(1000).minus(first.used).minus(second.used).toString()).toBe('31.5789');
  });

  it('C: less loss than planned is capped at what is outstanding, with a warning', () => {
    const second = receiveSingle(single(1000, 950), 460, 473.6842, 10, 12);
    expect(second).toMatchObject({
      need: '484.2105',
      used: '473.6842',
      capped: ['cotton'],
      perUnit: '22.30',
    });
  });

  it('D: several inputs and several composites — values follow the fabric, conserved to the paisa', () => {
    const plan: CostPlan = {
      inputs: [
        { itemId: 'cotton', plannedQty: d(1000) },
        { itemId: 'silk', plannedQty: d(1000) },
      ],
      outputs: [
        {
          itemId: 'redCotton',
          expectedQty: d(712.5),
          components: [{ componentItemId: 'cotton', qtyPerUnit: d(1) }],
        },
        {
          itemId: 'redSilk',
          expectedQty: d(950),
          components: [{ componentItemId: 'silk', qtyPerUnit: d(1) }],
        },
        {
          itemId: 'greenCotton',
          expectedQty: d(237.5),
          components: [{ componentItemId: 'cotton', qtyPerUnit: d(1) }],
        },
      ],
    };
    const returned = [
      { itemId: 'redCotton', acceptedQty: d(300), reworkQty: d(0) },
      { itemId: 'redSilk', acceptedQty: d(200), reworkQty: d(0) },
      { itemId: 'greenCotton', acceptedQty: d(100), reworkQty: d(0) },
    ];
    const needs = needTable(plan, ['cotton', 'silk'], returned, false);
    const { used } = usedByItem(
      needs,
      ['cotton', 'silk'],
      new Map(),
      new Map([
        ['cotton', d(1000)],
        ['silk', d(1000)],
      ]),
    );
    const consumed = new Map([
      ['cotton', used.get('cotton')!.times(10).toDecimalPlaces(4)],
      ['silk', used.get('silk')!.times(20).toDecimalPlaces(4)],
    ]);
    const material = materialByOutput(needs, consumed);
    const rates = { redCotton: 12, redSilk: 12, greenCotton: 25 } as const;
    const totals = returned.map((row) => {
      const { acceptedValue } = outputValues(
        material.get(row.itemId)!,
        d(rates[row.itemId as keyof typeof rates]),
        row.acceptedQty,
        row.reworkQty,
      );
      return Number(acceptedValue);
    });

    // To the nearest ten paisa: the plan's hand figures round 315.7895 m × ₹10 at
    // the half-paisa differently from the split, which lands Red Cotton at 6,757.8955.
    // What must be exact is the conservation below.
    expect(totals[0]).toBeCloseTo(6757.89, 1);
    expect(totals[1]).toBeCloseTo(6610.53, 1);
    expect(totals[2]).toBeCloseTo(3552.63, 1);
    const materialSum = [...material.values()].reduce((sum, v) => sum.plus(v), d(0));
    const consumedSum = [...consumed.values()].reduce((sum, v) => sum.plus(v), d(0));
    expect(materialSum.toString()).toBe(consumedSum.toString());
  });

  it('E: a composite of a composite — fabric and buttons each take their own ratio', () => {
    const plan: CostPlan = {
      inputs: [
        { itemId: 'redCotton', plannedQty: d(150) },
        { itemId: 'buttons', plannedQty: d(588) },
      ],
      outputs: [
        {
          itemId: 'shirt',
          expectedQty: d(98),
          components: [
            { componentItemId: 'redCotton', qtyPerUnit: d(1.5) },
            { componentItemId: 'buttons', qtyPerUnit: d(6) },
          ],
        },
      ],
    };
    const returned = [{ itemId: 'shirt', acceptedQty: d(98), reworkQty: d(0) }];
    const needs = needTable(plan, ['redCotton', 'buttons'], returned, false);
    expect(needs.get('redCotton')!.get('shirt')!.toString()).toBe('150');
    expect(needs.get('buttons')!.get('shirt')!.toString()).toBe('588');

    const consumed = new Map([
      ['redCotton', d(150).times('22.5263').toDecimalPlaces(4)],
      ['buttons', d(588)],
    ]);
    const material = materialByOutput(needs, consumed).get('shirt')!;
    const { acceptedValue } = outputValues(material, d(40), d(98), d(0));
    expect(acceptedValue.dividedBy(98).toFixed(2)).toBe('80.48');
  });

  it('F: a unit change with no composite — metres drawn per panel through planned ÷ expected', () => {
    const plan: CostPlan = {
      inputs: [{ itemId: 'cotton', plannedQty: d(1000) }],
      outputs: [{ itemId: 'dyed', expectedQty: d(1200), components: [] }],
    };
    const first = receiveSingle(plan, 600, 1000, 10, 2);
    expect(first).toMatchObject({ need: '500', perUnit: '10.33' });
    const second = receiveSingle(plan, 580, 500, 10, 2);
    expect(second).toMatchObject({ need: '483.3333', perUnit: '10.33' });
    expect(d(1000).minus(first.used).minus(second.used).toString()).toBe('16.6667');
  });

  it('G: a typed Used figure wins, and the next receipt is capped by what is left', () => {
    const plan = single(1000, 950);
    const first = receiveSingle(plan, 500, 1000, 10, 12, 540);
    expect(first).toMatchObject({ used: '540', perUnit: '22.80' });
    const second = receiveSingle(plan, 450, 460, 10, 12);
    expect(second).toMatchObject({ used: '460', capped: ['cotton'], perUnit: '22.22' });
  });
});

describe('landed cost — the rules around the examples', () => {
  it('charges rework nothing, and splits the material by quantity', () => {
    const { charge, acceptedValue, reworkValue } = outputValues(d(1000), d(12), d(450), d(50));
    expect(charge.toString()).toBe('5400');
    expect(acceptedValue.toString()).toBe('6300');
    expect(reworkValue.toString()).toBe('100');
  });

  it('draws a rework receipt from the output item itself, one for one', () => {
    const plan = single(1000, 950);
    expect(drawPerUnit(plan, 'dyed', 'dyed', true).toString()).toBe('1');
    const needs = needTable(
      plan,
      ['dyed'],
      [{ itemId: 'dyed', acceptedQty: d(40), reworkQty: d(10) }],
      true,
    );
    expect(needs.get('dyed')!.get('dyed')!.toString()).toBe('50');
  });

  it('lets an output that is one of the inputs draw on itself alone', () => {
    const plan: CostPlan = {
      inputs: [
        { itemId: 'fabric', plannedQty: d(100) },
        { itemId: 'detergent', plannedQty: d(5) },
      ],
      outputs: [{ itemId: 'fabric', expectedQty: d(98), components: [] }],
    };
    expect(drawPerUnit(plan, 'fabric', 'fabric', false).toString()).toBe('1');
    expect(drawPerUnit(plan, 'fabric', 'detergent', false).toString()).toBe('0');
  });

  it('reports a typed input nothing on the receipt draws on', () => {
    const plan = single(1000, 950);
    const needs = needTable(plan, ['cotton'], [], false);
    const { undrawn } = usedByItem(needs, ['cotton'], new Map([['cotton', d(5)]]), noOutstanding);
    expect(undrawn).toEqual(['cotton']);
  });
});
