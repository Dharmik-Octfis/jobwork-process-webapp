import { prisma } from './db/prisma.ts';
import fs from 'fs';

async function checkRls() {
  try {
    const policies = await prisma.$queryRawUnsafe(`
      SELECT tablename::text, policyname::text, roles::text, cmd::text, qual::text, with_check::text 
      FROM pg_policies 
      WHERE tablename = 'composite_item_components';
    `);
    fs.writeFileSync('rls_output.json', JSON.stringify(policies, (key, value) => 
            typeof value === 'bigint' ? value.toString() : value, 2));
    console.log('--- WROTE RLS POLICIES TO rls_output.json ---');
  } catch (err) {
    console.error('Failed to query policies', err);
    fs.writeFileSync('rls_output.json', JSON.stringify({ error: String(err) }));
  }
}

checkRls();
