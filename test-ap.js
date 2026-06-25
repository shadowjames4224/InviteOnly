const { Client } = require('pg');
const password = 'NcwDAzumaH9816!';
const projectRef = 'kvngomppvgnadiwhgglc';
const user = `postgres.${projectRef}`;
const region = 'ap-southeast-1';

async function check() {
  const url = `postgres://${user}:${password}@aws-0-${region}.pooler.supabase.com:6543/postgres`;
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    console.log(`SUCCESS: ${url}`);
    await client.end();
  } catch (err) {
    console.log(`Failed for region ${region}: ${err.message}`);
  }
}
check();
