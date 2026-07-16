import { readFileSync } from 'node:fs';

async function main() {
  const fileContent = readFileSync('../docs/CATALYST_DEPLOYMENT_GUIDE.md', 'utf8');
  const lines = fileContent.split('\n');
  const p4Index = lines.findIndex(l => l.startsWith('## Part 4'));
  const p7Index = lines.findIndex(l => l.startsWith('## Part 7'));
  console.log(lines.slice(p4Index, p7Index).join('\n'));
}

main().catch(console.error);
