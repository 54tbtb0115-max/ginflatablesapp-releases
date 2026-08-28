import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './env';

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 旧版本数据库迁移：users 表补充登录字段（新表结构在 schema.sql 里已包含）
const userCols = db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
if (userCols.length > 0 && !userCols.some((c) => c.name === 'username')) {
    db.exec('ALTER TABLE users ADD COLUMN username TEXT; ALTER TABLE users ADD COLUMN password_hash TEXT;');
}

// schema.sql 全部是 CREATE ... IF NOT EXISTS，可重复执行
const schemaPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'schema.sql');
db.exec(readFileSync(schemaPath, 'utf8'));
