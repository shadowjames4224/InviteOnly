const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

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

async function main() {
  const env = loadEnv();
  const dbUrl = env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL not found in .env");
    process.exit(1);
  }

  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  try {
    // Ensure migrations_log table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.migrations_log (
          id SERIAL PRIMARY KEY,
          migration_name VARCHAR(255) UNIQUE NOT NULL,
          executed_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
      );
    `);
    console.log("✅ Migrations tracking log verified.");

    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const checkRes = await client.query(
        "SELECT 1 FROM public.migrations_log WHERE migration_name = $1;",
        [file]
      );

      if (checkRes.rows.length > 0) {
        console.log(`skip: Migration '${file}' already executed. Skipping.`);
        continue;
      }

      console.log(`🚀 Running migration '${file}'...`);
      const filePath = path.join(migrationsDir, file);
      const sqlContent = fs.readFileSync(filePath, 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sqlContent);
        await client.query(
          "INSERT INTO public.migrations_log (migration_name) VALUES ($1);",
          [file]
        );
        await client.query('COMMIT');
        console.log(`✅ Migration '${file}' applied successfully.`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    console.log("🎉 Database migrations completed successfully!");
  } catch (err) {
    console.error("❌ Fatal error executing migrations:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
