#!/usr/bin/env node
/**
 * One-time import: Convex export ZIP -> Supabase.
 *
 * Usage:
 *   node scripts/import-convex-to-supabase.mjs <export.zip> [--apply]
 *
 * Reads the export ZIP directly (no manual unzipping) and reads each
 * `<table>/documents.jsonl` entry from inside it, one JSON document per line,
 * each with `_id` and `_creationTime`.
 *
 * Mapping (per supabase/schema.sql and packages/backend/convex/schema.ts):
 *   - camelCase -> snake_case
 *   - `_id` -> `convex_id`, `_creationTime` -> `created_at`,
 *     `createdAt` -> `convex_created_at`
 *   - leagues: numeric `id` -> `old_id`
 *   - objects and arrays -> jsonb columns
 *   - quoted `timestamp` and `date` columns map by name
 *
 * Default = dry run: parses everything, checks the mapping against the
 * target columns, prints per table the rows read, rows mapped and any
 * unmapped fields. Sends nothing to Supabase.
 *
 * With --apply: inserts in batches of 200 using upsert on `convex_id`
 * (`old_id` for leagues) so re-running is safe. Prints per-table counts.
 *
 * Stops at the first error.
 *
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY come from the environment only:
 * never hardcoded, printed or saved by this script.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

import { createClient } from '@supabase/supabase-js';

const BATCH_SIZE = 200;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(scriptDir, '..');
const SCHEMA_SQL_PATH = join(REPO_ROOT, 'supabase', 'schema.sql');
const CONVEX_SCHEMA_PATH = join(REPO_ROOT, 'packages', 'backend', 'convex', 'schema.ts');
const DISPLAY = {
  schemaSql: 'supabase/schema.sql',
  convexSchema: 'packages/backend/convex/schema.ts',
};

/* ------------------------------ name helpers ----------------------------- */

function norm(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function camelToSnake(s) {
  return String(s).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/* ------------------------------- zip reader ------------------------------ */

function findEocdOffset(buf) {
  const maxStart = buf.length - 22;
  if (maxStart < 0) throw new Error('not a valid zip file (too small)');
  const minStart = Math.max(0, maxStart - 0xffff - 4);
  for (let i = maxStart; i >= minStart; i--) {
    if (buf.readUInt32LE(i) !== 0x06054b50) continue;
    if (i + 22 + buf.readUInt16LE(i + 20) === buf.length) return i;
  }
  throw new Error('could not find the zip end-of-central-directory record');
}

function readCentralDirectory(buf, eocdOffset) {
  const total = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  if (total === 0xffff || cdOffset === 0xffffffff) throw new Error('ZIP64 archives are not supported');
  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
      throw new Error('bad zip central directory entry');
    }
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    if (compSize === 0xffffffff || uncompSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error('ZIP64 archives are not supported');
    }
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push({ name, method, compSize, uncompSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntryText(buf, entry) {
  const local = entry.localOffset;
  if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) {
    throw new Error(`bad zip local header for entry "${entry.name}"`);
  }
  const nameLen = buf.readUInt16LE(local + 26);
  const extraLen = buf.readUInt16LE(local + 28);
  const dataStart = local + 30 + nameLen + extraLen;
  if (dataStart + entry.compSize > buf.length) throw new Error(`truncated zip entry "${entry.name}"`);
  const data = buf.subarray(dataStart, dataStart + entry.compSize);
  if (entry.method === 0) return data.toString('utf8');
  if (entry.method === 8) {
    const out = inflateRawSync(data);
    if (out.length !== entry.uncompSize) throw new Error(`zip entry "${entry.name}" is corrupt (size mismatch)`);
    return out.toString('utf8');
  }
  throw new Error(`unsupported zip compression method ${entry.method} for entry "${entry.name}"`);
}

function readZipDocuments(zipPath) {
  const buf = readFileSync(zipPath);
  const docsByDir = new Map();
  for (const entry of readCentralDirectory(buf, findEocdOffset(buf))) {
    const m = entry.name.match(/(?:^|\/)documents\.jsonl$/);
    if (!m) continue;
    const tableDir = entry.name.slice(0, entry.name.length - m[0].length).replace(/^\.\//, '').replace(/\/+$/, '');
    const key = norm(tableDir);
    if (docsByDir.has(key)) throw new Error(`duplicate documents.jsonl entry for table dir "${tableDir}" in ${zipPath}`);
    const text = readEntryText(buf, entry);
    const docs = [];
    let lineNo = 0;
    for (const rawLine of text.split('\n')) {
      lineNo += 1;
      const line = rawLine.replace(/^\uFEFF/, '').trim();
      if (!line) continue;
      let doc;
      try {
        doc = JSON.parse(line);
      } catch (err) {
        throw new Error(`invalid JSON in ${entry.name} line ${lineNo}: ${err.message}`);
      }
      docs.push(doc);
    }
    docsByDir.set(key, { tableDir, docs });
  }
  return docsByDir;
}

/* -------------------------- supabase/schema.sql -------------------------- */

const CONSTRAINT_STARTERS = new Set([
  'CONSTRAINT', 'PRIMARY', 'FOREIGN', 'UNIQUE', 'CHECK', 'EXCLUDE', 'INDEX',
  'REFERENCES', 'LIKE', 'INHERITS', 'PARTITION', 'AS', 'DEFAULT', 'GENERATED',
]);

function findMatchingParen(sql, openIdx) {
  let depth = 0;
  let state = '';
  for (let i = openIdx; i < sql.length; i++) {
    const c = sql[i];
    if (state === 'single') {
      if (c === "'") {
        if (sql[i + 1] === "'") i++;
        else state = '';
      }
      continue;
    }
    if (state === 'double') {
      if (c === '"') state = '';
      continue;
    }
    if (state === 'block') {
      if (c === '*' && sql[i + 1] === '/') { state = ''; i++; }
      continue;
    }
    if (c === "'") { state = 'single'; continue; }
    if (c === '"') { state = 'double'; continue; }
    if (c === '-' && sql[i + 1] === '-') {
      while (i + 1 < sql.length && sql[i + 1] !== '\n') i++;
      continue;
    }
    if (c === '/' && sql[i + 1] === '*') { state = 'block'; i++; continue; }
    if (c === '(') { depth++; continue; }
    if (c === ')') {
      depth--;
      if (depth === 0) return i;
      continue;
    }
  }
  throw new Error('unbalanced parentheses in supabase/schema.sql');
}

function parseSupabaseSchema(sql) {
  const tables = new Map(); // normTable -> { name, cols: Map(normCol -> { name, type }) }
  const tableRe =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:"[^"]+"|[A-Za-z_][\w$]*)(?:\.(?:"[^"]+"|[A-Za-z_][\w$]*))?)\s*\(/gi;
  let m;
  while ((m = tableRe.exec(sql)) !== null) {
    const tableName = m[1].split('.').pop().replace(/^"|"$/g, '');
    const openIdx = tableRe.lastIndex - 1;
    const closeIdx = findMatchingParen(sql, openIdx);
    const body = sql.slice(openIdx + 1, closeIdx);
    const cols = new Map();
    for (const line of body.split('\n')) {
      const clean = line.replace(/--[^\n]*$/, '').trim();
      if (!clean) continue;
      const firstWord = (clean.match(/^([A-Za-z_][\w$]*)/) || [])[1] || '';
      if (CONSTRAINT_STARTERS.has(firstWord.toUpperCase())) continue;
      const cm = clean.match(/^("((?:[^"]|"")*)"|\[[^\]]*\]|[A-Za-z_][\w$]*)\s+("((?:[^"]|"")*)"|[A-Za-z_][\w$]*)/);
      if (!cm) continue;
      const colName = cm[2] !== undefined ? cm[2] : cm[1];
      if (!colName) continue;
      const type = (cm[3] || '').replace(/^"|"$/g, '');
      cols.set(norm(colName), { name: colName, type });
    }
    tables.set(norm(tableName), { name: tableName, cols });
  }
  if (tables.size === 0) throw new Error(`no tables found in ${DISPLAY.schemaSql}`);
  return tables;
}

/* ------------------------ packages/backend/convex ------------------------ */

function parseConvexTables(ts) {
  const tables = new Set();
  // defineSchema({ name: defineTable({...}), ... })
  const re = /\b([A-Za-z_$][\w$]*)\s*:\s*defineTable\s*\(/g;
  let m;
  while ((m = re.exec(ts)) !== null) tables.add(m[1]);
  // fallback: const NAME = defineTable({...})
  const re2 = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*defineTable\s*\(/g;
  while ((m = re2.exec(ts)) !== null) tables.add(m[1]);
  if (tables.size === 0) throw new Error(`no tables found in ${DISPLAY.convexSchema}`);
  return tables;
}

/* -------------------------------- mapping -------------------------------- */

function isObjectOrArray(v) {
  return v !== null && typeof v === 'object';
}

function isJsonType(type) {
  return typeof type === 'string' && type.toLowerCase().includes('json');
}

function mapField(convexTable, field, value, targetCols) {
  let col;
  if (field === '_id') col = 'convex_id';
  else if (field === '_creationTime') col = 'created_at';
  else if (field === 'createdAt') col = 'convex_created_at';
  else if (convexTable === 'leagues' && field === 'id') col = 'old_id';
  else col = camelToSnake(field);

  if (!targetCols) return null;
  const colInfo = targetCols.get(norm(col));
  if (!colInfo) return null;
  if (isObjectOrArray(value) && !isJsonType(colInfo.type)) return null;
  return col;
}

/* ------------------------------------------------------------------------- */

function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const positional = argv.filter((a) => a !== '--apply' && !a.startsWith('-'));
  const zipPath = positional[0];
  if (!zipPath) {
    throw new Error('usage: node scripts/import-convex-to-supabase.mjs <export.zip> [--apply]');
  }
  return { apply, zipPath };
}

function requireEnv(name) {
  const v = process.env[name];
  if (typeof v !== 'string' || v === '') throw new Error(`missing required environment variable ${name}`);
  return v;
}

function redact(s) {
  const secrets = [process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY].filter(
    (v) => typeof v === 'string' && v.length > 0
  );
  let out = String(s);
  for (const secret of secrets) out = out.split(secret).join('[redacted]');
  return out;
}

async function main() {
  const { apply, zipPath } = parseArgs(process.argv.slice(2));
  const supabaseUrl = apply ? requireEnv('SUPABASE_URL') : null;
  const serviceKey = apply ? requireEnv('SUPABASE_SERVICE_ROLE_KEY') : null;

  const docsByDir = readZipDocuments(zipPath);
  const supabaseTables = parseSupabaseSchema(readFileSync(SCHEMA_SQL_PATH, 'utf8'));
  const convexTables = parseConvexTables(readFileSync(CONVEX_SCHEMA_PATH, 'utf8'));
  const convexTableNorms = new Set([...convexTables].map(norm));

  for (const entry of docsByDir.values()) {
    if (!convexTableNorms.has(norm(entry.tableDir))) {
      console.log(`warning: zip table dir "${entry.tableDir}" has no matching Convex table in ${DISPLAY.convexSchema} — skipped`);
    }
  }

  const client = apply ? createClient(supabaseUrl, serviceKey) : null;
  let totalUpserted = 0;

  for (const convexTable of [...convexTables].sort()) {
    const targetTableName = camelToSnake(convexTable);
    const supTable = supabaseTables.get(norm(targetTableName));
    const targetCols = supTable ? supTable.cols : null;
    const displayTarget = supTable ? supTable.name : targetTableName;
    const entry = docsByDir.get(norm(convexTable));
    const docs = entry ? entry.docs : [];

    const rows = [];
    const unmapped = new Set();
    let rowsRead = 0;
    let rowsMapped = 0;
    for (const doc of docs) {
      rowsRead += 1;
      const row = {};
      let fullyMapped = true;
      for (const [field, value] of Object.entries(doc)) {
        const col = mapField(convexTable, field, value, targetCols);
        if (col) row[col] = value;
        else {
          fullyMapped = false;
          unmapped.add(field);
        }
      }
      if (row.convex_id === undefined) {
        fullyMapped = false;
        unmapped.add('_id');
      }
      if (fullyMapped && Object.keys(row).length > 0) rowsMapped += 1;
      rows.push(row);
    }

    let upserted = 0;
    if (apply) {
      if (!supTable) throw new Error(`${convexTable}: no target table "${targetTableName}" found in ${DISPLAY.schemaSql}`);
      const onConflict = convexTable === 'leagues' ? 'old_id' : 'convex_id';
      for (const row of rows) {
        if (row.convex_id === undefined) throw new Error(`${convexTable}: document without _id cannot be upserted`);
      }
      const toInsert = rows.filter((row) => Object.keys(row).length > 0);
      for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
        const batch = toInsert.slice(i, i + BATCH_SIZE);
        const { error } = await client.from(displayTarget).upsert(batch, { onConflict });
        if (error) throw new Error(`Supabase upsert failed for ${displayTarget}: ${error.message}`);
        upserted += batch.length;
      }
    }

    const unmappedStr = unmapped.size ? [...unmapped].sort().join(', ') : 'none';
    const line =
      `${convexTable} -> ${displayTarget}: rows read=${rowsRead}, rows mapped=${rowsMapped}` +
      (apply ? `, upserted=${upserted}` : '') +
      `, unmapped fields: ${unmappedStr}`;
    console.log(line);
    totalUpserted += upserted;
  }

  console.log(apply ? `done: applied ${totalUpserted} rows to Supabase` : 'dry run complete: no changes were sent to Supabase');
}

main().catch((err) => {
  const message = err && err.message ? err.message : String(err);
  console.error(`error: ${redact(message)}`);
  process.exit(1);
});
