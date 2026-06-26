const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');

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

function generateDeterministicId(uniquePathString) {
  const hash = crypto.createHash('sha256').update(uniquePathString).digest();
  const val = hash.readBigUInt64BE(0);
  const positiveBigInt = val & 0x7fffffffffffffffn;
  return positiveBigInt.toString();
}

// Flatten tree to get nodes in top-down (parent before child) order, computing pathStr, id, and parentId
function flattenTaxonomy(node, parentPathStr = '', parentId = null) {
  const pathStr = parentPathStr ? `${parentPathStr}.${node.slug}` : node.slug;
  const id = generateDeterministicId(pathStr);
  const flatNode = {
    id,
    parent_id: parentId,
    name: node.name,
    slug: node.slug,
    node_type: node.node_type,
    pathStr
  };
  
  let result = [flatNode];
  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      result = result.concat(flattenTaxonomy(child, pathStr, id));
    }
  }
  return result;
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
  const env = loadEnv();
  const dbUrl = env.DATABASE_URL;
  if (!dbUrl) {
    console.error("❌ Error: DATABASE_URL not found in .env file.");
    process.exit(1);
  }

  // Load taxonomy data
  const taxonomyPath = path.join(__dirname, 'taxonomy_data.json');
  if (!fs.existsSync(taxonomyPath)) {
    console.error(`❌ Error: ${taxonomyPath} not found.`);
    process.exit(1);
  }
  const taxonomyData = JSON.parse(fs.readFileSync(taxonomyPath, 'utf8'));

  // Flatten taxonomy in parent-first order
  const allNodes = flattenTaxonomy(taxonomyData);

  const client = new Client({ connectionString: dbUrl });
  try {
    await client.connect();

    // Fetch existing node IDs
    const { rows } = await client.query('SELECT id FROM public.nodes;');
    const existingIds = new Set(rows.map(r => r.id.toString()));

    // Filter nodes to insert
    const nodesToInsert = allNodes.filter(node => !existingIds.has(node.id));

    // Console log summary as requested
    console.log(`Checking for ${nodesToInsert.length} new nodes to insert...`);

    if (nodesToInsert.length === 0) {
      console.log("✅ No new nodes to insert. Database is up to date.");
      process.exit(0);
    }

    // List new nodes for clarity
    console.log("\nNew nodes to be seeded:");
    nodesToInsert.forEach(node => {
      console.log(`  - [${node.node_type.toUpperCase()}] ${node.name} (ID: ${node.id}, Path: ${node.pathStr})`);
    });

    // Ask user for confirmation
    const answer = await askQuestion("\n❓ Do you want to proceed with execution? (y/n): ");
    if (answer.trim().toLowerCase() !== 'y' && answer.trim().toLowerCase() !== 'yes') {
      console.log("❌ Execution aborted by user.");
      process.exit(0);
    }

    console.log("\n🚀 Seeding new taxonomy nodes recursively...");

    // Insert new nodes in order (since allNodes was flattened top-down, parents are inserted before children)
    for (const node of nodesToInsert) {
      console.log(`Inserting: ${node.name} (${node.node_type}) with parent_id: ${node.parent_id || 'NULL'}`);
      await client.query(
        `INSERT INTO public.nodes (id, parent_id, name, slug, node_type, aliases, needs_taxonomy_review)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING;`,
        [
          node.id,
          node.parent_id,
          node.name,
          node.slug,
          node.node_type,
          [],
          false
        ]
      );
    }

    console.log("🎉 Seeding completed successfully!");
  } catch (err) {
    console.error("❌ Error during seeding:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main();
}
