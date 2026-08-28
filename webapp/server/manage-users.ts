// 账号管理命令行工具（在 webapp/ 目录下执行）：
//   npm run user add <用户名> <密码>     创建账号
//   npm run user list                    列出所有账号
//   npm run user passwd <用户名> <新密码> 重置密码
//   npm run user disable <用户名>        禁用账号（清除密码并踢下线）

import { randomBytes, scryptSync } from 'node:crypto';
import { db } from './db';
import { registerUser } from './auth';

const [, , cmd, username, password] = process.argv;

function hashPassword(pw: string): string {
    const salt = randomBytes(16).toString('hex');
    return `${salt}:${scryptSync(pw, salt, 64).toString('hex')}`;
}

function requireArgs(...args: (string | undefined)[]): void {
    if (args.some((a) => !a)) {
        console.error('参数不足。用法见文件头部注释。');
        process.exit(1);
    }
}

switch (cmd) {
    case 'add': {
        requireArgs(username, password);
        const user = registerUser(username!, password!);
        console.log(`已创建账号：${user.username}`);
        break;
    }
    case 'list': {
        const rows = db
            .prepare(
                `SELECT username, created_at, password_hash IS NOT NULL AS active,
                        (SELECT COUNT(*) FROM images WHERE images.user_id = users.id AND kind = 'generated') AS images
                 FROM users WHERE username IS NOT NULL ORDER BY created_at`
            )
            .all() as { username: string; created_at: number; active: number; images: number }[];
        if (rows.length === 0) console.log('还没有账号，用 npm run user add <用户名> <密码> 创建。');
        for (const r of rows) {
            console.log(
                `${r.username}\t${r.active ? '正常' : '已禁用'}\t生成图片 ${r.images} 张\t创建于 ${new Date(r.created_at).toLocaleString('zh-CN')}`
            );
        }
        break;
    }
    case 'passwd': {
        requireArgs(username, password);
        if (password!.length < 6) {
            console.error('密码至少 6 位');
            process.exit(1);
        }
        const res = db
            .prepare('UPDATE users SET password_hash = ? WHERE username = ?')
            .run(hashPassword(password!), username);
        console.log(res.changes ? `已重置 ${username} 的密码` : `找不到账号 ${username}`);
        break;
    }
    case 'disable': {
        requireArgs(username);
        const res = db.prepare('UPDATE users SET password_hash = NULL WHERE username = ?').run(username);
        db.prepare('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?)').run(username);
        console.log(res.changes ? `已禁用 ${username}（历史图片保留）` : `找不到账号 ${username}`);
        break;
    }
    default:
        console.error('未知命令。用法见文件头部注释。');
        process.exit(1);
}
