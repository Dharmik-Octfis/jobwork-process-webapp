import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { prisma, runAsTenant } from '../../../../db/prisma.ts';
import { createOrganizationSchema, updateOrganizationSchema } from './organizations.schemas.ts';
import { seedSystemTemplates } from '../permission-templates/permission-templates.service.ts';

export async function createOrganization(req: Request, res: Response, next: NextFunction) {
  try {
    const parsedData = createOrganizationSchema.safeParse(req.body);
    if (!parsedData.success) {
      res.status(400).json({ errors: parsedData.error.issues });
      return;
    }
    const data = parsedData.data;
    // Empty select -> null so the state_code / city_id FKs are cleared, not fed ''
    // (which is not a valid uuid and matches no state).
    if (!data.stateCode) data.stateCode = null;
    if (!data.cityId) data.cityId = null;

    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
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

      // Seed the immutable Owner/Admin/Member templates, then make the creator an
      // Owner pointing at the Owner template (all permissions, computed).
      const { ownerTemplateId } = await seedSystemTemplates(tx, orgId, userId);

      await tx.membership.create({
        data: {
          userId,
          organizationId: orgId,
          role: 'owner',
          permissionTemplateId: ownerTemplateId,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      return created;
    });

    res.status(201).json(organization);
  } catch (error) {
    next(error);
  }
}

export async function getOrganizations(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
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

    res.status(200).json(organizations);
  } catch (error) {
    next(error);
  }
}

export async function updateOrganization(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    const orgId = req.params.id as string;
    if (!userId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const membership = await prisma.membership.findFirst({
      where: {
        userId,
        organizationId: orgId,
        role: 'owner',
        isDeleted: false,
        organization: { isDeleted: false },
      },
    });

    if (!membership) {
      res.status(403).json({ message: 'Forbidden: Only owners can update this organization' });
      return;
    }

    const parsedData = updateOrganizationSchema.safeParse(req.body);
    if (!parsedData.success) {
      res.status(400).json({ errors: parsedData.error.issues });
      return;
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

    res.status(200).json(updatedOrg);
  } catch (error) {
    next(error);
  }
}

export async function deleteOrganization(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    const orgId = req.params.id as string;
    if (!userId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const membership = await prisma.membership.findFirst({
      where: {
        userId,
        organizationId: orgId,
        role: 'owner',
        isDeleted: false,
        organization: { isDeleted: false },
      },
    });

    if (!membership) {
      res.status(403).json({ message: 'Forbidden: Only owners can delete this organization' });
      return;
    }

    // Soft delete: keep the row, flip isDeleted, and record who removed it.
    // getOrganizations filters isDeleted=false, so it disappears from listings.
    await prisma.organization.update({
      where: { id: orgId },
      data: { isDeleted: true, updatedBy: userId },
    });

    res.status(200).json({ message: 'Organization deleted successfully' });
  } catch (error) {
    next(error);
  }
}
