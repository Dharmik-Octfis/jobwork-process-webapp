import { runAsTenant } from '../../db/prisma.ts';
import { REPORTS, type ReportDef, type ReportKey } from './reports.catalog.ts';

export interface ReportListEntry extends ReportDef {
  /** null until this user opens the report in this organization. */
  lastVisitedAt: Date | null;
  isFavorite: boolean;
}

export interface ReportUserStateView {
  reportKey: ReportKey;
  lastVisitedAt: Date | null;
  isFavorite: boolean;
}

/**
 * The catalog merged with the caller's own history — one query for all reports,
 * indexed in memory. Rows whose key is no longer in the catalog (a removed or
 * renamed report) are simply never looked up, so they cannot break the list.
 */
export async function listReports(
  organizationId: string,
  userId: string,
): Promise<ReportListEntry[]> {
  const rows = await runAsTenant(organizationId, (tx) =>
    tx.reportUserState.findMany({
      where: { organizationId, userId, isDeleted: false },
      select: { reportKey: true, lastVisitedAt: true, isFavorite: true },
    }),
  );
  const byKey = new Map(rows.map((r) => [r.reportKey, r]));

  return REPORTS.map((report) => {
    const state = byKey.get(report.key);
    return {
      ...report,
      lastVisitedAt: state?.lastVisitedAt ?? null,
      isFavorite: state?.isFavorite ?? false,
    };
  });
}

type StatePatch = { lastVisitedAt: Date } | { isFavorite: boolean };

/**
 * Upsert on (userId, organizationId, reportKey) and clear isDeleted — the same
 * way `listViews.service.ts` lives with a soft-deleted row holding the key.
 */
async function upsertState(
  organizationId: string,
  userId: string,
  reportKey: ReportKey,
  patch: StatePatch,
): Promise<ReportUserStateView> {
  const row = await runAsTenant(organizationId, (tx) =>
    tx.reportUserState.upsert({
      // eslint-disable-next-line @typescript-eslint/naming-convention
      where: { userId_organizationId_reportKey: { userId, organizationId, reportKey } },
      create: { organizationId, userId, reportKey, ...patch, createdBy: userId, updatedBy: userId },
      update: { ...patch, isDeleted: false, updatedBy: userId },
      select: { lastVisitedAt: true, isFavorite: true },
    }),
  );
  return { reportKey, ...row };
}

/** Stamped with the server clock — a client-sent time would be whatever that device thinks. */
export function recordReportVisit(organizationId: string, userId: string, reportKey: ReportKey) {
  return upsertState(organizationId, userId, reportKey, { lastVisitedAt: new Date() });
}

export function setReportFavorite(
  organizationId: string,
  userId: string,
  reportKey: ReportKey,
  isFavorite: boolean,
) {
  return upsertState(organizationId, userId, reportKey, { isFavorite });
}
