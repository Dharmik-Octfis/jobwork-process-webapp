import type { Request, Response } from 'express';
import { sendSuccess } from '../../../../lib/apiResponse.ts';
import { ApiError } from '../../../../lib/apiError.ts';
import { listQuerySchema } from '../../../../lib/pagination.ts';
import {
  countOrgUsers,
  getMember,
  getMyProfile,
  listOrgUsers,
  removeMember,
  updateMember,
  updateMyProfile,
} from './members.service.ts';
import type { UpdateMemberInput, UpdateMyProfileInput } from './members.schemas.ts';

// No try/catch: Express 5 forwards a rejected promise from an async handler
// straight to `errorHandler`, the single place an error becomes a response.
// Catching here only to re-`next(error)` adds noise and nothing else.

/**
 * Query strings are parsed here rather than by `validateBody`, which reads
 * `req.body` — and Express 5's `req.query` is a read-only getter, so it cannot be
 * reassigned by a middleware either. Same failure shape as `validateBody`:
 * field-keyed `details` beside the message.
 */
function parseListQuery(req: Request) {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw ApiError.badRequest(
      'Invalid list query.',
      Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.') || 'query', i.message])),
    );
  }
  return parsed.data;
}

/** GET /members?filter=…&search=…&page=…&perPage=… → `{ results, pageContext }` */
export async function getMembers(req: Request, res: Response): Promise<void> {
  const result = await listOrgUsers(req.tenantId!, parseListQuery(req));
  sendSuccess(res, result);
}

/** GET /members/count — the opt-in total behind the "Total count: view" link.
 * Separate from the list because `COUNT(*)` over a filtered set is the most
 * expensive part of the page and is only needed when someone asks for it. */
export async function getMembersCount(req: Request, res: Response): Promise<void> {
  const total = await countOrgUsers(req.tenantId!, parseListQuery(req));
  sendSuccess(res, { total });
}

/** GET /members/me — the caller's own record in this organization. Mounted BEFORE
 * `/:id` in the router, or "me" is parsed as a membership id. */
export async function getMe(req: Request, res: Response): Promise<void> {
  const me = await getMyProfile(req.user!.id, req.tenantId!);
  sendSuccess(res, me);
}

/**
 * PUT /members/me — edit your own name and contact details in this organization.
 *
 * Ungated by design (see `updateMyProfileSchema`). The schema is what keeps it
 * safe: role, permission template and active state are not accepted here, so this
 * route cannot escalate anything.
 */
export async function putMe(req: Request, res: Response): Promise<void> {
  const input = req.body as UpdateMyProfileInput;
  const updated = await updateMyProfile(req.user!.id, req.tenantId!, input);
  sendSuccess(res, updated, 'Your details have been updated.');
}

export async function getMemberById(req: Request, res: Response): Promise<void> {
  const member = await getMember(req.tenantId!, req.params.id as string);
  sendSuccess(res, member);
}

/** PUT /members/:id — profile, job title, access, and/or active state. */
export async function putMember(req: Request, res: Response): Promise<void> {
  const input = req.body as UpdateMemberInput;
  const updated = await updateMember(req.user!.id, req.tenantId!, req.params.id as string, input);

  // The message names what actually changed — "Updated." tells an admin who just
  // deactivated somebody nothing about whether it took.
  const message =
    input.isActive === false
      ? 'User deactivated. They no longer have access to this organization.'
      : input.isActive === true
        ? 'User activated.'
        : input.permissionTemplateId !== undefined && input.roleId !== undefined
          ? 'Role and permissions updated.'
          : input.permissionTemplateId !== undefined
            ? 'Permissions updated.'
            : input.roleId !== undefined
              ? 'Role updated.'
              : 'User details updated.';

  sendSuccess(res, updated, message);
}

export async function deleteMember(req: Request, res: Response): Promise<void> {
  await removeMember(req.user!.id, req.tenantId!, req.params.id as string);
  // 200 with data:null, not 204 — a 204 has no body and so cannot carry the envelope.
  sendSuccess(res, null, 'User removed from this organization.');
}
