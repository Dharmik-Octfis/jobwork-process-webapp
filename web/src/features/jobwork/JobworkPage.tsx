import { JobOrdersList } from './job-orders/JobOrdersList';

/**
 * What `/organizations/:orgId/jobwork` shows.
 *
 * Job Orders, not Processes. The job order is the document people open this
 * module to look at — a process master is something you set up once and rarely
 * revisit, and landing on it makes the module look like a settings screen. Same
 * shape as `PurchasesPage`, which lands on Purchase Orders.
 */
export function JobworkPage() {
  return <JobOrdersList />;
}
