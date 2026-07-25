import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { prisma, runAsTenant } from '../../../../db/prisma.ts';
import { ApiError } from '../../../../lib/apiError.ts';
import { sendSuccess } from '../../../../lib/apiResponse.ts';
import { createOrganizationSchema, updateOrganizationSchema } from './organizations.schemas.ts';
import { seedSystemTemplates } from '../permission-templates/permission-templates.service.ts';
import { seedSystemRoles } from '../roles/roles.service.ts';

export async function createOrganization(req: Request, res: Response, next: NextFunction) {
  try {
    const parsedData = createOrganizationSchema.safeParse(req.body);
    if (!parsedData.success) {
      throw ApiError.badRequest('Validation failed', parsedData.error.issues);
    }
    const data = parsedData.data;
    // Empty select -> null so the state_code / city_id FKs are cleared, not fed ''
    // (which is not a valid uuid and matches no state).
    if (!data.stateCode) data.stateCode = null;
    if (!data.cityId) data.cityId = null;

    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Sign in to continue.');
    }

    // The org id is generated up front so the whole bootstrap can run inside a
    // single tenant transaction: permission_templates is RLS-protected, so its
    // INSERTs are only allowed once `app.current_tenant` is set to this org
    // (runAsTenant does that). The organizations table itself is not RLS-gated,
    // so creating it in here is fine.
    const orgId = crypto.randomUUID();

    const organization = await runAsTenant(orgId, async (tx) => {
      const created = await tx.organization.create({
        data: {
          id: orgId,
          ...data,
          // Audit columns: the creating user stamps both created_by and updated_by.
          createdBy: userId,
          updatedBy: userId,
        },
      });

      // Seed the immutable Owner role (a title) and Owner template (the access),
      // then make the creator an owner carrying both. Only these two are seeded:
      // every other title and template is one an admin consciously created.
      const { ownerTemplateId } = await seedSystemTemplates(tx, orgId, userId);
      const { ownerRoleId } = await seedSystemRoles(tx, orgId, userId);

      await tx.membership.create({
        data: {
          userId,
          organizationId: orgId,
          // The one place isOwner is ever set: creating the organization. There is
          // no API that grants it, which is what keeps "one owner per org" true.
          isOwner: true,
          roleId: ownerRoleId,
          permissionTemplateId: ownerTemplateId,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      return created;
    });

    sendSuccess(res, organization, 'Organization created.', 201);
  } catch (error) {
    next(error);
  }
}

export async function getOrganizations(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Sign in to continue.');
    }

    const organizations = await prisma.organization.findMany({
      where: {
        isDeleted: false,
        memberships: {
          some: {
            userId,
          },
        },
      },
      // industryCode is a stable slug; join the label for display.
      include: { industry: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    sendSuccess(res, organizations);
  } catch (error) {
    next(error);
  }
}

export async function updateOrganization(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    // Membership, soft-delete and permission checks all happened in the middleware
    // chain (tenantContext → requirePermission('organization:update')), so the
    // hand-rolled owner lookup that used to live here is gone.
    const orgId = req.tenantId!;
    if (!userId) {
      throw new ApiError(401, 'Sign in to continue.');
    }

    const parsedData = updateOrganizationSchema.safeParse(req.body);
    if (!parsedData.success) {
      throw ApiError.badRequest('Validation failed', parsedData.error.issues);
    }

    const data = parsedData.data;
    // Present-but-empty select -> null (clear the FK); absent -> left undefined so
    // Prisma leaves the column unchanged.
    if (data.stateCode === '') data.stateCode = null;
    if (data.cityId === '') data.cityId = null;

    const updatedOrg = await prisma.organization.update({
      where: { id: orgId },
      data: { ...data, updatedBy: userId },
    });

    sendSuccess(res, updatedOrg, 'Organization updated.');
  } catch (error) {
    next(error);
  }
}

export async function deleteOrganization(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    // `requireOwner` on the route already proved ownership — and unlike the check
    // this replaced, it cannot be satisfied by any permission template.
    const orgId = req.tenantId!;
    if (!userId) {
      throw new ApiError(401, 'Sign in to continue.');
    }

    // Soft delete: keep the row, flip isDeleted, and record who removed it.
    // getOrganizations filters isDeleted=false, so it disappears from listings.
    await prisma.organization.update({
      where: { id: orgId },
      data: { isDeleted: true, updatedBy: userId },
    });

    sendSuccess(res, null, 'Organization deleted successfully');
  } catch (error) {
    next(error);
  }
}
