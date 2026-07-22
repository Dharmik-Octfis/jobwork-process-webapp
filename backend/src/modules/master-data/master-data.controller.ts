import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../../db/prisma.ts';

export async function getMasterData(_req: Request, res: Response, next: NextFunction) {
  try {
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

    res.status(200).json({ industries, states, countries });
  } catch (error) {
    next(error);
  }
}
