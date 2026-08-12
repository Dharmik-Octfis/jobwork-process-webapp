import { prisma } from '../src/db/prisma.ts';

async function main() {
  await prisma.$executeRawUnsafe(`DROP POLICY IF EXISTS "Tenant isolation" ON "item_assembly_activities"`);
  await prisma.$executeRawUnsafe(`
    CREATE POLICY "Tenant isolation" ON "item_assembly_activities"
    USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  `);
  console.log('Policy fixed!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
