import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './env';

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// schema.sql 全部是 CREATE ... IF NOT EXISTS，可重复执行
const schemaPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'schema.sql');
db.exec(readFileSync(schemaPath, 'utf8'));
