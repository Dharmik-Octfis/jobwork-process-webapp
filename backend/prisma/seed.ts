import { prisma } from '../src/db/prisma.ts';

// `code` is the stable, space-free key organizations reference (Organization.industryCode
// -> Industry.code). `name` is the display label. Renaming a label never touches org rows.
const INDUSTRIES = [
  { code: 'technology', name: 'Technology' },
  { code: 'manufacturing', name: 'Manufacturing' },
  { code: 'retail', name: 'Retail' },
  { code: 'healthcare', name: 'Healthcare' },
  { code: 'finance', name: 'Finance' },
];

// `code` is ISO 3166-1 alpha-2, `isoCode` is alpha-3. India first — it is the
// default market and the list is ordered by likelihood of use, not alphabet.
const COUNTRIES = [
  { name: 'India', code: 'IN', isoCode: 'IND' },
  { name: 'United States', code: 'US', isoCode: 'USA' },
  { name: 'United Kingdom', code: 'GB', isoCode: 'GBR' },
  { name: 'United Arab Emirates', code: 'AE', isoCode: 'ARE' },
  { name: 'Singapore', code: 'SG', isoCode: 'SGP' },
  { name: 'Australia', code: 'AU', isoCode: 'AUS' },
  { name: 'Canada', code: 'CA', isoCode: 'CAN' },
  { name: 'Germany', code: 'DE', isoCode: 'DEU' },
];

const STATES = [
  {
    name: 'Gujarat',
    cities: [
      'Ahmedabad',
      'Surat',
      'Vadodara',
      'Rajkot',
      'Bhavnagar',
      'Jamnagar',
      'Junagadh',
      'Gandhinagar',
      'Anand',
      'Navsari',
    ],
  },
  {
    name: 'Maharashtra',
    cities: [
      'Mumbai',
      'Pune',
      'Nagpur',
      'Thane',
      'Nashik',
      'Kalyan-Dombivli',
      'Vasai-Virar',
      'Aurangabad',
      'Navi Mumbai',
      'Solapur',
    ],
  },
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

  // 2. Seed Countries
  for (const country of COUNTRIES) {
    await prisma.country.upsert({
      where: { code: country.code },
      update: {},
      create: country,
    });
  }
  console.log('Seeded countries.');

  // 3. Seed States and Cities
  for (const stateObj of STATES) {
    const state = await prisma.state.upsert({
      where: { name: stateObj.name },
      update: {},
      create: { name: stateObj.name },
    });

    for (const cityName of stateObj.cities) {
      await prisma.city.upsert({
        // eslint-disable-next-line @typescript-eslint/naming-convention
        where: { name_stateId: { name: cityName, stateId: state.id } },
        update: {},
        create: { name: cityName, stateId: state.id },
      });
    }
  }
  console.log('Seeded states and cities.');

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
