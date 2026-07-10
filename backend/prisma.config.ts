import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI config (Prisma 7). The datasource URL lives here, not in
 * `schema.prisma`. `schema` points at a *folder* so models can be split by
 * domain — architecture §3.4.
 */
export default defineConfig({
  schema: 'prisma/schema',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
  },
});
