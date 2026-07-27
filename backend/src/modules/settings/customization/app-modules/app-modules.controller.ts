import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { prisma } from '../../../../db/prisma.ts';
import type { ApiEnvelope } from '../../../../lib/apiResponse.ts';
import { createMemoryCache } from '../../../../lib/memoryCache.ts';
import type { AppModule } from '../../../../../generated/prisma/client.ts';

export type AppModuleNode = AppModule & {
  children: AppModuleNode[];
};

/**
 * The sidebar's module tree. Cached in instance memory (L1) for the same reason
 * as `seed-data.controller.ts`: `app_modules` is a master-data reference table,
 * so it changes on a deploy or a reseed, never through a user action — there is
 * no invalidation to coordinate between instances.
 *
 * A hit skips the query, the tree construction, AND the `JSON.stringify`, since
 * the serialized envelope is what gets stored. See the longer note in
 * `seed-data.controller.ts` for why that is worth doing and why this controller
 * writes the envelope itself rather than calling `sendSuccess`.
 */

interface CachedResponse {
  body: string;
  etag: string;
}

const MODULES_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_KEY = 'modules:tree';

const modulesCache = createMemoryCache<CachedResponse>({ ttlMs: MODULES_TTL_MS, maxEntries: 1 });

/** Exported for tests and for any future admin path that edits `app_modules`. */
export function invalidateAppModulesCache(): void {
  modulesCache.clear();
}

async function buildTree(): Promise<AppModuleNode[]> {
  const allModules = await prisma.appModule.findMany({
    where: { isActive: true },
    orderBy: { sortIndex: 'asc' },
  });

  const moduleMap = new Map<string, AppModuleNode>();
  const roots: AppModuleNode[] = [];

  for (const mod of allModules) {
    moduleMap.set(mod.id, { ...mod, children: [] });
  }

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

  return roots;
}

async function getCachedResponse(): Promise<CachedResponse> {
  const hit = modulesCache.get(CACHE_KEY);
  if (hit) return hit;

  const roots = await buildTree();

  // Annotated so it stays byte-identical to `sendSuccess` output.
  const envelope: ApiEnvelope<AppModuleNode[]> = {
    statusCode: 200,
    message: 'Success',
    data: roots,
  };
  const body = JSON.stringify(envelope);

  const fresh: CachedResponse = {
    body,
    etag: `"${createHash('sha1').update(body).digest('base64url')}"`,
  };
  modulesCache.set(CACHE_KEY, fresh);
  return fresh;
}

// No try/catch — a rejected promise goes to `errorHandler`, which logs it and
// returns the standard envelope. The previous catch swallowed the real error and
// replaced it with a bare "Internal Server Error", losing the stack for the logs.
export const getAppModules = async (req: Request, res: Response) => {
  const { body, etag } = await getCachedResponse();

  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'private, max-age=3600');

  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }

  res.type('application/json').send(body);
};
