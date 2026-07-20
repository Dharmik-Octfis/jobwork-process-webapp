import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../../db/prisma.ts';

export async function getMasterData(_req: Request, res: Response, next: NextFunction) {
  try {
    const [industries, states] = await Promise.all([
      prisma.industry.findMany({
        where: { isActive: true },
        select: { id: true, code: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.state.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          cities: {
            where: { isActive: true },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
          },
        },
        orderBy: { name: 'asc' },
      }),
    ]);

    const countries = [
      { id: 'ind', name: 'India', code: '+91', isoCode: 'IND' },
      { id: 'usa', name: 'United States', code: '+1', isoCode: 'USA' },
      { id: 'gbr', name: 'United Kingdom', code: '+44', isoCode: 'GBR' },
      { id: 'aus', name: 'Australia', code: '+61', isoCode: 'AUS' },
      { id: 'can', name: 'Canada', code: '+1', isoCode: 'CAN' },
      { id: 'chn', name: 'China', code: '+86', isoCode: 'CHN' },
      { id: 'fra', name: 'France', code: '+33', isoCode: 'FRA' },
      { id: 'deu', name: 'Germany', code: '+49', isoCode: 'DEU' },
    ];

    res.status(200).json({ industries, states, countries });
  } catch (error) {
    next(error);
  }
}
