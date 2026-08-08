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
 * it exercises routes → controller → service → schemas → list catalog → custom
 * fields end to end before anything complicated depends on that path. This file
 * covers the service half of that, plus the two behaviours that are specific to
 * this module rather than inherited from the vendors template — the soft-delete
 * revive, and refusing a unit of measurement belonging to another organization.
 *
 * 🔴 Own fixtures, hard-deleted. Suites run against the dev database IN PARALLEL,
 * so nothing here reads or mutates a row it did not create.
 */

const unique = () => process.hrtime.bigint().toString(36);
const listOpts = { page: 1, perPage: 25 };

let orgId: string;
let otherOrgId: string;
let uomId: string;
let foreignUomId: string;

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
  // A second organization exists solely to prove a foreign uom id is refused.
  otherOrgId = await makeOrg();

  uomId = await runAsTenant(orgId, async (tx) => {
    const uom = await tx.unitOfMeasurement.create({
      data: { organizationId: orgId, unitName: 'Metre', symbol: 'MTR' },
      select: { id: true },
    });
    return uom.id;
  });

  foreignUomId = await runAsTenant(otherOrgId, async (tx) => {
    const uom = await tx.unitOfMeasurement.create({
      data: { organizationId: otherOrgId, unitName: 'Metre', symbol: 'MTR' },
      select: { id: true },
    });
    return uom.id;
  });
});

afterAll(async () => {
  for (const id of [orgId, otherOrgId]) {
    await runAsTenant(id, async (tx) => {
      await tx.process.deleteMany({ where: { organizationId: id } });
      await tx.unitOfMeasurement.deleteMany({ where: { organizationId: id } });
    });
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
      defaultIssueUomId: uomId,
    });

    expect(created.name).toBe(name);
    expect(created.preservesPackaging).toBe(true);
    expect(created.defaultTolerancePct?.toString()).toBe('2.5');
    // The include is what the list and detail pane render — unit NAMES, not ids.
    expect(created.defaultIssueUom?.unitName).toBe('Metre');

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

  it('refuses a unit of measurement belonging to another organization', async () => {
    // RLS stops another tenant's uom being READ, but a foreign key is checked by
    // Postgres OUTSIDE row-level security — so without the service's own check a
    // hand-crafted payload would link the two organizations' rows successfully.
    await expect(
      createNewProcess(orgId, { name: `Cross ${unique()}`, defaultIssueUomId: foreignUomId }),
    ).rejects.toBeInstanceOf(ApiError);

    const existing = await createNewProcess(orgId, { name: `Cross2 ${unique()}` });
    await expect(
      updateProcessById(orgId, existing.id, {
        name: existing.name,
        defaultReceiveUomId: foreignUomId,
      }),
    ).rejects.toBeInstanceOf(ApiError);
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
    const active = await createNewProcess(orgId, { name: `Active ${unique()}` });
    const inactive = await createNewProcess(orgId, {
      name: `Inactive ${unique()}`,
      isActive: false,
    });

    // The default view is "Active Processes", so an inactive one is absent until
    // asked for by name.
    const byDefault = await getProcessesList(orgId, listOpts);
    expect(byDefault.results.map((p) => p.id)).toContain(active.id);
    expect(byDefault.results.map((p) => p.id)).not.toContain(inactive.id);

    const all = await getProcessesList(orgId, { ...listOpts, filter: 'all_processes' });
    expect(all.results.map((p) => p.id)).toContain(inactive.id);

    const onlyInactive = await getProcessesList(orgId, { ...listOpts, filter: 'inactive' });
    expect(onlyInactive.results.map((p) => p.id)).toEqual([inactive.id]);
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
