import { prisma } from '../src/db/prisma.ts';

const INDUSTRIES = ['Technology', 'Manufacturing', 'Retail', 'Healthcare', 'Finance'];

const STATES = [
  {
    name: 'Gujarat',
    cities: [
      'Ahmedabad', 'Surat', 'Vadodara', 'Rajkot', 'Bhavnagar', 
      'Jamnagar', 'Junagadh', 'Gandhinagar', 'Anand', 'Navsari'
    ]
  },
  {
    name: 'Maharashtra',
    cities: [
      'Mumbai', 'Pune', 'Nagpur', 'Thane', 'Nashik', 
      'Kalyan-Dombivli', 'Vasai-Virar', 'Aurangabad', 'Navi Mumbai', 'Solapur'
    ]
  }
];

async function main() {
  console.log('Start seeding...');

  // 1. Seed Industries
  for (const industryName of INDUSTRIES) {
    await prisma.industry.upsert({
      where: { name: industryName },
      update: {},
      create: { name: industryName },
    });
  }
  console.log('Seeded industries.');

  // 2. Seed States and Cities
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

  // 3. Seed Modules
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
    create: { code: 'VENDORS', name: 'Vendors', parentId: purchases.id, sortIndex: 1, icon: 'Users' },
  });

  await prisma.appModule.upsert({
    where: { code: 'PO' },
    update: {},
    create: { code: 'PO', name: 'Purchase Orders', parentId: purchases.id, sortIndex: 2, icon: 'FileText' },
  });

  await prisma.appModule.upsert({
    where: { code: 'BILLS' },
    update: {},
    create: { code: 'BILLS', name: 'Bills', parentId: purchases.id, sortIndex: 3, icon: 'Receipt' },
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
