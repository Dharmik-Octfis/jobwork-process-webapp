const { PrismaClient } = require('./backend/generated/prisma/client/index.js');
const prisma = new PrismaClient();
prisma.compositeItemComponent.findMany({ include: { component: true } })
  .then(r => console.log(JSON.stringify(r, null, 2)))
  .catch(console.error)
  .finally(() => prisma.$disconnect());
