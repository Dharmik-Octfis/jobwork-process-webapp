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
        where: { name_stateId: { name: cityName, stateId: state.id } },
        update: {},
        create: { name: cityName, stateId: state.id },
      });
    }
  }
  console.log('Seeded states and cities.');

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
