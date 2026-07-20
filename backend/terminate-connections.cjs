const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:yNklP8Fvt9LtKr4vQlRe@jobwork-db-dev.cbg4usg0surg.ap-south-1.rds.amazonaws.com:5432/jobwork_dev?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

client.connect().then(() => {
  return client.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid != pg_backend_pid();");
}).then(() => {
  console.log('Remote connections terminated');
  process.exit(0);
}).catch(e => {
  console.error(e);
  process.exit(1);
});
