const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function run() {
  const rlsTestPath = path.join(__dirname, 'src/db/rls.test.ts');
  const rlsTestContent = fs.readFileSync(rlsTestPath, 'utf8');
  const match = rlsTestContent.match(/const TENANT_TABLES = \[([\s\S]*?)\];/);
  const tenantTables = match[1].split(',')
    .map(s => s.trim().replace(/['"]/g, ''))
    .filter(s => s.length > 0 && !s.startsWith('//'));

  const client = new Client({
    connectionString: 'postgresql://jobwork_app:yNklP8Fvt9LtKr4vQlRh@jobwork-db-dev.cbg4usg0surg.ap-south-1.rds.amazonaws.com:5432/jobwork_dev?sslmode=require',
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  const res = await client.query(`
    SELECT relname 
    FROM pg_class 
    WHERE relrowsecurity = false 
      AND relkind = 'r' 
      AND relnamespace = 'public'::regnamespace
  `);
  
  const missingTables = res.rows.map(r => r.relname);
  const missingTenantTables = missingTables.filter(t => tenantTables.includes(t));
  console.log('Missing tenant tables:', missingTenantTables);
  
  let sql = '';
  for (const table of missingTenantTables) {
    sql += `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;\n`;
    sql += `DROP POLICY IF EXISTS "tenant_isolation" ON "${table}";\n`;
    sql += `DROP POLICY IF EXISTS "Tenant isolation" ON "${table}";\n`;
    sql += `CREATE POLICY "tenant_isolation" ON "${table}"\n`;
    
    // Exception for batch_packages which uses batch_id? Wait, there is no batch_packages!
    if (table === 'batch_packages') {
      sql += `  USING (batch_id IN (SELECT id FROM batches WHERE organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid))\n`;
      sql += `  WITH CHECK (batch_id IN (SELECT id FROM batches WHERE organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid));\n`;
    } else if (table === 'item_opening_stock_rows') {
        sql += `  USING (item_id IN (SELECT id FROM items WHERE organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid))\n`;
        sql += `  WITH CHECK (item_id IN (SELECT id FROM items WHERE organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid));\n`;
    } else if (table === 'item_assembly_activities') {
        sql += `  USING (assembly_id IN (SELECT id FROM item_assemblies WHERE organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid))\n`;
        sql += `  WITH CHECK (assembly_id IN (SELECT id FROM item_assemblies WHERE organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid));\n`;
    } else if (table === 'item_assembly_comments') {
        sql += `  USING (assembly_id IN (SELECT id FROM item_assemblies WHERE organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid))\n`;
        sql += `  WITH CHECK (assembly_id IN (SELECT id FROM item_assemblies WHERE organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid));\n`;
    } else if (table === 'item_assembly_lines') {
        sql += `  USING (assembly_id IN (SELECT id FROM item_assemblies WHERE organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid))\n`;
        sql += `  WITH CHECK (assembly_id IN (SELECT id FROM item_assemblies WHERE organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid));\n`;
    } else if (table === 'composite_item_components') {
        sql += `  USING (composite_item_id IN (SELECT id FROM items WHERE organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid))\n`;
        sql += `  WITH CHECK (composite_item_id IN (SELECT id FROM items WHERE organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid));\n`;
    } else if (table === 'job_order_step_input_batches') {
        sql += `  USING (job_order_step_input_id IN (SELECT id FROM job_order_step_inputs WHERE job_order_step_id IN (SELECT id FROM job_order_steps WHERE job_order_id IN (SELECT id FROM job_orders WHERE organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid))))\n`;
        sql += `  WITH CHECK (job_order_step_input_id IN (SELECT id FROM job_order_step_inputs WHERE job_order_step_id IN (SELECT id FROM job_order_steps WHERE job_order_id IN (SELECT id FROM job_orders WHERE organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid))));\n`;
    } else {
        sql += `  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)\n`;
        sql += `  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);\n`;
    }
  }
  
  fs.writeFileSync('missing_rls.sql', sql);
  
  console.log('Wrote missing_rls.sql');
  await client.end();
}
run();
