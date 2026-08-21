import { prisma } from './db/prisma.ts';

export async function fixRls() {
  console.log('Applying RLS fix...');
  try {
    await prisma.$executeRawUnsafe(`
      DROP POLICY IF EXISTS "tenant_isolation" ON "composite_item_components";
      CREATE POLICY "tenant_isolation" ON "composite_item_components" AS PERMISSIVE FOR ALL TO public USING ((organization_id = (current_setting('app.current_tenant'::text, true))::uuid));

      DROP POLICY IF EXISTS "tenant_isolation" ON "item_assemblies";
      CREATE POLICY "tenant_isolation" ON "item_assemblies" AS PERMISSIVE FOR ALL TO public USING ((organization_id = (current_setting('app.current_tenant'::text, true))::uuid));

      DROP POLICY IF EXISTS "tenant_isolation" ON "item_assembly_lines";
      CREATE POLICY "tenant_isolation" ON "item_assembly_lines" AS PERMISSIVE FOR ALL TO public USING ((organization_id = (current_setting('app.current_tenant'::text, true))::uuid));
    `);
    console.log('✅ RLS fix applied successfully.');
  } catch (err) {
    console.error('❌ Failed to apply RLS fix', err);
  }
}
