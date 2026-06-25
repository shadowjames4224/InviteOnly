#!/usr/bin/env python3
import os
import sys
import subprocess
import re

def load_env():
    """Loads variables from .env file manually without external library dependencies."""
    env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env')
    if not os.path.exists(env_path):
        return {}
    
    config = {}
    with open(env_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            parts = line.split('=', 1)
            if len(parts) == 2:
                key = parts[0].strip()
                val = parts[1].strip().strip('"').strip("'")
                config[key] = val
    return config

def run_psql_cmd(db_url, sql_query, dry_run=False):
    """Executes a single SQL query using docker execution and returns output."""
    is_local = "localhost" in db_url or "127.0.0.1" in db_url
    
    if is_local:
        cmd = [
            "docker", "exec", "-i", "review-ecosystem-db",
            "psql", "-U", "postgres", "-d", "review_network",
            "-q", "-t", "-c", sql_query
        ]
    else:
        cmd = [
            "docker", "run", "--rm", "--network", "host", "-i", "postgres",
            "psql", db_url, "-q", "-t", "-c", sql_query
        ]
        
    if dry_run:
        print(f"   [Dry Run] Query: {sql_query.strip()}")
        # Mock checking result: pretend migrations table doesn't have files applied yet
        return ""
        
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"Database query failed: {res.stderr.strip()}")
    return res.stdout.strip()

def run_psql_file(db_url, file_path, dry_run=False):
    """Executes an entire SQL migration file using docker input redirection."""
    is_local = "localhost" in db_url or "127.0.0.1" in db_url
    
    if is_local:
        cmd = [
            "docker", "exec", "-i", "review-ecosystem-db",
            "psql", "-U", "postgres", "-d", "review_network",
            "-v", "ON_ERROR_STOP=1"
        ]
    else:
        cmd = [
            "docker", "run", "--rm", "--network", "host", "-i", "postgres",
            "psql", db_url, "-v", "ON_ERROR_STOP=1"
        ]
        
    if dry_run:
        print(f"   [Dry Run] Executing file: {file_path}")
        print(f"   [Dry Run] Shell Command: {' '.join(cmd)} < {file_path}")
        return ""
        
    with open(file_path, 'r', encoding='utf-8') as f:
        sql_content = f.read()
        
    transaction_sql = f"BEGIN;\n{sql_content}\nCOMMIT;"
    
    res = subprocess.run(cmd, input=transaction_sql, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"Migration file execution failed: {res.stderr.strip()}")
    return res.stdout.strip()

def main():
    print("🔄 Starting database migrations runner (Python-Docker)...")
    
    dry_run = "--dry-run" in sys.argv
    if dry_run:
        print("🔍 RUNNING IN DRY-RUN MODE: No changes will be applied to the database.")
        
    config = load_env()
    db_url = os.environ.get("DATABASE_URL") or config.get("DATABASE_URL")
    
    if not db_url:
        print("❌ Error: DATABASE_URL is not defined in .env or environment variables.")
        sys.exit(1)
        
    print(f"🔌 Target DB Server: {'Local Docker Container' if ('localhost' in db_url or '127.0.0.1' in db_url) else 'Remote Cloud (Supabase)'}")
    
    try:
        # 1. Check if migrations table exists, and create it if missing
        create_table_query = """
        CREATE TABLE IF NOT EXISTS public.migrations_log (
            id SERIAL PRIMARY KEY,
            migration_name VARCHAR(255) UNIQUE NOT NULL,
            executed_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
        );
        """
        run_psql_cmd(db_url, create_table_query, dry_run=dry_run)
        if dry_run:
            print("✅ [Dry Run] Schema verification command parsed.")
        else:
            print("✅ Migrations tracking log verified.")
        
        # 2. Get list of migrations
        migrations_dir = os.path.join(os.path.dirname(__file__), 'migrations')
        if not os.path.exists(migrations_dir):
            print(f"❌ Error: Migrations folder not found at {migrations_dir}")
            sys.exit(1)
            
        files = sorted([f for f in os.listdir(migrations_dir) if f.endswith('.sql')])
        
        if not files:
            print("ℹ️ No migration SQL files found.")
            return

        # 3. Apply missing migrations sequentially
        for file in files:
            # Check if executed
            check_query = f"SELECT 1 FROM public.migrations_log WHERE migration_name = '{file}';"
            checked = run_psql_cmd(db_url, check_query, dry_run=dry_run)
            
            if checked == "1":
                print(f"skip: Migration '{file}' already executed. Skipping.")
                continue
                
            print(f"🚀 Running migration '{file}'...")
            file_path = os.path.join(migrations_dir, file)
            run_psql_file(db_url, file_path, dry_run=dry_run)
            
            # Record execution log
            log_query = f"INSERT INTO public.migrations_log (migration_name) VALUES ('{file}');"
            run_psql_cmd(db_url, log_query, dry_run=dry_run)
            if dry_run:
                print(f"✅ [Dry Run] Migration '{file}' query construct completed.")
            else:
                print(f"✅ Migration '{file}' applied successfully.")
            
        if dry_run:
            print("🎉 [Dry Run] All migrations parsed and verified successfully!")
        else:
            print("🎉 Database migrations completed successfully!")
        
    except Exception as e:
        print(f"❌ Fatal error executing migrations:\n{e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
