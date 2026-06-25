import urllib.parse
import sys
import subprocess

try:
    import psycopg2
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "psycopg2-binary"])
    import psycopg2

conn_str = "postgres://postgres:NcwDAzumaH9816!@db.kvngomppvgnadiwhgglc.supabase.co:5432/postgres"
conn = psycopg2.connect(conn_str)
conn.autocommit = True
cur = conn.cursor()
cur.execute("SELECT setval('public.nodes_id_seq', 100000000, true);")
print("Successfully advanced nodes_id_seq to 100000000")
cur.close()
conn.close()
