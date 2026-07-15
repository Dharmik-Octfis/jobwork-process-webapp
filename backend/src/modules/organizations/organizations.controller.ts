import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { prisma } from '../../db/prisma.ts';
import { createOrganizationSchema, updateOrganizationSchema } from './organizations.schemas.ts';

export async function createOrganization(req: Request, res: Response, next: NextFunction) {
  try {
    const parsedData = createOrganizationSchema.safeParse(req.body);
    if (!parsedData.success) {
      res.status(400).json({ errors: parsedData.error.issues });
      return;
    }
    const data = parsedData.data;

    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const organization = await prisma.organization.create({
      data: {
        id: crypto.randomUUID(),
        ...data,
        memberships: {
          create: {
            userId,
            role: 'owner',
          },
        },
      },
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
        memberships: {
          some: {
            userId,
          },
        },
      },
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
      where: { userId, organizationId: orgId, role: 'owner' }
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

    const updatedOrg = await prisma.organization.update({
      where: { id: orgId },
      data: parsedData.data,
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
      where: { userId, organizationId: orgId, role: 'owner' }
    });

    if (!membership) {
      res.status(403).json({ message: 'Forbidden: Only owners can delete this organization' });
      return;
    }

    await prisma.organization.delete({
      where: { id: orgId }
    });

    res.status(200).json({ message: 'Organization deleted successfully' });
  } catch (error) {
    next(error);
  }
}
