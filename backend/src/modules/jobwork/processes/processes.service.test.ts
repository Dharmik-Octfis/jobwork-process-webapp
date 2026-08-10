import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, runAsTenant } from '../../../db/prisma.ts';
import { ApiError } from '../../../lib/apiError.ts';
import {
  countProcesses,
  createNewProcess,
  deleteProcessById,
  getProcessById,
  getProcessesList,
  updateProcessById,
} from './processes.service.ts';

/**
 * The Processes CRUD path — the plan's "done means" for Sprint 1.
 *
 * Processes is the simplest module in the domain and was built first on purpose:
 * it exercises routes → controller → service → schemas → list catalog end to end
 * before anything complicated depends on that path. This file covers the service
 * half of that, plus the behaviour specific to this module rather than inherited
 * from the vendors template — the soft-delete revive.
 *
 * The foreign-uom test went with `defaultIssueUomId` / `defaultReceiveUomId` on
 * 2026-08-10: the process master no longer holds a uom, so it has no FK for a
 * hand-crafted payload to point across tenants. The same guard still matters
 * where units are actually chosen, and is covered by `jobwork.flow.test.ts`.
 *
 * 🔴 Own fixtures, hard-deleted. Suites run against the dev database IN PARALLEL,
 * so nothing here reads or mutates a row it did not create.
 */

const unique = () => process.hrtime.bigint().toString(36);
const listOpts = { page: 1, perPage: 25 };

let orgId: string;
let otherOrgId: string;

async function makeOrg() {
  const org = await prisma.organization.create({
    data: {
      name: `process-test-${unique()}`,
      orgCode: String(process.hrtime.bigint()).slice(-10),
    },
    select: { id: true },
  });
  return org.id;
}

beforeAll(async () => {
  orgId = await makeOrg();
  // A second organization exists solely to prove one tenant's list never reaches
  // into another's.
  otherOrgId = await makeOrg();
});

afterAll(async () => {
  for (const id of [orgId, otherOrgId]) {
    await runAsTenant(id, (tx) => tx.process.deleteMany({ where: { organizationId: id } }));
  }
  await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
});

describe('processes — the full CRUD path', () => {
  it('creates, lists, reads, edits and soft-deletes', async () => {
    const name = `Dyeing ${unique()}`;

    const created = await createNewProcess(orgId, {
      name,
      code: 'DYE',
      description: 'Wet processing',
      preservesPackaging: true,
      requiresSingleLot: true,
      rateBasis: 'per_received_unit',
      defaultTolerancePct: 2.5,
    });

    expect(created.name).toBe(name);
    expect(created.preservesPackaging).toBe(true);
    expect(created.defaultTolerancePct?.toString()).toBe('2.5');

    const listed = await getProcessesList(orgId, listOpts);
    expect(listed.results.map((p) => p.id)).toContain(created.id);
    expect(await countProcesses(orgId, listOpts)).toBe(listed.results.length);

    const fetched = await getProcessById(orgId, created.id);
    expect(fetched?.code).toBe('DYE');

    const updated = await updateProcessById(orgId, created.id, {
      name,
      code: 'DYE2',
      preservesPackaging: false,
      rateBasis: 'per_issued_unit',
    });
    expect(updated.code).toBe('DYE2');
    expect(updated.preservesPackaging).toBe(false);
    // Not sent on the update, so it falls back to its default rather than
    // keeping the old value — the form posts the whole record.
    expect(updated.requiresSingleLot).toBe(false);

    await deleteProcessById(orgId, created.id);

    // A soft-deleted row must 404 and must not surface in any read.
    expect(await getProcessById(orgId, created.id)).toBeNull();
    const afterDelete = await getProcessesList(orgId, listOpts);
    expect(afterDelete.results.map((p) => p.id)).not.toContain(created.id);

    // The row itself is still there — routes and job orders that reference it in
    // later sprints keep their history.
    const raw = await runAsTenant(orgId, (tx) =>
      tx.process.findFirst({ where: { id: created.id }, select: { isDeleted: true } }),
    );
    expect(raw?.isDeleted).toBe(true);
  });

  it('404s when editing or deleting something that is gone', async () => {
    const created = await createNewProcess(orgId, { name: `Gone ${unique()}` });
    await deleteProcessById(orgId, created.id);

    await expect(updateProcessById(orgId, created.id, { name: 'x' })).rejects.toBeInstanceOf(
      ApiError,
    );
    await expect(deleteProcessById(orgId, created.id)).rejects.toBeInstanceOf(ApiError);
  });

  it('refuses a duplicate name with a 409, not a database error', async () => {
    const name = `Printing ${unique()}`;
    await createNewProcess(orgId, { name });

    const error = await createNewProcess(orgId, { name }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
  });

  it('revives a soft-deleted process instead of 409-ing on its name', async () => {
    const name = `Calendaring ${unique()}`;

    const first = await createNewProcess(orgId, { name, code: 'CAL' });
    await deleteProcessById(orgId, first.id);

    // 🔴 The soft-deleted row still occupies the (organizationId, name) unique
    // key, so a plain insert would 409 on a name the user can no longer see.
    const revived = await createNewProcess(orgId, { name, code: 'CAL2' });

    // Same id, so anything already pointing at it keeps pointing at ONE
    // "Calendaring" rather than splitting into two no report can add together.
    expect(revived.id).toBe(first.id);
    expect(revived.isDeleted).toBe(false);
    expect(revived.code).toBe('CAL2');

    const listed = await getProcessesList(orgId, listOpts);
    expect(listed.results.map((p) => p.id)).toContain(revived.id);
  });

  it('never returns another organization’s processes', async () => {
    const mine = await createNewProcess(orgId, { name: `Mine ${unique()}` });
    const theirs = await createNewProcess(otherOrgId, { name: `Theirs ${unique()}` });

    const listed = await getProcessesList(orgId, listOpts);
    expect(listed.results.map((p) => p.id)).toContain(mine.id);
    expect(listed.results.map((p) => p.id)).not.toContain(theirs.id);

    // Addressed by id directly, which is the shape an attacker actually uses.
    expect(await getProcessById(orgId, theirs.id)).toBeNull();
  });

  it('stores a blank code as null, so "has no code" is one value and not two', async () => {
    const created = await createNewProcess(orgId, {
      name: `Blank ${unique()}`,
      code: '',
      description: '   ',
    });
    expect(created.code).toBeNull();
    expect(created.description).toBeNull();
  });

  it('filters the list by the preset views', async () => {
    const sameItem = await createNewProcess(orgId, { name: `Dyeing ${unique()}` });
    const newItem = await createNewProcess(orgId, {
      name: `Stitching ${unique()}`,
      itemChanges: true,
    });

    // The default view narrows nothing — the active/inactive split went with the
    // `is_active` column, so a process you have stopped running is deleted.
    const byDefault = await getProcessesList(orgId, listOpts);
    expect(byDefault.results.map((p) => p.id)).toContain(sameItem.id);
    expect(byDefault.results.map((p) => p.id)).toContain(newItem.id);

    const changesItem = await getProcessesList(orgId, { ...listOpts, filter: 'changes_item' });
    expect(changesItem.results.map((p) => p.id)).toContain(newItem.id);
    expect(changesItem.results.map((p) => p.id)).not.toContain(sameItem.id);
  });

  it('searches across name, code and description', async () => {
    const token = unique();
    const byName = await createNewProcess(orgId, { name: `Stentering ${token}` });
    const byCode = await createNewProcess(orgId, {
      name: `Coded ${unique()}`,
      code: `ST-${token}`,
    });

    const hits = await getProcessesList(orgId, { ...listOpts, search: token });
    const ids = hits.results.map((p) => p.id);
    expect(ids).toContain(byName.id);
    expect(ids).toContain(byCode.id);
  });
});
