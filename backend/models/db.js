const { Pool } = require('pg');
require('dotenv').config();

console.log('Connecting to database...');
console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.connect((err, client, release) => {
  if (err) {
    console.error('Database connection failed:', err.message);
    console.error('Full error:', err);
  } else {
    console.log('Connected to PostgreSQL database ✅');
    release();
  }
});

module.exports = pool;