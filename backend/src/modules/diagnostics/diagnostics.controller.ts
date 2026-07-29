import type { Request, Response } from 'express';
import { sendSuccess } from '../../lib/apiResponse.ts';
import { collectDiagnostics } from './diagnostics.service.ts';

/**
 * No try/catch — Express 5 forwards a rejected promise to `errorHandler`, which
 * produces the standard envelope. See CLAUDE.md "API responses".
 */
export const getLatencyReport = async (_req: Request, res: Response) => {
  const report = await collectDiagnostics();
  sendSuccess(res, report, 'Latency probe complete.');
};
