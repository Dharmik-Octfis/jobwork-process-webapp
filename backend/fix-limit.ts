import { Client } from 'pg';
import 'dotenv/config';

async function main() {
  const dbUrl = new URL(process.env.MIGRATE_DATABASE_URL!);
  dbUrl.searchParams.delete('sslmode');
  
  const client = new Client({ 
    connectionString: dbUrl.toString(),
    ssl: { rejectUnauthorized: false } 
  });
  await client.connect();
  
  try {
    console.log('Altering table organizations...');
    await client.query(`ALTER TABLE organizations ALTER COLUMN max_users_limit DROP NOT NULL;`);
    await client.query(`ALTER TABLE organizations ALTER COLUMN max_users_limit DROP DEFAULT;`);
    
    console.log('Setting max_users_limit to NULL...');
    const result = await client.query(`UPDATE organizations SET max_users_limit = NULL;`);
    console.log(`Success! Updated ${result.rowCount} organizations. max_users_limit is now NULL.`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
