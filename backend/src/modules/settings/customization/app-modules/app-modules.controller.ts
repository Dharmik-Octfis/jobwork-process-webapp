import type { Request, Response } from 'express';
import { prisma } from '../../../../db/prisma.ts';
import { sendSuccess } from '../../../../lib/apiResponse.ts';
import type { AppModule } from '../../../../../generated/prisma/client.ts';

export type AppModuleNode = AppModule & {
  children: AppModuleNode[];
};

// No try/catch — a rejected promise goes to `errorHandler`, which logs it and
// returns the standard envelope. The previous catch swallowed the real error and
// replaced it with a bare "Internal Server Error", losing the stack for the logs.
export const getAppModules = async (_req: Request, res: Response) => {
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

  sendSuccess(res, roots);
};
