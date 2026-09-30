/**
 * Every report the Reports Center lists. Reports are code — a page, an endpoint
 * and a query ship together in a deploy — so the list lives here, not in a table.
 * Adding a report is one entry here plus its page and route.
 *
 * 🔴 `key` is stored in `report_user_states.report_key` (last visited, favourite).
 * Change `name`, `category` or `path` freely; changing a `key` orphans every
 * user's history for that report unless the same commit ships a migration that
 * rewrites `report_key`. Keys use snake_case so they can never be mistaken for —
 * or route-collide with — the kebab-case report paths under `/reports/*`.
 */
export interface ReportDef {
  key: string;
  name: string;
  category: string;
  /** Page path under `/organizations/:orgId/reports/`. */
  path: string;
}

export const REPORTS = [
  {
    key: 'stock_summary',
    name: 'Stock Summary Report',
    category: 'Inventory',
    path: 'stock-summary',
  },
  {
    key: 'inventory_valuation_summary',
    name: 'Inventory Valuation Summary',
    category: 'Inventory',
    path: 'inventory-valuation-summary',
  },
  {
    key: 'fifo_cost_lot_tracking',
    name: 'FIFO Cost Lot Tracking',
    category: 'Inventory',
    path: 'fifo-cost-lot-tracking',
  },
  {
    key: 'job_order_loss',
    name: 'Job Order Loss Report',
    category: 'Job Work',
    path: 'job-order-loss',
  },
  {
    key: 'batch_report',
    name: 'Batch Report',
    category: 'Inventory',
    path: 'batch',
  },
  {
    key: 'taka_report',
    name: 'Taka Report',
    category: 'Inventory',
    path: 'taka',
  },
  {
    key: 'jobwork_challan_register',
    name: 'Jobwork Challan Register',
    category: 'Job Work',
    path: 'jobwork-challans',
  },
  {
    key: 'job_order_report',
    name: 'Job Order Report (Ledger View)',
    category: 'Job Work',
    path: 'job-orders',
  },
] as const satisfies readonly ReportDef[];

export type ReportKey = (typeof REPORTS)[number]['key'];

const REPORT_KEYS: ReadonlySet<string> = new Set(REPORTS.map((r) => r.key));

export function isReportKey(value: string): value is ReportKey {
  return REPORT_KEYS.has(value);
}
