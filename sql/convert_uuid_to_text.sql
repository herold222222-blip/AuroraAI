-- convert_uuid_to_text.sql
-- WARNING: Run only after a full pg_dump backup. This script converts all columns with data_type 'uuid' to text
-- in the specified schema (default: public). It saves and recreates affected constraints.
\set ON_ERROR_STOP on
BEGIN;

-- Temporary tables
DROP TABLE IF EXISTS tmp_saved_constraints;
CREATE TEMP TABLE tmp_saved_constraints (
  conname text,
  conrel text,
  consql text
);

DROP TABLE IF EXISTS tmp_uuid_cols;
CREATE TEMP TABLE tmp_uuid_cols AS
SELECT
  table_schema,
  table_name,
  column_name,
  quote_ident(table_schema)||'.'||quote_ident(table_name) AS full_table,
  (SELECT a.attnum FROM pg_attribute a JOIN pg_class c ON a.attrelid = c.oid JOIN pg_namespace n ON c.relnamespace = n.oid WHERE n.nspname = c.table_schema AND c.relname = c.table_name AND a.attname = column_name LIMIT 1) AS attnum
FROM information_schema.columns c
WHERE c.data_type = 'uuid' AND c.table_schema = 'public';

-- Save constraints that reference these columns
INSERT INTO tmp_saved_constraints (conname, conrel, consql)
SELECT
  con.conname,
  quote_ident(nsp.nspname)||'.'||quote_ident(rel.relname) AS conrel,
  pg_get_constraintdef(con.oid) AS consql
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
WHERE EXISTS (
  SELECT 1
  FROM tmp_uuid_cols u
  WHERE u.full_table = quote_ident(nsp.nspname)||'.'||quote_ident(rel.relname)
    AND (
      EXISTS (SELECT 1 FROM unnest(con.conkey) k WHERE k = u.attnum)
      OR EXISTS (SELECT 1 FROM unnest(con.confkey) k WHERE k = u.attnum)
    )
);

-- Show what will be dropped (for logging)
SELECT 'Saved constraint: '||conname||' ON '||conrel||' => '||consql FROM tmp_saved_constraints;

-- Drop affected constraints
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM tmp_saved_constraints LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.conrel, r.conname);
  END LOOP;
END
$$;

-- Alter uuid columns to text
DO $$
DECLARE rc record;
BEGIN
  FOR rc IN SELECT * FROM tmp_uuid_cols LOOP
    RAISE NOTICE 'Altering %.% column % to text', rc.table_schema, rc.table_name, rc.column_name;
    EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN %I TYPE text USING %I::text', rc.table_schema, rc.table_name, rc.column_name, rc.column_name);
  END LOOP;
END
$$;

-- Recreate saved constraints
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM tmp_saved_constraints LOOP
    RAISE NOTICE 'Creating constraint % on %: %', r.conname, r.conrel, r.consql;
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', r.conrel, r.conname, r.consql);
  END LOOP;
END
$$;

COMMIT;

-- End of script
