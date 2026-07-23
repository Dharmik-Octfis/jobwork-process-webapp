import type { Request, Response } from 'express';
import { prisma } from '../../db/prisma.ts';
import { sendSuccess } from '../../lib/apiResponse.ts';

// No try/catch — Express 5 sends a rejected promise to `errorHandler`.
export async function getSeedData(_req: Request, res: Response) {
  const [industries, states, countries] = await Promise.all([
    prisma.industry.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.state.findMany({
      where: { isActive: true },
      select: {
        code: true,
        name: true,
        countryCode: true,
        cities: {
          where: { isActive: true },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.country.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true, isoCode: true, dialCode: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  sendSuccess(res, { industries, states, countries });
}
