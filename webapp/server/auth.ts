// 账号与会话：用户名+密码（scrypt 加盐哈希），会话 token 存数据库，cookie 有效期 30 天

import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from './db';

export const SESSION_DAYS = 30;

function hashPassword(password: string): string {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const candidate = scryptSync(password, salt, 64);
    return timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

export type AuthUser = { id: string; username: string };

export function registerUser(username: string, password: string): AuthUser {
    username = username.trim();
    if (!/^[\w一-龥-]{2,30}$/.test(username)) throw new Error('用户名需为 2-30 位的字母、数字、中文或下划线');
    if (password.length < 6) throw new Error('密码至少 6 位');
    const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (exists) throw new Error('用户名已被使用');
    const id = randomUUID();
    db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
        id,
        username,
        hashPassword(password),
        Date.now()
    );
    return { id, username };
}

export function loginUser(username: string, password: string): AuthUser {
    const row = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username.trim()) as
        | { id: string; username: string; password_hash: string | null }
        | undefined;
    if (!row?.password_hash || !verifyPassword(password, row.password_hash)) {
        throw new Error('用户名或密码不正确');
    }
    return { id: row.id, username: row.username };
}

export function changePassword(userId: string, oldPassword: string, newPassword: string): void {
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as
        | { password_hash: string | null }
        | undefined;
    if (!row?.password_hash || !verifyPassword(oldPassword, row.password_hash)) throw new Error('旧密码不正确');
    if (newPassword.length < 6) throw new Error('新密码至少 6 位');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), userId);
}

export function createSession(userId: string): string {
    const token = randomBytes(32).toString('hex');
    const now = Date.now();
    db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
        token,
        userId,
        now,
        now + SESSION_DAYS * 24 * 60 * 60 * 1000
    );
    // 顺手清理过期会话
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
    return token;
}

export function sessionUser(token: string): AuthUser | null {
    const row = db
        .prepare(
            `SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id
             WHERE s.token = ? AND s.expires_at > ?`
        )
        .get(token, Date.now()) as { id: string; username: string } | undefined;
    return row ?? null;
}

export function deleteSession(token: string): void {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}
