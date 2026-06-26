const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

function loadEnv() {
  const envPath = path.join(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, 'utf8');
  const env = {};
  content.split('\n').forEach(line => {
    line = line.trim();
    if (line && !line.startsWith('#')) {
      const idx = line.indexOf('=');
      if (idx > 0) {
        const key = line.substring(0, idx).trim();
        const val = line.substring(idx + 1).trim().replace(/^['"]|['"]$/g, '');
        env[key] = val;
      }
    }
  });
  return env;
}

async function verifyConnection(dbUrl) {
  const client = new Client({ connectionString: dbUrl });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch (err) {
    console.error("❌ Database connection test failed:", err.message);
    return false;
  } finally {
    try {
      await client.end();
    } catch (e) {}
  }
}

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => rl.question(query, (ans) => {
    rl.close();
    resolve(ans);
  }));
}

async function main() {
  console.log("🔍 Running Pre-Flight Database Check...");
  const env = loadEnv();
  const dbUrl = env.DATABASE_URL;
  if (!dbUrl) {
    console.error("❌ Error: DATABASE_URL not found in .env file.");
    process.exit(1);
  }

  // 1. Verify DB Connection
  const isConnected = await verifyConnection(dbUrl);
  if (!isConnected) {
    console.error("❌ Pre-flight check failed: Cannot establish connection to Supabase database.");
    process.exit(1);
  }
  console.log("✅ Database connection verified successfully.");

  // 2. Prompt for manual backup
  console.log("\n⚠️  WARNING: You are about to perform schema migrations on the database.");
  console.log("⚠️  It is highly recommended that you perform a manual backup in your Supabase dashboard first.");
  
  const response = await askQuestion("❓ Have you created a backup and wish to proceed? (y/n): ");
  const normalized = response.trim().toLowerCase();
  
  if (normalized === 'y' || normalized === 'yes') {
    console.log("🚀 Proceeding with migrations...\n");
    process.exit(0);
  } else {
    console.log("❌ Schema migration aborted by user. Please run a manual backup and try again.");
    process.exit(1);
  }
}

main();
