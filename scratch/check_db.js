import prisma from '../src/config/db.js';

async function check() {
  try {
    const result = await prisma.$queryRaw`SELECT current_database(), current_user, inet_server_port()`;
    console.log('CONNECTED TO:', result);
    
    const tables = await prisma.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
    console.log('TABLES:', tables);

    const columns = await prisma.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_name = 'Business'`;
    console.log('BUSINESS COLUMNS:', columns);

  } catch (e) {
    console.error('ERROR:', e);
  } finally {
    await prisma.$disconnect();
  }
}

check();
