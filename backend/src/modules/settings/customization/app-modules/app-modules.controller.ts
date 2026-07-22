import type { Request, Response } from 'express';
import { prisma } from '../../../../db/prisma.ts';
import type { AppModule } from '../../../../../generated/prisma/client.ts';

export type AppModuleNode = AppModule & {
  children: AppModuleNode[];
};

export const getAppModules = async (_req: Request, res: Response) => {
  try {
    const allModules = await prisma.appModule.findMany({
      where: { isActive: true },
      orderBy: { sortIndex: 'asc' },
    });

    // Build the tree
    const moduleMap = new Map<string, AppModuleNode>();
    const roots: AppModuleNode[] = [];

    // Initialize map
    for (const mod of allModules) {
      moduleMap.set(mod.id, { ...mod, children: [] });
    }

    // Build hierarchy
    for (const mod of allModules) {
      if (mod.parentId) {
        const parent = moduleMap.get(mod.parentId);
        if (parent) {
          parent.children.push(moduleMap.get(mod.id)!);
        }
      } else {
        roots.push(moduleMap.get(mod.id)!);
      }
    }

    res.json(roots);
  } catch (error) {
    console.error('Error fetching modules:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};
