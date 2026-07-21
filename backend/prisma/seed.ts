import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prisma } from '../src/db/prisma.ts';

// Geography reference data is generated from the dr5hn dataset by
// prisma/data/generate-geo.ts (run it once and commit the JSON). Countries and
// states cover the whole world; cities are India-only to keep the table lean.
function loadGeo<T>(file: string): T {
  const path = fileURLToPath(new URL(`./data/${file}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

// `code` is the stable, space-free key organizations reference (Organization.industryCode
// -> Industry.code). `name` is the display label. Renaming a label never touches org rows.
const INDUSTRIES = [
  { code: 'technology', name: 'Technology' },
  { code: 'manufacturing', name: 'Manufacturing' },
  { code: 'retail', name: 'Retail' },
  { code: 'healthcare', name: 'Healthcare' },
  { code: 'finance', name: 'Finance' },
];

async function main() {
  console.log('Start seeding...');

  // 1. Seed Industries
  for (const industry of INDUSTRIES) {
    await prisma.industry.upsert({
      where: { code: industry.code },
      update: { name: industry.name },
      create: industry,
    });
  }
  console.log('Seeded industries.');

  // 2. Seed Countries (whole world). Upsert so re-runs refresh name/dialCode.
  const countries =
    loadGeo<{ name: string; code: string; isoCode: string; dialCode: string }[]>('countries.json');
  for (const country of countries) {
    await prisma.country.upsert({
      where: { code: country.code },
      update: { name: country.name, isoCode: country.isoCode, dialCode: country.dialCode },
      create: country,
    });
  }
  console.log(`Seeded ${countries.length} countries.`);

  // 3. Seed States (whole world), then India Cities. These are large, so bulk
  // insert in chunks and skip rows already present (createMany can't upsert).
  const states = loadGeo<{ code: string; name: string; countryCode: string }[]>('states.json');
  for (let i = 0; i < states.length; i += 2000) {
    await prisma.state.createMany({ data: states.slice(i, i + 2000), skipDuplicates: true });
  }
  console.log(`Seeded ${states.length} states.`);

  const cities = loadGeo<{ name: string; stateCode: string }[]>('cities-in.json');
  for (let i = 0; i < cities.length; i += 5000) {
    await prisma.city.createMany({ data: cities.slice(i, i + 5000), skipDuplicates: true });
  }
  console.log(`Seeded ${cities.length} India cities.`);

  // 4. Seed Modules
  await prisma.appModule.upsert({
    where: { code: 'DASHBOARD' },
    update: {},
    create: { code: 'DASHBOARD', name: 'Dashboard', sortIndex: 1, icon: 'LayoutDashboard' },
  });

  const purchases = await prisma.appModule.upsert({
    where: { code: 'PURCHASES' },
    update: {},
    create: { code: 'PURCHASES', name: 'Purchases', sortIndex: 2, icon: 'ShoppingCart' },
  });

  await prisma.appModule.upsert({
    where: { code: 'VENDORS' },
    update: {},
    create: {
      code: 'VENDORS',
      name: 'Vendors',
      parentId: purchases.id,
      sortIndex: 1,
      icon: 'Users',
    },
  });

  await prisma.appModule.upsert({
    where: { code: 'PO' },
    update: {},
    create: {
      code: 'PO',
      name: 'Purchase Orders',
      parentId: purchases.id,
      sortIndex: 2,
      icon: 'FileText',
    },
  });

  await prisma.appModule.upsert({
    where: { code: 'BILLS' },
    update: {},
    create: { code: 'BILLS', name: 'Bills', parentId: purchases.id, sortIndex: 3, icon: 'Receipt' },
  });

  await prisma.appModule.upsert({
    where: { code: 'ITEMS' },
    update: {},
    create: { code: 'ITEMS', name: 'Items', sortIndex: 3, icon: 'FileText' },
  });
  console.log('Seeded app modules.');

  console.log('Seeding finished.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
