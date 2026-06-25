# InviteOnly Review Network

A community-governed, privacy-preserving review platform. Users can register via invite tokens, post location or item reviews verified through local edge calculations, and vote to manage review visibility based on consensus.

---

## File System Structure

```text
decentralized-reviews/
├── database/
│   ├── migrate.py      # Database migration runner script
│   └── migrations/     # Ordered SQL migration scripts (schema, seed, grants)
├── frontend/
│   ├── home.html       # Landing page and public review feed
│   ├── index.html      # Community dashboard and global settings preferences
│   ├── index.js        # Main portal feed rendering & reputation calculations
│   ├── profile.html    # Gated user profile and admin management console dashboard
│   ├── profile.js      # Profile interactions, tree rendering, and admin operations
│   ├── assistant.js    # Floating Network Chat Assistant script
│   └── style.css       # Premium glassmorphic styling, transitions, and layout system
├── workers/
│   ├── edge-worker.ts  # Cloudflare Worker script for registration and invite verification
│   ├── ocr-worker.ts   # Tesseract OCR engine for receipt scanner processing
│   ├── wrangler.toml   # Cloudflare deployment settings
│   ├── package.json    # Worker dependencies and scripts
│   └── deno.json       # Deno configuration file
├── docker-compose.yml  # Docker Compose config for local database setup
└── package.json        # Project-wide scripts and dependencies
```

---

## Core Features & Mechanisms

1. **Decoupled Graph Taxonomy**
   - Blueprints (`GlobalEntity` -> `ParameterizedArchetype` -> `ExecutionInstance`) are decoupled from flat hierarchical nodes, allowing instance-level telemetry comparison across unrelated establishments.

2. **Causal Bias Correction (IPW)**
   - Adjusts review consensus ratings ($\theta$) using demographic Inverse Probability Weighting (IPW) propensity scores to counteract urban/rural user density skew.

3. **Benchmarking Indexes**
   - **Consistency Index ($CI$)**: Evaluates variability in menu/flow telemetry logs relative to standard deviation.
   - **Process Capability ($C_{pk}$)**: Benchmarks performance telemetry against strict target specification limits (LSL and USL).

4. **Admin Management Console**
   - Securely gated for the root administrator (`root_moderator`) directly within the profile dashboard. Provides visualization of the trust lineage tree, cascade deactivation operations, system invites, behalf invites, and alpha settings customization.

---

## Scripts & Usage

From the root project directory, run the following commands:

* **Start the Web Portal**:
  ```bash
  npm start
  ```
  Serves the frontend client locally on [http://localhost:8080](http://localhost:8080).

* **Launch Docker Database**:
  ```bash
  npm run db:up
  ```

* **Shut down Docker Database**:
  ```bash
  npm run db:down
  ```

* **Run Database SQL Migrations**:
  ```bash
  npm run db:migrate
  ```
  Applies all missing sequential SQL migration scripts located in `database/migrations/` using Python and containerized `psql`.

* **Typecheck Worker Code**:
  ```bash
  npm run worker:typecheck
  ```

---

## ⚙️ Cloud Deployment Setup & Credentials

To deploy this platform to the cloud, configure the following secrets and environment variables:

### 1. Database Migrations (.env)
1. Copy `.env.example` to `.env` in the project root:
   ```bash
   cp .env.example .env
   ```
2. For local Docker database setup, keep the default values.
3. For cloud databases (e.g. Supabase, Neon), update the `DATABASE_URL` line:
   ```env
   DATABASE_URL="postgres://postgres.<your-project-id>:<your-password>@<your-pooler-host>:6543/postgres"
   ```
4. Run the migration script to configure tables and seed data in the cloud database:
   ```bash
   npm run db:migrate
   ```

### 2. Cloudflare Edge Scrubber Worker Secrets
Our Cloudflare Worker requires credentials to interact with your Supabase database layer. Since these are private keys, they should **never** be checked into version control or written in `wrangler.toml` directly.

Set up these secrets in your Cloudflare environment using wrangler CLI commands:

```bash
# 1. Bind the Supabase project URL
npx wrangler secret put SUPABASE_URL

# 2. Bind the private Supabase service-role API token
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

Once the secrets are bound, deploy your worker script:
```bash
npm run worker:deploy
```
