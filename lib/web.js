/**
 * dsh-reasoning-bridge 的 web 专属入口：链路面板后端路由。
 * 只在 web profile 挂载（bundle patch 的 web insert 行）——headless/CLI 没有
 * webServer 服务，这个子入口不加载，核心（技能/提示词/设置）不受任何影响。
 *
 * 把「本地会话 ↔ 浏览器」的对接状态做成可查询/可启动的入口。
 * 护栏与 dsh-versions 同款：仅回环 + Host 校验 + POST Origin/Sec-Fetch-Site。
 * 授权的「启用」永远只在会话里经风险披露后发生；此处仅提供只读查询与吊销。
 */
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGETS } from '../skills/reasoning-bridge/scripts/targets-table.mjs';

export const name = 'dsh-reasoning-bridge-web';
export const inject = ['webServer', 'loader'];

const SCRIPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'reasoning-bridge', 'scripts');
const ROUTE_PREFIX = '/reasoning-bridge';

function safeJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

/** 跑一个技能脚本并取回 JSON；脚本以非零退出但输出 JSON 时仍视为结构化结果。 */
function runScript(script, args, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
        execFile(process.execPath, [join(SCRIPTS_DIR, script), ...args], { timeout: timeoutMs, windowsHide: true },
            (error, stdout, stderr) => {
                const text = String(stdout ?? '').trim();
                const parsed = text.startsWith('{') || text.startsWith('[') ? safeJson(text) : null;
                if (parsed !== null && parsed !== undefined) {
                    resolve(parsed);
                    return;
                }
                reject(new Error(text || String(stderr ?? '') || (error ? error.message : 'no output')));
            });
    });
}

function isLoopback(address) {
    return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function webPort(ctx) {
    for (const entry of ctx.loader.entries()) {
        if (entry.options?.name === '@deepseek-ai/dsh-host-webserver') {
            const port = entry.options?.config?.port;
            if (typeof port === 'number' && port > 0) return port;
        }
    }
    return 3080;
}

function allowedLocalOrigins(port) {
    return new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`]);
}

function isAllowedWriteOrigin(req, port) {
    const origin = typeof req.headers?.origin === 'string' ? req.headers.origin : null;
    const site = typeof req.headers?.['sec-fetch-site'] === 'string' ? req.headers['sec-fetch-site'] : null;
    if (origin !== null && origin !== '' && !allowedLocalOrigins(port).has(origin)) return false;
    if (site !== null && site !== 'same-origin' && site !== 'none') return false;
    return true;
}

function sendJson(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
}

function sendError(res, status, message) {
    sendJson(res, status, { ok: false, error: message });
}

function readBody(req, maxBytes = 8192) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > maxBytes) {
                reject(new Error('body too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

async function handleRoute(ctx, req, res) {
    const url = new URL(req.url ?? '/', 'http://x');
    const pathname = url.pathname;
    const method = req.method ?? 'GET';

    if (method === 'GET' && pathname === `${ROUTE_PREFIX}/state`) {
        const [consent, target, transport] = await Promise.all([
            runScript('consent.mjs', ['status', '--json'], 15000).catch((e) => ({ ok: false, error: String(e.message) })),
            runScript('target.mjs', ['get', '--json'], 15000).catch((e) => ({ ok: false, error: String(e.message) })),
            runScript('transport.mjs', ['status', '--json'], 15000).catch((e) => ({ ok: false, error: String(e.message) })),
        ]);
        // The target list rides along so the panel renders a real choice (id +
        // site + model-identity policy) from the same table the scripts use.
        sendJson(res, 200, { ok: true, node: process.version, consent, target, transport, targets: TARGETS });
        return;
    }

    if (method === 'POST' && pathname === `${ROUTE_PREFIX}/target`) {
        const body = safeJson(await readBody(req)) ?? {};
        const wanted = typeof body.target === 'string' ? body.target.trim() : '';
        if (!TARGETS.some((entry) => entry.id === wanted)) {
            sendError(res, 400, `unknown target: ${wanted || '(empty)'}; known: ${TARGETS.map((entry) => entry.id).join(', ')}`);
            return;
        }
        sendJson(res, 200, await runScript('target.mjs', ['set', wanted, '--json'], 15000));
        return;
    }

    if (method === 'POST' && pathname === `${ROUTE_PREFIX}/open`) {
        const body = safeJson(await readBody(req)) ?? {};
        const args = ['open', '--json'];
        if (typeof body.target === 'string' && body.target.trim() !== '') args.push('--target', body.target.trim());
        sendJson(res, 200, await runScript('transport.mjs', args, 60000));
        return;
    }

    if (method === 'POST' && pathname === `${ROUTE_PREFIX}/doctor`) {
        sendJson(res, 200, await runScript('doctor.mjs', ['--json'], 45000));
        return;
    }

    if (method === 'POST' && pathname === `${ROUTE_PREFIX}/launch`) {
        sendJson(res, 200, await runScript('transport.mjs', ['launch', '--json'], 120000));
        return;
    }

    if (method === 'POST' && pathname === `${ROUTE_PREFIX}/probe`) {
        sendJson(res, 200, await runScript('transport.mjs', ['probe', '--json'], 90000));
        return;
    }

    if (method === 'POST' && pathname === `${ROUTE_PREFIX}/consent`) {
        const body = safeJson(await readBody(req)) ?? {};
        if (body.action === 'disable') {
            // 仅吊销方向；「启用」必须在会话里经风险披露后由确认令牌完成。
            sendJson(res, 200, await runScript('consent.mjs', ['disable', '--json'], 15000));
            return;
        }
        sendError(res, 400, 'unsupported consent action (enable happens in chat, with the exact ack token)');
        return;
    }

    sendError(res, 404, 'unknown route');
}

export function apply(ctx) {
    ctx.effect(() => {
        const route = {
            kind: 'prefix',
            path: ROUTE_PREFIX,
            handler: async (req, res) => {
                if (!isLoopback(req.socket?.remoteAddress ?? '')) {
                    sendError(res, 403, '仅允许本机访问');
                    return;
                }
                const port = webPort(ctx);
                const host = typeof req.headers?.host === 'string' ? req.headers.host : '';
                if (![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host)) {
                    sendError(res, 403, 'Host 校验失败（仅允许本机访问）');
                    return;
                }
                const method = req.method ?? 'GET';
                if (method === 'POST' && !isAllowedWriteOrigin(req, port)) {
                    sendError(res, 403, '跨站请求被拒绝（Origin/Sec-Fetch-Site 校验）');
                    return;
                }
                try {
                    await handleRoute(ctx, req, res);
                } catch (error) {
                    sendError(res, 500, error instanceof Error ? error.message : String(error));
                }
            },
        };
        return ctx.webServer.register(route);
    }, 'dsh-reasoning-bridge-web.routes');
}
