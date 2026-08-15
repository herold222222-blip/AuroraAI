import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client } from 'pg';
import dotenv from 'dotenv';

// load .env.local if present
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set in env or .env.local');
  process.exit(2);
}

const client = new Client({ connectionString: DATABASE_URL });
const BACKUP_DIR = path.resolve(process.cwd(), 'backups_uuid_to_text');
const SCHEMA = 'public';

async function main() {
  await client.connect();
  console.log('Connected to', DATABASE_URL.split('@')[1]);

  // find uuid columns
  const { rows } = await client.query(
    `SELECT table_schema, table_name, column_name
     FROM information_schema.columns
     WHERE data_type='uuid' AND table_schema = $1`,
    [SCHEMA],
  );

  if (!rows.length) {
    console.log('No uuid columns found in schema', SCHEMA);
    await client.end();
    return;
  }

  // group by table
  const tables = {};
  for (const r of rows) {
    const t = r.table_name;
    tables[t] = tables[t] || [];
    tables[t].push(r.column_name);
  }

  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  // backup each affected table to JSON
  for (const t of Object.keys(tables)) {
    console.log('Backing up table', t);
    const res = await client.query(`SELECT * FROM ${SCHEMA}.${t}`);
    const out = path.join(BACKUP_DIR, `${t}.json`);
    fs.writeFileSync(out, JSON.stringify(res.rows, null, 2), 'utf8');
    console.log('Wrote', out, 'rows:', res.rows.length);
  }

  // collect constraints referencing these columns
  const { rows: cons } = await client.query(
    `SELECT con.conname, quote_ident(nsp.nspname)||'.'||quote_ident(rel.relname) AS conrel, pg_get_constraintdef(con.oid) AS consql, con.contype
     FROM pg_constraint con
     JOIN pg_class rel ON rel.oid = con.conrelid
     JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     WHERE EXISTS (
       SELECT 1 FROM information_schema.columns c WHERE c.data_type='uuid' AND c.table_schema = $1
         AND (quote_ident(nsp.nspname)||'.'||quote_ident(rel.relname) = quote_ident(c.table_schema)||'.'||quote_ident(c.table_name))
         AND (
           EXISTS (SELECT 1 FROM unnest(con.conkey) k WHERE k = (SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = rel.oid AND a.attname = c.column_name LIMIT 1))
           OR EXISTS (SELECT 1 FROM unnest(con.confkey) k WHERE k = (SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = rel.oid AND a.attname = c.column_name LIMIT 1))
         )
     )`,
    [SCHEMA],
  );

  const constraintsFile = path.join(BACKUP_DIR, 'saved_constraints.sql');
  fs.writeFileSync(constraintsFile, '/* saved constraints - will be dropped and recreated */\n', 'utf8');
  for (const c of cons) {
    fs.appendFileSync(constraintsFile, `-- ${c.conname} ON ${c.conrel}\n`);
    fs.appendFileSync(constraintsFile, `-- ${c.consql}\n\n`);
  }
  console.log('Saved', cons.length, 'constraints to', constraintsFile);

  // Now perform migration in transaction
  try {
    await client.query('BEGIN');
    console.log('Transaction started');

    // drop constraints in safe order: foreign keys first (contype = 'f'), then unique/index/primary
    const fkCons = cons.filter((x) => x.contype === 'f');
    const otherCons = cons.filter((x) => x.contype !== 'f');
    for (const c of fkCons) {
      console.log('Dropping FK constraint', c.conname, 'on', c.conrel);
      await client.query(`ALTER TABLE ${c.conrel} DROP CONSTRAINT IF EXISTS ${c.conname}`);
    }
    for (const c of otherCons) {
      console.log('Dropping constraint', c.conname, 'on', c.conrel);
      await client.query(`ALTER TABLE ${c.conrel} DROP CONSTRAINT IF EXISTS ${c.conname}`);
    }

    // alter columns
    for (const [table, cols] of Object.entries(tables)) {
      for (const col of cols) {
        console.log(`Altering ${SCHEMA}.${table}.${col} to text`);
        await client.query(`ALTER TABLE ${SCHEMA}.${table} ALTER COLUMN ${col} TYPE text USING ${col}::text`);
      }
    }

    // recreate constraints in safe order: primary/unique/index first (contype != 'f'), then foreign keys
    const nonFk = cons.filter((x) => x.contype !== 'f');
    const fks = cons.filter((x) => x.contype === 'f');
    for (const c of nonFk) {
      const sql = `ALTER TABLE ${c.conrel} ADD CONSTRAINT ${c.conname} ${c.consql}`;
      console.log('Recreating constraint', c.conname, ':', sql);
      await client.query(sql);
    }
    for (const c of fks) {
      const sql = `ALTER TABLE ${c.conrel} ADD CONSTRAINT ${c.conname} ${c.consql}`;
      console.log('Recreating FK', c.conname, ':', sql);
      await client.query(sql);
    }

    await client.query('COMMIT');
    console.log('Migration committed');
  } catch (e) {
    console.error('Migration failed, rolling back:', e);
    try { await client.query('ROLLBACK'); } catch (er) { console.error('Rollback failed', er); }
    console.log('Backups are in', BACKUP_DIR);
    process.exit(1);
  } finally {
    await client.end();
  }

  console.log('Done. Backups in', BACKUP_DIR);
}

main().catch((e) => {
  console.error('Script error', e);
  process.exit(1);
});
