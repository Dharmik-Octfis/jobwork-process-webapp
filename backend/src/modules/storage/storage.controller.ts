import type { Request, Response, NextFunction } from 'express';
import { getFileUrl } from '../../lib/storage.ts';

export async function proxyFile(req: Request, res: Response, next: NextFunction) {
  try {
    const { key } = req.query;
    if (!key || typeof key !== 'string') {
      res.status(400).send('Missing key');
      return;
    }
    
    // Basic validation to prevent arbitrary proxying
    if (!key.startsWith('users/') && !key.startsWith('organizations/') && !key.startsWith('items/')) {
      res.status(403).send('Forbidden key prefix');
      return;
    }

    const signedUrl = await getFileUrl(key);
    const response = await fetch(signedUrl);

    if (!response.ok) {
      res.status(response.status).send('Failed to fetch file from storage');
      return;
    }

    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }
    const cacheControl = response.headers.get('cache-control');
    if (cacheControl) {
      res.setHeader('Cache-Control', cacheControl);
    } else {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }

    const arrayBuffer = await response.arrayBuffer();
    res.end(Buffer.from(arrayBuffer));
  } catch (error) {
    next(error);
  }
}
