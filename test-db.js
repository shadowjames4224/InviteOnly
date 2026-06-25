const { Client } = require('pg');
const regions = ['us-east-1', 'us-west-1', 'us-west-2', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2', 'ap-south-1', 'sa-east-1', 'ca-central-1'];
const password = 'NcwDAzumaH9816!';
const projectRef = 'kvngomppvgnadiwhgglc';
const user = `postgres.${projectRef}`;

async function check() {
  for (let region of regions) {
    const url = `postgres://${user}:${password}@aws-0-${region}.pooler.supabase.com:6543/postgres`;
    const client = new Client({ connectionString: url, connectionTimeoutMillis: 2000 });
    try {
      await client.connect();
      console.log(`SUCCESS: ${url}`);
      await client.end();
      process.exit(0);
    } catch (err) {
      console.log(`Failed for region ${region}: ${err.message}`);
    }
  }
  console.log("None succeeded.");
}
check();
