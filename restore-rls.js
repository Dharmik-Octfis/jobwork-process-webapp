const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(__dirname, 'backend', 'prisma', 'migrations');
const files = fs.readdirSync(migrationsDir).filter(f => fs.statSync(path.join(migrationsDir, f)).isDirectory());

let rlsSql = '';
for (const dir of files) {
  const sqlPath = path.join(migrationsDir, dir, 'migration.sql');
  if (fs.existsSync(sqlPath)) {
    const content = fs.readFileSync(sqlPath, 'utf8');
    const lines = content.split('\n');
    let capturing = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('ENABLE ROW LEVEL SECURITY')) {
        // Find the table name
        const match = lines[i].match(/ALTER TABLE "?([a-zA-Z0-9_]+)"? ENABLE ROW LEVEL SECURITY/i);
        if (match) {
          rlsSql += `DROP POLICY IF EXISTS "tenant_isolation" ON "${match[1]}";\n`;
          rlsSql += `DROP POLICY IF EXISTS "Tenant isolation" ON "${match[1]}";\n`;
        }
        capturing = true;
      }
      if (capturing) {
        rlsSql += lines[i] + '\n';
        if (lines[i].includes(';') && !lines[i].includes('ENABLE ROW LEVEL SECURITY')) {
           capturing = false;
        }
      }
    }
  }
}

fs.writeFileSync('all_rls.sql', rlsSql);
