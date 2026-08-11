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
    update: { name: 'Home', icon: 'Home' },
    create: { code: 'DASHBOARD', name: 'Home', sortIndex: 1, icon: 'Home' },
  });

  const purchases = await prisma.appModule.upsert({
    where: { code: 'PURCHASES' },
    update: { sortIndex: 5 },
    create: { code: 'PURCHASES', name: 'Purchases', sortIndex: 5, icon: 'ShoppingCart' },
  });

  const sales = await prisma.appModule.upsert({
    where: { code: 'SALES' },
    update: { sortIndex: 4 },
    create: { code: 'SALES', name: 'Sales', sortIndex: 4, icon: 'ShoppingBag' },
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
    where: { code: 'CUSTOMERS' },
    update: {},
    create: {
      code: 'CUSTOMERS',
      name: 'Customers',
      parentId: sales.id,
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

  const inventory = await prisma.appModule.upsert({
    where: { code: 'INVENTORY' },
    update: { name: 'Item', sortIndex: 2 },
    create: { code: 'INVENTORY', name: 'Item', sortIndex: 2, icon: 'FileText' },
  });

  await prisma.appModule.upsert({
    where: { code: 'ITEMS' },
    update: { parentId: inventory.id },
    create: {
      code: 'ITEMS',
      name: 'Items',
      parentId: inventory.id,
      sortIndex: 1,
      icon: 'FileText',
    },
  });

  await prisma.appModule.upsert({
    where: { code: 'COMPOSITE_ITEMS' },
    update: { parentId: inventory.id },
    create: {
      code: 'COMPOSITE_ITEMS',
      name: 'Composite Items',
      parentId: inventory.id,
      sortIndex: 2,
      icon: 'PackageCheck',
    },
  });

  const inventoryManagement = await prisma.appModule.upsert({
    where: { code: 'INVENTORY_MANAGEMENT' },
    update: { name: 'Inventory', sortIndex: 3 },
    create: { code: 'INVENTORY_MANAGEMENT', name: 'Inventory', sortIndex: 3, icon: 'ClipboardList' },
  });

  await prisma.appModule.upsert({
    where: { code: 'ASSEMBLY' },
    update: { parentId: inventoryManagement.id },
    create: {
      code: 'ASSEMBLY',
      name: 'Assembly',
      parentId: inventoryManagement.id,
      sortIndex: 1,
      icon: 'Factory',
    },
  });

  // Jobwork.
  //
  // sortIndex 5 puts it after Purchases — the sidebar order is Home, Item, Sales,
  // Purchases, Jobwork, which is roughly the order a jobworker's day runs in.
  const jobwork = await prisma.appModule.upsert({
    where: { code: 'JOBWORK' },
    update: { name: 'Jobwork', sortIndex: 6 },
    create: { code: 'JOBWORK', name: 'Jobwork', sortIndex: 6, icon: 'Factory' },
  });

  /**
   * The children, in the order the work actually happens: you raise a job order,
   * you issue material, you receive it back. Only the documents live here — the
   * Processes and Process Routes masters moved to Settings on 2026-08-10, because
   * they are shop setup you do once, not work you do daily.
   *
   * A child here with no page behind it is a sidebar link that goes nowhere, so
   * every entry below has a route in `web/src/app/router.tsx` in the same change.
   */
  const jobworkChildren = [
    { code: 'JOB_ORDERS', name: 'Job Orders', sortIndex: 1, icon: 'ClipboardList' },
    { code: 'ISSUES', name: 'Issues', sortIndex: 2, icon: 'Send' },
    { code: 'RECEIPTS', name: 'Receipts', sortIndex: 3, icon: 'PackageCheck' },
  ];

  for (const child of jobworkChildren) {
    await prisma.appModule.upsert({
      where: { code: child.code },
      update: { parentId: jobwork.id, name: child.name, sortIndex: child.sortIndex },
      create: { ...child, parentId: jobwork.id },
    });
  }

  // Their pages now hang off SettingsLayout, which reads no module tree, so the
  // rows have nothing to drive. Deactivated rather than deleted: `buildTree`
  // filters on `isActive`, and an active row with no `ROUTE_MAP` entry renders as
  // a sidebar link to '#'. Deleting is the destructive way to say the same thing.
  await prisma.appModule.updateMany({
    where: { code: { in: ['PROCESSES', 'ROUTES'] } },
    data: { isActive: false, parentId: null },
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
