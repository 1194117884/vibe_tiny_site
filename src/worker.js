import { unzipSync } from 'fflate';

/**
 * TinySite · 静态网站部署工具
 * Cloudflare Workers + R2 + D1
 *
 * ============================ 路由设计 ============================
 * 站点访问（生产，域名模式，SITE_BASE_DOMAIN=yongkl.cc、SITE_HOST_SUFFIX=-ts）:
 *   https://{slug}-ts.yongkl.cc/              项目固定地址，始终指向当前发布版本
 *   https://{slug}-v{n}-ts.yongkl.cc/         历史版本地址
 *
 * 管理后台（顶级服务域名 / workers.dev / 本地）:
 *   GET    /                              管理界面
 *
 * API（管理接口）:
 *   POST   /api/projects                  创建项目        { name }
 *   GET    /api/projects?q=               项目列表 / 按名称、slug 搜索
 *   GET    /api/projects/:id              项目详情
 *   PATCH  /api/projects/:id              更新项目        { name }
 *   DELETE /api/projects/:id              删除项目（含 R2 全部文件）
 *   GET    /api/projects/:id/versions     版本列表
 *   POST   /api/projects/:id/versions     创建新版本（开始一次部署）
 *   POST   /api/projects/:id/rollback     回滚            { versionId }
 *   POST   /api/versions/:id/files        上传一个文件批次（multipart/form-data）
 *   POST   /api/versions/:id/finalize     完成部署并发布为当前版本
 *   POST   /api/versions/:id/abort        中止部署（清理残留文件）
 *
 *   GET    /api/config                    前端运行配置（站点域名后缀等）
 *
 * SEO / AI 发现（控制台静态资源 + 托管站点自动生成）:
 *   GET    /robots.txt /sitemap.xml /llms.txt
 *   项目站未上传时，Worker 按线上文件树自动生成对应内容
 *
 * 站点访问（兜底，路径模式，用于本地开发与 workers.dev）:
 *   GET    /s/:slug/*                     固定地址，始终指向当前发布版本
 *   GET    /v/:slug/:version/*            历史版本地址
 *
 * ============================ R2 目录规划 ============================
 *   sites/{projectId}/v{version}/{文件相对路径}
 *   例: sites/p_x8k2n1a9q3/v2/index.html
 *       sites/p_x8k2n1a9q3/v2/assets/app.a1b2c3.js
 * 所有历史版本文件全量保留，回滚 = 切换 projects.current_version_id 指针，秒级完成。
 */

// ------------------------------- 基础工具 -------------------------------

const MIME = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  cjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  rss: 'application/rss+xml; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  pdf: 'application/pdf',
  zip: 'application/zip',
  wasm: 'application/wasm',
  webmanifest: 'application/manifest+json',
};

function mimeOf(path) {
  const i = path.lastIndexOf('.');
  if (i < 0) return 'application/octet-stream';
  return MIME[path.slice(i + 1).toLowerCase()] || 'application/octet-stream';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function markdownInline(text) {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return html.replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, (_, label, href) => {
    try {
      const url = new URL(href, 'https://tinysite.invalid');
      if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return label;
      return `<a href="${escapeHtml(href)}"${url.protocol === 'http:' || url.protocol === 'https:' ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`;
    } catch {
      return label;
    }
  });
}

/** 轻量、安全的 Markdown 展示，用于分享 AI 生成的文档，不执行 Markdown 内的 HTML。 */
function markdownToHtml(source) {
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) {
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      if (i < lines.length) i++;
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${markdownInline(heading[2])}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    if (/^>\s?/.test(line)) { out.push(`<blockquote>${markdownInline(line.replace(/^>\s?/, ''))}</blockquote>`); i++; continue; }
    const list = line.match(/^\s*([-*+] |\d+\. )(.+)$/);
    if (list) {
      const ordered = /^\d+\. /.test(list[1]);
      const items = [];
      while (i < lines.length) {
        const item = lines[i].match(/^\s*(?:[-*+] |\d+\. )(.+)$/);
        if (!item) break;
        items.push(`<li>${markdownInline(item[1])}</li>`);
        i++;
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    const paragraph = [];
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith('```') &&
      !/^(#{1,6}\s|>\s?|\s*[-*+] |\s*\d+\. )/.test(lines[i])) paragraph.push(lines[i++]);
    out.push(`<p>${markdownInline(paragraph.join(' '))}</p>`);
  }
  return out.join('\n');
}

function markdownPage(source) {
  const title = String(source).match(/^#\s+(.+)$/m)?.[1] || 'Markdown 文档';
  return new Response(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{margin:0;background:#f7f8fa;color:#1f2937;font:16px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}main{max-width:800px;margin:48px auto;padding:44px 52px;background:#fff;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 2px 14px #0000000d}h1,h2,h3{line-height:1.3;margin:1.5em 0 .55em}h1{margin-top:0;font-size:2em}a{color:#d7660a}pre{overflow:auto;padding:16px;background:#1f2937;color:#f9fafb;border-radius:8px}code{font: .9em ui-monospace,SFMono-Regular,Menlo,monospace;background:#f1f3f5;padding:2px 5px;border-radius:4px}pre code{padding:0;background:transparent}blockquote{margin:1em 0;padding:4px 16px;border-left:4px solid #f6821f;background:#fff7ed;color:#5b6470}img{max-width:100%}@media(max-width:700px){main{margin:0;padding:28px 22px;border:0;border-radius:0}}</style></head><body><main>${markdownToHtml(source)}</main></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
function uid(prefix = '') {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return prefix + s;
}

/** 清洗相对路径，防止 ../ 穿越 */
function safePath(p) {
  return String(p || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((seg) => seg.trim())
    .filter((seg) => seg && seg !== '.' && seg !== '..')
    .join('/');
}

function errorPage(status, title, desc) {
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${status} · ${title}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f5f6f8;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#17202a}
.box{text-align:center;padding:40px}.code{font-size:64px;font-weight:800;color:#f6821f}h1{font-size:20px;margin:12px 0 8px}p{color:#68737f;font-size:14px}</style></head>
<body><div class="box"><div class="code">${status}</div><h1>${title}</h1><p>${desc || ''}</p></div></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

const DEFAULT_PAGES = {
  'index.html': `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>网站已创建 · TinySite</title>
  <meta name="description" content="此站点已在 TinySite 创建。上传 index.html 后即可作为首页对外访问；请补充标题、描述与 Open Graph 标签以提升搜索与分享效果。">
  <meta name="robots" content="index,follow">
  <meta property="og:type" content="website">
  <meta property="og:title" content="网站已创建 · TinySite">
  <meta property="og:description" content="上传 index.html 后即可作为首页对外访问。">
</head>
<body style="margin:0;display:grid;min-height:100vh;place-items:center;background:#f5f6f8;color:#17202a;font:16px -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif">
  <main style="max-width:560px;padding:40px;text-align:center">
    <h1>网站已创建</h1>
    <p>上传 <code>index.html</code> 后，它将成为此域名的首页。其他 HTML 文件请通过文件名访问。</p>
    <p style="color:#68737f;font-size:14px">建议在页面中设置 <code>&lt;title&gt;</code>、meta description 与 Open Graph，便于搜索引擎与 AI 抓取。</p>
  </main>
</body>
</html>`,
  '404.html': '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>404 · 页面不存在</title><meta name="robots" content="noindex"></head><body style="margin:0;display:grid;min-height:100vh;place-items:center;background:#f5f6f8;color:#17202a;font:16px -apple-system,BlinkMacSystemFont,\'PingFang SC\',sans-serif"><main style="text-align:center"><h1>404</h1><p>页面不存在。</p></main></body></html>',
  '50x.html': '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>服务器错误</title><meta name="robots" content="noindex"></head><body style="margin:0;display:grid;min-height:100vh;place-items:center;background:#f5f6f8;color:#17202a;font:16px -apple-system,BlinkMacSystemFont,\'PingFang SC\',sans-serif"><main style="text-align:center"><h1>服务器错误</h1><p>请稍后重试。</p></main></body></html>',
};

async function createDefaultPages(env, projectId) {
  await Promise.all(Object.entries(DEFAULT_PAGES).map(([path, body]) => env.BUCKET.put(
    `sites/${projectId}/defaults/${path}`,
    body,
    { httpMetadata: { contentType: 'text/html; charset=utf-8' } },
  )));
}

// 新项目只初始化可直接访问的首页；错误页由平台统一处理。
const INITIAL_TEMPLATE = { 'index.html': DEFAULT_PAGES['index.html'] };

/** 新项目立即发布 v1 模板，模板文件可在工作区中查看、编辑和覆盖。 */
async function createInitialVersion(env, projectId, now) {
  const versionId = uid('v_');
  const files = Object.entries(INITIAL_TEMPLATE).map(([path, body]) => ({
    path,
    body,
    key: `sites/${projectId}/v1/${path}`,
  }));
  await Promise.all(files.map((file) => env.BUCKET.put(file.key, file.body, {
    httpMetadata: { contentType: 'text/html; charset=utf-8' },
  })));
  const statements = [
    env.DB.prepare(`INSERT INTO versions (id, project_id, version, file_count, total_size, status, created_at)
      VALUES (?, ?, 1, ?, ?, 'active', ?)`).bind(
      versionId, projectId, files.length, files.reduce((total, file) => total + new TextEncoder().encode(file.body).byteLength, 0), now
    ),
    env.DB.prepare('UPDATE projects SET current_version_id = ? WHERE id = ?').bind(versionId, projectId),
    ...files.flatMap((file) => {
      const size = new TextEncoder().encode(file.body).byteLength;
      return [
        env.DB.prepare('INSERT INTO files (version_id, path, r2_key, size, mime) VALUES (?, ?, ?, ?, ?)')
          .bind(versionId, file.path, file.key, size, 'text/html; charset=utf-8'),
        env.DB.prepare(`INSERT INTO project_files (project_id, path, r2_key, size, mime, updated_version_id)
          VALUES (?, ?, ?, ?, ?, ?)`).bind(projectId, file.path, file.key, size, 'text/html; charset=utf-8', versionId),
      ];
    }),
  ];
  await env.DB.batch(statements);
  return versionId;
}

// ------------------------------- 迷你路由 -------------------------------

function matchPath(pattern, pathname) {
  const p = pattern.split('/').filter(Boolean);
  const a = pathname.split('/').filter(Boolean);
  if (p.length !== a.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(a[i]);
    else if (p[i] !== a[i]) return null;
  }
  return params;
}

// ------------------------------- 账号与权限 -------------------------------

const SESSION_MAX_AGE = 30 * 24 * 60 * 60;
const PLAN_DAY_MS = 24 * 60 * 60 * 1000;

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomCode() {
  return `TS-${randomToken().slice(0, 20).toUpperCase()}`;
}

function parseCookies(request) {
  return Object.fromEntries((request.headers.get('cookie') || '').split(';').map((part) => {
    const i = part.indexOf('=');
    return i < 0 ? [] : [part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim())];
  }).filter((part) => part.length));
}

function sessionCookie(id, maxAge = SESSION_MAX_AGE) {
  return `tinysite_session=${encodeURIComponent(id)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function passwordHash(password, salt) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' }, material, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function publicUser(user) {
  return { id: user.id, email: user.email, role: user.role, plan_id: user.plan_id, plan_expires_at: user.plan_expires_at, status: user.status };
}

async function currentUser(request, env) {
  const sessionId = parseCookies(request).tinysite_session;
  if (!sessionId) return null;
  const user = await env.DB.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ? AND s.expires_at > ?`).bind(sessionId, Date.now()).first();
  return user || null;
}

/** 将未结束的权益按套餐等级重新排期；每条权益始终独立保留。 */
async function refreshEntitlementSchedule(env, userId) {
  const known = await env.DB.prepare('SELECT COUNT(*) AS count FROM plan_entitlements WHERE user_id = ?').bind(userId).first();
  if (!Number(known.count)) return false;
  const now = Date.now();
  await env.DB.prepare(`UPDATE plan_entitlements SET status = 'expired'
    WHERE user_id = ? AND status IN ('active', 'queued') AND ends_at <= ?`).bind(userId, now).run();
  const result = await env.DB.prepare(`SELECT e.*, p.monthly_price_cents FROM plan_entitlements e
    JOIN plans p ON p.id = e.plan_id WHERE e.user_id = ? AND e.status IN ('active', 'queued') AND e.ends_at > ?`)
    .bind(userId, now).all();
  const entries = result.results.map((entry) => ({
    ...entry,
    remaining: Number(entry.ends_at) - Math.max(Number(entry.starts_at), now),
  })).filter((entry) => entry.remaining > 0)
    .sort((a, b) => Number(b.monthly_price_cents) - Number(a.monthly_price_cents) || Number(a.created_at) - Number(b.created_at));
  if (!entries.length) {
    await env.DB.prepare("UPDATE users SET plan_id = 'free', plan_expires_at = NULL WHERE id = ?").bind(userId).run();
    return true;
  }
  let cursor = now;
  const updates = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const startsAt = cursor;
    const endsAt = startsAt + entry.remaining;
    cursor = endsAt;
    updates.push(env.DB.prepare('UPDATE plan_entitlements SET status = ?, starts_at = ?, ends_at = ? WHERE id = ?')
      .bind(i === 0 ? 'active' : 'queued', startsAt, endsAt, entry.id));
  }
  updates.push(env.DB.prepare('UPDATE users SET plan_id = ?, plan_expires_at = ? WHERE id = ?')
    .bind(entries[0].plan_id, now + entries[0].remaining, userId));
  await env.DB.batch(updates);
  return true;
}

async function createSession(env, userId) {
  const id = randomToken();
  const now = Date.now();
  await env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, userId, now + SESSION_MAX_AGE * 1000, now).run();
  return id;
}

async function register(request, env) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: '请输入有效邮箱' }, 400);
  if (password.length < 8 || password.length > 128) return json({ error: '密码长度应为 8–128 个字符' }, 400);
  const now = Date.now();
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return json({ error: '该邮箱已注册，请直接登录' }, 409);
  const id = uid('u_');
  const salt = randomToken();
  const hash = await passwordHash(password, salt);
  await env.DB.prepare(`INSERT INTO users (id, email, password_hash, password_salt, role, plan_id, status, created_at)
    VALUES (?, ?, ?, ?, 'user', 'free', 'active', ?)`).bind(id, email, hash, salt, now).run();
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  const sessionId = await createSession(env, id);
  const response = json({ user: publicUser(user) }, 201);
  response.headers.set('Set-Cookie', sessionCookie(sessionId));
  return response;
}

async function login(request, env) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (!user || await passwordHash(password, user.password_salt) !== user.password_hash) return json({ error: '邮箱或密码错误' }, 401);
  if (user.status !== 'active') return json({ error: '账号已暂停，请联系管理员' }, 403);
  await refreshEntitlementSchedule(env, user.id);
  const effectiveUser = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
  const sessionId = await createSession(env, user.id);
  const response = json({ user: publicUser(effectiveUser) });
  response.headers.set('Set-Cookie', sessionCookie(sessionId));
  return response;
}

async function logout(request, env) {
  const sessionId = parseCookies(request).tinysite_session;
  if (sessionId) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
  const response = json({ ok: true });
  response.headers.set('Set-Cookie', sessionCookie('', 0));
  return response;
}

/** POST /api/account/password  验证旧密码后更新，并撤销其他设备会话。 */
async function changePassword(request, env) {
  const body = await request.json().catch(() => ({}));
  const currentPassword = String(body.currentPassword || '');
  const newPassword = String(body.newPassword || '');
  if (newPassword.length < 8) return json({ error: '新密码至少需要 8 位' }, 400);
  const userId = request.headers.get('x-tinysite-user-id');
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
  if (!user || await passwordHash(currentPassword, user.password_salt) !== user.password_hash) {
    return json({ error: '当前密码不正确' }, 401);
  }
  if (currentPassword === newPassword) return json({ error: '新密码不能与当前密码相同' }, 400);
  const salt = randomToken();
  const hash = await passwordHash(newPassword, salt);
  await audit(env, request, 'password.change', 'user', user.id);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').bind(hash, salt, user.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
  ]);
  const sessionId = await createSession(env, user.id);
  const response = json({ ok: true });
  response.headers.set('Set-Cookie', sessionCookie(sessionId));
  return response;
}

async function requireOwnedResource(env, user, pathname) {
  const project = pathname.match(/^\/api\/projects\/([^/]+)/)?.[1];
  const version = pathname.match(/^\/api\/versions\/([^/]+)/)?.[1];
  if (!project && !version) return true;
  const row = project
    ? await env.DB.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').bind(project, user.id).first()
    : await env.DB.prepare(`SELECT v.id FROM versions v JOIN projects p ON p.id = v.project_id
      WHERE v.id = ? AND p.user_id = ?`).bind(version, user.id).first();
  return Boolean(row);
}

async function accountFor(request, env) {
  const userId = request.headers.get('x-tinysite-user-id');
  return env.DB.prepare(`SELECT u.*, pl.project_limit, pl.storage_limit_bytes, pl.traffic_limit_bytes
    FROM users u JOIN plans pl ON pl.id = u.plan_id WHERE u.id = ?`).bind(userId).first();
}

async function ensureStorageLimit(env, account, version, pendingRows) {
  const draft = await env.DB.prepare('SELECT path, action, size FROM file_changes WHERE version_id = ?').bind(version.id).all();
  const sizes = new Map();
  const current = await env.DB.prepare('SELECT path, size FROM project_files WHERE project_id = ?').bind(version.project_id).all();
  for (const file of current.results) sizes.set(file.path, Number(file.size));
  for (const change of draft.results) change.action === 'delete' ? sizes.delete(change.path) : sizes.set(change.path, Number(change.size));
  for (const row of pendingRows) sizes.set(row.path, Number(row.size));
  const nextSize = [...sizes.values()].reduce((total, size) => total + size, 0);
  if (nextSize > Number(account.storage_limit_bytes)) {
    return json({ error: `存储额度不足：本次部署后需 ${nextSize} 字节，套餐上限为 ${account.storage_limit_bytes} 字节` }, 413);
  }
  return null;
}

/** GET /api/account/usage  当前账号的套餐、存储与当月流量用量。 */
async function accountUsage(request, env) {
  await refreshEntitlementSchedule(env, request.headers.get('x-tinysite-user-id'));
  const account = await accountFor(request, env);
  const period = new Date().toISOString().slice(0, 7);
  const [projects, storage, traffic, plans, entitlements] = await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) AS count FROM projects WHERE user_id = ?').bind(account.id),
    env.DB.prepare(`SELECT COALESCE(SUM(pf.size), 0) AS bytes FROM project_files pf
      JOIN projects p ON p.id = pf.project_id WHERE p.user_id = ?`).bind(account.id),
    env.DB.prepare('SELECT traffic_bytes FROM monthly_usage WHERE user_id = ? AND period = ?').bind(account.id, period),
    env.DB.prepare('SELECT id, monthly_price_cents, project_limit, storage_limit_bytes, traffic_limit_bytes FROM plans ORDER BY monthly_price_cents'),
    env.DB.prepare(`SELECT e.id, e.plan_id, e.duration_days, e.source_type, e.status, e.starts_at, e.ends_at, e.created_at
      FROM plan_entitlements e WHERE e.user_id = ? ORDER BY e.starts_at`).bind(account.id),
  ]);
  return json({
    plan: {
      id: account.plan_id,
      project_limit: Number(account.project_limit),
      storage_limit_bytes: Number(account.storage_limit_bytes),
      traffic_limit_bytes: Number(account.traffic_limit_bytes),
      expires_at: account.plan_expires_at,
      status: account.status,
    },
    usage: {
      projects: Number(projects.results[0].count),
      storage_bytes: Number(storage.results[0].bytes),
      traffic_bytes: Number(traffic.results[0]?.traffic_bytes || 0),
      period,
    },
    plans: plans.results.map((plan) => ({
      id: plan.id,
      monthly_price_cents: Number(plan.monthly_price_cents),
      project_limit: Number(plan.project_limit),
      storage_limit_bytes: Number(plan.storage_limit_bytes),
      traffic_limit_bytes: Number(plan.traffic_limit_bytes),
    })),
    entitlements: entitlements.results,
  });
}

/** POST /api/account/plan  内测阶段的模拟套餐开通。 */
async function selectAccountPlan(request, env) {
  const body = await request.json().catch(() => ({}));
  const planId = String(body.planId || '');
  const target = await env.DB.prepare('SELECT * FROM plans WHERE id = ?').bind(planId).first();
  if (!target) return json({ error: '套餐不存在' }, 404);
  if (target.id === 'free') return json({ error: 'Free 是基础套餐，无需购买' }, 400);
  const userId = request.headers.get('x-tinysite-user-id');
  const [projects, storage] = await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) AS count FROM projects WHERE user_id = ?').bind(userId),
    env.DB.prepare(`SELECT COALESCE(SUM(pf.size), 0) AS bytes FROM project_files pf
      JOIN projects p ON p.id = pf.project_id WHERE p.user_id = ?`).bind(userId),
  ]);
  if (Number(projects.results[0].count) > Number(target.project_limit)) {
    return json({ error: `当前有 ${projects.results[0].count} 个项目，无法切换到最多 ${target.project_limit} 个项目的套餐` }, 409);
  }
  if (Number(storage.results[0].bytes) > Number(target.storage_limit_bytes)) {
    return json({ error: '当前存储用量超过目标套餐上限，请先删除文件或选择更高套餐' }, 409);
  }
  const now = Date.now();
  const entitlementId = uid('ent_');
  await env.DB.prepare(`INSERT INTO plan_entitlements (id, user_id, plan_id, duration_days, source_type, status, starts_at, ends_at, created_at)
    VALUES (?, ?, ?, 30, 'simulated_purchase', 'queued', ?, ?, ?)`).bind(entitlementId, userId, target.id, now, now + 30 * PLAN_DAY_MS, now).run();
  await refreshEntitlementSchedule(env, userId);
  await audit(env, request, 'plan.simulated_checkout', 'entitlement', entitlementId, { planId: target.id, durationDays: 30 });
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
  return json({ user: publicUser(user), entitlement_id: entitlementId });
}

/** POST /api/account/redeem-code  登录后兑换套餐权益。 */
async function redeemActivationCode(request, env) {
  const body = await request.json().catch(() => ({}));
  const code = String(body.code || '').trim();
  if (!code) return json({ error: '请输入兑换码' }, 400);
  const now = Date.now();
  const activation = await env.DB.prepare(`SELECT * FROM activation_codes
    WHERE code_hash = ? AND used_count < max_uses AND (expires_at IS NULL OR expires_at > ?)`)
    .bind(await sha256(code), now).first();
  if (!activation) return json({ error: '兑换码无效、已用完或已过期' }, 400);
  const used = await env.DB.prepare('UPDATE activation_codes SET used_count = used_count + 1 WHERE id = ? AND used_count < max_uses')
    .bind(activation.id).run();
  if (!used.meta.changes) return json({ error: '兑换码刚刚被用完，请重试' }, 409);
  const userId = request.headers.get('x-tinysite-user-id');
  const entitlementId = uid('ent_');
  try {
    await env.DB.prepare(`INSERT INTO plan_entitlements (id, user_id, plan_id, duration_days, source_type, source_ref, status, starts_at, ends_at, created_at)
      VALUES (?, ?, ?, ?, 'activation_code', ?, 'queued', ?, ?, ?)`).bind(
      entitlementId, userId, activation.plan_id, activation.duration_days, activation.id, now,
      now + Number(activation.duration_days) * PLAN_DAY_MS, now,
    ).run();
  } catch (err) {
    await env.DB.prepare('UPDATE activation_codes SET used_count = MAX(used_count - 1, 0) WHERE id = ?').bind(activation.id).run();
    throw err;
  }
  await refreshEntitlementSchedule(env, userId);
  await audit(env, request, 'activation_code.redeem', 'entitlement', entitlementId, { activationCodeId: activation.id, planId: activation.plan_id, durationDays: activation.duration_days });
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
  return json({ user: publicUser(user), entitlement_id: entitlementId, plan_id: activation.plan_id, duration_days: activation.duration_days });
}

async function adminOverview(request, env) {
  const [users, projects, versions, codes] = await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) AS count FROM users'),
    env.DB.prepare('SELECT COUNT(*) AS count FROM projects'),
    env.DB.prepare("SELECT COUNT(*) AS count FROM versions WHERE status = 'active'"),
    env.DB.prepare('SELECT COUNT(*) AS count FROM activation_codes WHERE used_count < max_uses'),
  ]);
  return json({ users: users.results[0].count, projects: projects.results[0].count, active_versions: versions.results[0].count, available_codes: codes.results[0].count });
}

async function audit(env, request, action, targetType, targetId, detail = null) {
  const user = await currentUser(request, env);
  await env.DB.prepare('INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(uid('log_'), user?.id || null, action, targetType, targetId, detail ? JSON.stringify(detail) : null, Date.now()).run();
}

async function adminListUsers(request, env) {
  const users = await env.DB.prepare(`SELECT u.id, u.email, u.role, u.plan_id, u.plan_expires_at, u.status, u.created_at,
    (SELECT COUNT(*) FROM projects p WHERE p.user_id = u.id) AS project_count FROM users u ORDER BY u.created_at DESC`).all();
  return json({ users: users.results });
}

async function adminListAuditLogs(request, env) {
  const logs = await env.DB.prepare(`SELECT a.id, a.action, a.target_type, a.target_id, a.detail, a.created_at,
    u.email AS actor_email FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
    ORDER BY a.created_at DESC LIMIT 100`).all();
  return json({ logs: logs.results });
}

async function adminListEntitlements(request, env) {
  const result = await env.DB.prepare(`SELECT e.id, e.user_id, e.plan_id, e.duration_days, e.source_type, e.status,
    e.starts_at, e.ends_at, e.created_at, u.email FROM plan_entitlements e JOIN users u ON u.id = e.user_id
    ORDER BY e.created_at DESC LIMIT 200`).all();
  return json({ entitlements: result.results });
}

async function adminUpdateEntitlement(request, env, url, { id }) {
  const body = await request.json().catch(() => ({}));
  const status = ['refunded', 'revoked'].includes(body.status) ? body.status : null;
  if (!status) return json({ error: '只支持退款或撤销权益' }, 400);
  const entitlement = await env.DB.prepare("SELECT * FROM plan_entitlements WHERE id = ? AND status IN ('active', 'queued')").bind(id).first();
  if (!entitlement) return json({ error: '权益不存在或已结束' }, 404);
  await env.DB.prepare('UPDATE plan_entitlements SET status = ? WHERE id = ?').bind(status, id).run();
  await refreshEntitlementSchedule(env, entitlement.user_id);
  await audit(env, request, `entitlement.${status}`, 'entitlement', id, { userId: entitlement.user_id, planId: entitlement.plan_id });
  return json({ ok: true });
}

async function adminUpdateUser(request, env, url, { id }) {
  const body = await request.json().catch(() => ({}));
  const planId = ['free', 'pro', 'plus', 'ultra'].includes(body.planId) ? body.planId : null;
  const status = ['active', 'suspended'].includes(body.status) ? body.status : null;
  const planExpiresAt = body.planExpiresAt === null ? null : Number(body.planExpiresAt);
  if (!planId && !status && body.planExpiresAt === undefined) return json({ error: '没有可更新的字段' }, 400);
  const target = await env.DB.prepare('SELECT id, role FROM users WHERE id = ?').bind(id).first();
  if (!target) return json({ error: '用户不存在' }, 404);
  const actor = await currentUser(request, env);
  if (target.id === actor.id && status === 'suspended') return json({ error: '不能暂停当前管理员账号' }, 400);
  if (planExpiresAt !== null && body.planExpiresAt !== undefined && (!Number.isFinite(planExpiresAt) || planExpiresAt < Date.now())) {
    return json({ error: '到期时间必须在未来，或传 null 表示不设到期' }, 400);
  }
  const user = await env.DB.prepare(`UPDATE users SET plan_id = COALESCE(?, plan_id), status = COALESCE(?, status),
    plan_expires_at = CASE WHEN ? THEN ? ELSE plan_expires_at END WHERE id = ? RETURNING id, email, role, plan_id, plan_expires_at, status, created_at`)
    .bind(planId, status, body.planExpiresAt !== undefined ? 1 : 0, planExpiresAt, id).first();
  await audit(env, request, 'user.update', 'user', id, { planId, status, planExpiresAt: body.planExpiresAt });
  return json({ user });
}

async function adminGrantEntitlement(request, env, url, { id }) {
  const body = await request.json().catch(() => ({}));
  const planId = ['pro', 'plus', 'ultra'].includes(body.planId) ? body.planId : null;
  const durationDays = Math.max(1, Math.min(Number(body.durationDays) || 0, 3650));
  if (!planId || !durationDays) return json({ error: '请选择付费套餐并填写 1–3650 天' }, 400);
  const target = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(id).first();
  if (!target) return json({ error: '用户不存在' }, 404);
  const now = Date.now();
  const entitlementId = uid('ent_');
  await env.DB.prepare(`INSERT INTO plan_entitlements (id, user_id, plan_id, duration_days, source_type, status, starts_at, ends_at, created_at)
    VALUES (?, ?, ?, ?, 'admin_grant', 'queued', ?, ?, ?)`).bind(
    entitlementId, id, planId, durationDays, now, now + durationDays * PLAN_DAY_MS, now,
  ).run();
  await refreshEntitlementSchedule(env, id);
  await audit(env, request, 'entitlement.admin_grant', 'entitlement', entitlementId, { userId: id, planId, durationDays });
  return json({ entitlement_id: entitlementId });
}

async function adminListProjects(request, env) {
  const result = await env.DB.prepare(`SELECT p.id, p.name, p.slug, p.created_at, p.current_version_id, u.email AS owner_email,
    (SELECT COUNT(*) FROM versions v WHERE v.project_id = p.id AND v.status = 'active') AS version_count,
    (SELECT COALESCE(SUM(size), 0) FROM project_files pf WHERE pf.project_id = p.id) AS storage_bytes
    FROM projects p JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC`).all();
  return json({ projects: result.results });
}

/** GET /api/admin/projects/:id  运营后台查看项目、版本与当前线上文件。 */
async function adminProjectDetail(request, env, url, { id }) {
  const project = await env.DB.prepare(`SELECT p.id, p.name, p.slug, p.created_at, p.current_version_id,
    u.email AS owner_email FROM projects p JOIN users u ON u.id = p.user_id WHERE p.id = ?`).bind(id).first();
  if (!project) return json({ error: '项目不存在' }, 404);
  await ensureProjectFiles(env, id, project.current_version_id);
  const [versions, files] = await env.DB.batch([
    env.DB.prepare('SELECT id, version, file_count, total_size, status, created_at FROM versions WHERE project_id = ? ORDER BY version DESC').bind(id),
    env.DB.prepare('SELECT path, size, mime, updated_version_id FROM project_files WHERE project_id = ? ORDER BY path').bind(id),
  ]);
  return json({ project, versions: versions.results, files: files.results });
}

async function adminDeleteProject(request, env, url, { id }) {
  const p = await env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(id).first();
  if (!p) return json({ error: '项目不存在' }, 404);
  await deleteR2Prefix(env, `sites/${id}/`);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM project_files WHERE project_id = ?').bind(id),
    env.DB.prepare('DELETE FROM files WHERE version_id IN (SELECT id FROM versions WHERE project_id = ?)').bind(id),
    env.DB.prepare('DELETE FROM versions WHERE project_id = ?').bind(id),
    env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id),
  ]);
  await audit(env, request, 'project.delete', 'project', id);
  return json({ ok: true });
}

async function adminCreateActivationCode(request, env) {
  const body = await request.json().catch(() => ({}));
  const planId = ['free', 'pro', 'plus', 'ultra'].includes(body.planId) ? body.planId : 'free';
  const durationDays = Math.max(1, Math.min(Number(body.durationDays) || 30, 3650));
  const maxUses = Math.max(1, Math.min(Number(body.maxUses) || 1, 1000));
  const expiresAt = Number(body.expiresAt) || null;
  if (expiresAt && expiresAt <= Date.now()) return json({ error: '过期时间必须在未来' }, 400);
  const code = randomCode();
  const user = await currentUser(request, env);
  const id = uid('ac_');
  await env.DB.prepare(`INSERT INTO activation_codes (id, code_hash, code_display, plan_id, role, duration_days, max_uses, expires_at, created_at, created_by)
    VALUES (?, ?, ?, ?, 'user', ?, ?, ?, ?, ?)`).bind(id, await sha256(code), code, planId, durationDays, maxUses, expiresAt, Date.now(), user.id).run();
  await audit(env, request, 'activation_code.create', 'activation_code', id, { planId, durationDays, maxUses, expiresAt });
  return json({ code, plan_id: planId, duration_days: durationDays, max_uses: maxUses, expires_at: expiresAt }, 201);
}

async function adminListActivationCodes(request, env) {
  const codes = await env.DB.prepare(`SELECT id, code_display, plan_id, duration_days, max_uses, used_count, expires_at, created_at,
    (SELECT email FROM users WHERE id = activation_codes.created_by) AS created_by_email
    FROM activation_codes ORDER BY created_at DESC LIMIT 200`).all();
  const records = await env.DB.prepare(`SELECT e.source_ref AS activation_code_id, u.email, e.created_at, e.plan_id, e.duration_days
    FROM plan_entitlements e JOIN users u ON u.id = e.user_id WHERE e.source_type = 'activation_code' ORDER BY e.created_at DESC`).all();
  const recordsByCode = new Map();
  for (const record of records.results) {
    const list = recordsByCode.get(record.activation_code_id) || [];
    list.push({ email: record.email, created_at: record.created_at });
    recordsByCode.set(record.activation_code_id, list);
  }
  return json({ codes: codes.results.map((code) => ({ ...code, activation_records: recordsByCode.get(code.id) || [] })) });
}

async function adminDeleteActivationCode(request, env, url, { id }) {
  const result = await env.DB.prepare('DELETE FROM activation_codes WHERE id = ?').bind(id).run();
  if (!result.meta.changes) return json({ error: '激活码不存在' }, 404);
  await audit(env, request, 'activation_code.delete', 'activation_code', id);
  return json({ ok: true });
}

// ------------------------------- API 处理器 -------------------------------

/** POST /api/projects  创建项目 */
async function createProject(request, env) {
  const body = await request.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  if (!name) return json({ error: '项目名称不能为空' }, 400);
  if (name.length > 60) return json({ error: '项目名称不能超过 60 个字符' }, 400);
  const account = await accountFor(request, env);
  const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM projects WHERE user_id = ?').bind(account.id).first();
  if (Number(count.count) >= Number(account.project_limit)) return json({ error: `当前套餐最多可创建 ${account.project_limit} 个项目` }, 403);

  const id = uid('p_');
  // 随机三级域名标识:{slug}.{SITE_BASE_DOMAIN} 即站点固定地址(纯 [a-z0-9],无连字符,
  // 保证历史版本地址 {slug}-v{n} 解析无歧义)
  let slug = uid('');
  for (let i = 0; i < 5; i++) {
    const exists = await env.DB.prepare('SELECT id FROM projects WHERE slug = ?').bind(slug).first();
    if (!exists) break;
    slug = uid('');
  }
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO projects (id, user_id, name, slug, created_at, current_version_id) VALUES (?, ?, ?, ?, ?, NULL)'
  ).bind(id, account.id, name, slug, now).run();
  const initialVersionId = await createInitialVersion(env, id, now);
  return json({ project: { id, name, slug, created_at: now, current_version_id: initialVersionId } });
}

/** GET /api/projects?q=  项目列表 / 搜索 */
async function listProjects(request, env, url) {
  const q = (url.searchParams.get('q') || '').trim();
  const userId = request.headers.get('x-tinysite-user-id');
  const base = `
    SELECT p.id, p.name, p.slug, p.created_at, p.current_version_id,
           cv.version AS current_version,
           (SELECT COUNT(*) FROM versions v WHERE v.project_id = p.id AND v.status <> 'uploading') AS version_count,
           (SELECT MAX(v.created_at) FROM versions v WHERE v.project_id = p.id AND v.status = 'active') AS last_deployed_at
    FROM projects p
    LEFT JOIN versions cv ON cv.id = p.current_version_id`;
  const result = q
    ? await env.DB.prepare(`${base} WHERE p.user_id = ? AND (p.name LIKE ? OR p.slug LIKE ?) ORDER BY p.created_at DESC`)
        .bind(userId, `%${q}%`, `%${q}%`).all()
    : await env.DB.prepare(`${base} WHERE p.user_id = ? ORDER BY p.created_at DESC`).bind(userId).all();
  return json({ projects: result.results });
}

/** GET /api/projects/:id  项目详情 */
async function getProject(request, env, url, { id }) {
  const p = await env.DB.prepare(`
    SELECT p.*, cv.version AS current_version
    FROM projects p LEFT JOIN versions cv ON cv.id = p.current_version_id
    WHERE p.id = ?`).bind(id).first();
  if (!p) return json({ error: '项目不存在' }, 404);
  return json({ project: p });
}

/** PATCH /api/projects/:id  更新项目信息（目前仅支持修改显示名称） */
async function updateProject(request, env, url, { id }) {
  const existing = await env.DB.prepare(`
    SELECT p.*, cv.version AS current_version
    FROM projects p LEFT JOIN versions cv ON cv.id = p.current_version_id
    WHERE p.id = ?`).bind(id).first();
  if (!existing) return json({ error: '项目不存在' }, 404);

  const body = await request.json().catch(() => ({}));
  if (!Object.prototype.hasOwnProperty.call(body, 'name')) {
    return json({ error: '请提供要更新的字段' }, 400);
  }
  const name = String(body.name || '').trim();
  if (!name) return json({ error: '项目名称不能为空' }, 400);
  if (name.length > 60) return json({ error: '项目名称不能超过 60 个字符' }, 400);

  if (name !== existing.name) {
    await env.DB.prepare('UPDATE projects SET name = ? WHERE id = ?').bind(name, id).run();
  }
  return json({ project: { ...existing, name } });
}

/** DELETE /api/projects/:id  删除项目（含 R2 文件与 D1 记录） */
async function deleteProject(request, env, url, { id }) {
  const p = await env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(id).first();
  if (!p) return json({ error: '项目不存在' }, 404);

  await deleteR2Prefix(env, `sites/${id}/`);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM project_files WHERE project_id = ?').bind(id),
    env.DB.prepare('DELETE FROM files WHERE version_id IN (SELECT id FROM versions WHERE project_id = ?)').bind(id),
    env.DB.prepare('DELETE FROM versions WHERE project_id = ?').bind(id),
    env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
}

/** GET /api/projects/:id/versions  版本列表 */
async function listVersions(request, env, url, { id }) {
  const p = await env.DB.prepare('SELECT id, current_version_id FROM projects WHERE id = ?').bind(id).first();
  if (!p) return json({ error: '项目不存在' }, 404);
  const pageSize = 10;
  const requestedPage = Math.max(1, Number.parseInt(url.searchParams.get('page'), 10) || 1);
  const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM versions WHERE project_id = ?').bind(id).first();
  const total = Number(count.total) || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const rows = await env.DB.prepare(
    `SELECT v.id, v.version, v.file_count, v.total_size, v.status, v.created_at, v.note,
      (SELECT COUNT(*) FROM file_changes c WHERE c.version_id = v.id) AS change_count
      FROM versions v WHERE v.project_id = ? ORDER BY v.version DESC LIMIT ? OFFSET ?`
  ).bind(id, pageSize, (page - 1) * pageSize).all();
  return json({ versions: rows.results, current_version_id: p.current_version_id, page, page_size: pageSize, total, total_pages: totalPages });
}

async function listVersionChanges(request, env, url, { id }) {
  const changes = await env.DB.prepare('SELECT path, action, size, mime FROM file_changes WHERE version_id = ? ORDER BY path').bind(id).all();
  return json({ changes: changes.results });
}

/** 旧版项目首次增量部署时，把其已发布版本的文件清单初始化为当前文件树。 */
async function ensureProjectFiles(env, projectId, currentVersionId) {
  const { count } = await env.DB.prepare('SELECT COUNT(*) AS count FROM project_files WHERE project_id = ?')
    .bind(projectId).first();
  if (Number(count) || !currentVersionId) return;
  await env.DB.prepare(`INSERT OR IGNORE INTO project_files (project_id, path, r2_key, size, mime, updated_version_id)
    SELECT ?, path, r2_key, size, mime, ? FROM files WHERE version_id = ?`)
    .bind(projectId, currentVersionId, currentVersionId).run();
}

/** GET /api/projects/:id/files  当前线上文件树，用于部署草稿差异预览。 */
async function listProjectFiles(request, env, url, { id }) {
  const project = await env.DB.prepare('SELECT id, current_version_id FROM projects WHERE id = ?').bind(id).first();
  if (!project) return json({ error: '项目不存在' }, 404);
  await ensureProjectFiles(env, id, project.current_version_id);
  const result = await env.DB.prepare('SELECT path, r2_key, size, mime FROM project_files WHERE project_id = ? ORDER BY path')
    .bind(id).all();
  return json({ files: result.results });
}

/** GET /api/projects/:id/download?path=  下载当前线上文件。 */
async function downloadProjectFile(request, env, url, { id }) {
  const path = safePath(url.searchParams.get('path') || '');
  if (!path) return json({ error: '缺少有效文件路径' }, 400);
  const file = await env.DB.prepare('SELECT path, r2_key, mime FROM project_files WHERE project_id = ? AND path = ?')
    .bind(id, path).first();
  if (!file) return json({ error: '文件尚未发布或不存在' }, 404);
  const object = await env.BUCKET.get(file.r2_key);
  if (!object) return json({ error: '文件内容不存在' }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Content-Type', file.mime || mimeOf(path));
  headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path.slice(path.lastIndexOf('/') + 1))}`);
  headers.set('Cache-Control', 'no-store');
  return new Response(object.body, { headers });
}

/** POST /api/projects/:id/versions  创建新版本（开始一次部署） */
async function createVersion(request, env, url, { id }) {
  const p = await env.DB.prepare('SELECT id, current_version_id FROM projects WHERE id = ?').bind(id).first();
  if (!p) return json({ error: '项目不存在' }, 404);
  await ensureProjectFiles(env, id, p.current_version_id);
  const { next } = await env.DB.prepare(
    'SELECT COALESCE(MAX(version), 0) + 1 AS next FROM versions WHERE project_id = ?'
  ).bind(id).first();
  const vid = uid('v_');
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO versions (id, project_id, version, status, created_at) VALUES (?, ?, ?, 'uploading', ?)"
  ).bind(vid, id, next, now).run();
  return json({ id: vid, version: next, status: 'uploading', created_at: now });
}

/** POST /api/versions/:id/files  上传一个文件批次（multipart/form-data） */
async function uploadFiles(request, env, url, { id }) {
  const version = await env.DB.prepare('SELECT * FROM versions WHERE id = ?').bind(id).first();
  if (!version) return json({ error: '版本不存在' }, 404);
  if (version.status !== 'uploading') return json({ error: '该版本已结束上传，请重新创建部署' }, 409);

  const form = await request.formData();
  const puts = [];
  const rows = [];
  for (const [key, value] of form.entries()) {
    if (!key.startsWith('file_') || typeof value === 'string') continue;
    const rel = safePath(form.get('path_' + key.slice(5)) || value.name);
    if (!rel) continue;
    const r2Key = `sites/${version.project_id}/v${version.version}/${rel}`;
    puts.push(env.BUCKET.put(r2Key, value.stream(), {
      httpMetadata: { contentType: mimeOf(rel) },
    }));
    rows.push([id, rel, 'upsert', r2Key, value.size || 0, mimeOf(rel)]);
  }
  if (rows.length === 0) return json({ error: '本批次没有有效文件' }, 400);
  const account = await accountFor(request, env);
  const storageError = await ensureStorageLimit(env, account, version, rows.map((row) => ({ path: row[1], size: row[4] })));
  if (storageError) return storageError;

  await Promise.all(puts);

  const stmts = rows.map((r) => env.DB.prepare(
    'INSERT OR REPLACE INTO file_changes (version_id, path, action, r2_key, size, mime) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(...r));
  for (let i = 0; i < stmts.length; i += 50) {
    await env.DB.batch(stmts.slice(i, i + 50));
  }
  return json({ ok: true, uploaded: rows.length });
}

/**
 * 逐文件直传 R2。不要使用 request.formData()：它会在 Worker 内存中聚合整个
 * multipart 请求，较大的站点部署会触发内存上限。
 */
async function uploadFileStream(request, env, url, { id }) {
  const version = await env.DB.prepare('SELECT * FROM versions WHERE id = ?').bind(id).first();
  if (!version) return json({ error: '版本不存在' }, 404);
  if (version.status !== 'uploading') return json({ error: '该版本已结束上传，请重新创建部署' }, 409);

  let uploadedPath = request.headers.get('x-tinysite-path') || '';
  try { uploadedPath = decodeURIComponent(uploadedPath); } catch { return json({ error: '文件路径无效' }, 400); }
  const rel = safePath(uploadedPath);
  const size = Number(request.headers.get('x-tinysite-size'));
  if (!rel || !Number.isSafeInteger(size) || size < 0) return json({ error: '缺少有效的文件路径或大小' }, 400);
  if (!request.body) return json({ error: '文件内容为空' }, 400);
  if (size > 30 * 1024 * 1024) return json({ error: '单个文件不能超过 30MB' }, 400);

  const account = await accountFor(request, env);
  const storageError = await ensureStorageLimit(env, account, version, [{ path: rel, size }]);
  if (storageError) return storageError;

  const r2Key = `sites/${version.project_id}/v${version.version}/${rel}`;
  const mime = mimeOf(rel);
  await env.BUCKET.put(r2Key, request.body, { httpMetadata: { contentType: mime } });
  await env.DB.prepare(
    'INSERT OR REPLACE INTO file_changes (version_id, path, action, r2_key, size, mime) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, rel, 'upsert', r2Key, size, mime).run();
  return json({ ok: true, uploaded: 1 });
}

/** POST /api/versions/:id/zip  上传并安全解压一个网站 ZIP 制品 */
async function uploadZip(request, env, url, { id }) {
  const version = await env.DB.prepare('SELECT * FROM versions WHERE id = ?').bind(id).first();
  if (!version) return json({ error: '版本不存在' }, 404);
  if (version.status !== 'uploading') return json({ error: '该版本已结束上传，请重新创建部署' }, 409);
  const body = new Uint8Array(await request.arrayBuffer());
  if (!body.length) return json({ error: 'ZIP 文件为空' }, 400);
  if (body.byteLength > 30 * 1024 * 1024) return json({ error: 'ZIP 文件不能超过 30MB' }, 400);

  let archive;
  try { archive = unzipSync(body); } catch { return json({ error: '无法读取 ZIP 文件' }, 400); }
  let entries = Object.entries(archive)
    .filter(([path, data]) => data.length && !path.startsWith('__MACOSX/') && !path.endsWith('/.DS_Store'))
    .map(([path, data]) => ({ path: safePath(path), data }))
    .filter((entry) => entry.path);
  if (!entries.length) return json({ error: 'ZIP 中没有可发布的文件' }, 400);
  if (entries.length > 1000) return json({ error: 'ZIP 文件数量不能超过 1000 个' }, 400);

  const first = entries[0].path.split('/')[0];
  if (first && entries.every((entry) => entry.path.startsWith(first + '/'))) {
    entries = entries.map((entry) => ({ ...entry, path: entry.path.slice(first.length + 1) }));
  }
  if (entries.reduce((sum, entry) => sum + entry.data.byteLength, 0) > 100 * 1024 * 1024) {
    return json({ error: 'ZIP 解压后的总大小不能超过 100MB' }, 400);
  }
  const unique = new Map(entries.map((entry) => [entry.path, entry]));
  const rows = [...unique.values()].map(({ path, data }) => [
    id, path, 'upsert', `sites/${version.project_id}/v${version.version}/${path}`, data.byteLength, mimeOf(path), data,
  ]);
  const account = await accountFor(request, env);
  const storageError = await ensureStorageLimit(env, account, version, rows.map((row) => ({ path: row[1], size: row[4] })));
  if (storageError) return storageError;
  for (let i = 0; i < rows.length; i += 20) {
    const batch = rows.slice(i, i + 20);
    await Promise.all(batch.map((row) => env.BUCKET.put(row[3], row[6], { httpMetadata: { contentType: row[5] } })));
    await env.DB.batch(batch.map((row) => env.DB.prepare(
      'INSERT OR REPLACE INTO file_changes (version_id, path, action, r2_key, size, mime) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(...row.slice(0, 6))));
  }
  const project = await env.DB.prepare('SELECT current_version_id FROM projects WHERE id = ?').bind(version.project_id).first();
  await ensureProjectFiles(env, version.project_id, project.current_version_id);
  const current = await env.DB.prepare('SELECT path FROM project_files WHERE project_id = ?').bind(version.project_id).all();
  const deleted = current.results.filter((file) => !unique.has(file.path));
  if (deleted.length) {
    await env.DB.batch(deleted.map((file) => env.DB.prepare(
      "INSERT OR REPLACE INTO file_changes (version_id, path, action) VALUES (?, ?, 'delete')"
    ).bind(id, file.path)));
  }
  return json({ ok: true, uploaded: rows.length });
}

/** POST /api/versions/:id/delete  在部署草稿中删除指定文件。 */
async function deleteDraftFiles(request, env, url, { id }) {
  const version = await env.DB.prepare('SELECT * FROM versions WHERE id = ?').bind(id).first();
  if (!version) return json({ error: '版本不存在' }, 404);
  if (version.status !== 'uploading') return json({ error: '该版本已结束上传，请重新创建部署' }, 409);
  const body = await request.json().catch(() => ({}));
  const paths = [...new Set((Array.isArray(body.paths) ? body.paths : []).map(safePath).filter(Boolean))];
  if (!paths.length) return json({ error: '请至少选择一个文件' }, 400);
  await env.DB.batch(paths.map((path) => env.DB.prepare(
    "INSERT OR REPLACE INTO file_changes (version_id, path, action) VALUES (?, ?, 'delete')"
  ).bind(id, path)));
  return json({ ok: true, deleted: paths.length });
}

async function publishVersion(env, id) {
  const version = await env.DB.prepare('SELECT * FROM versions WHERE id = ?').bind(id).first();
  if (!version) return json({ error: '版本不存在' }, 404);
  if (version.status === 'active') return { ok: true, already: true, version: version.version };
  const project = await env.DB.prepare('SELECT current_version_id FROM projects WHERE id = ?').bind(version.project_id).first();
  await ensureProjectFiles(env, version.project_id, project.current_version_id);
  const changes = await env.DB.prepare('SELECT * FROM file_changes WHERE version_id = ?').bind(id).all();
  if (!changes.results.length) return json({ error: '尚未产生任何文件变更，无法发布' }, 400);

  const statements = [env.DB.prepare('DELETE FROM files WHERE version_id = ?').bind(id)];
  for (const change of changes.results) {
    if (change.action === 'delete') {
      statements.push(env.DB.prepare('DELETE FROM project_files WHERE project_id = ? AND path = ?')
        .bind(version.project_id, change.path));
    } else {
      statements.push(env.DB.prepare(`INSERT OR REPLACE INTO project_files
        (project_id, path, r2_key, size, mime, updated_version_id) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(version.project_id, change.path, change.r2_key, change.size, change.mime, id));
    }
  }
  statements.push(
    env.DB.prepare(`INSERT INTO files (version_id, path, r2_key, size, mime)
      SELECT ?, path, r2_key, size, mime FROM project_files WHERE project_id = ?`).bind(id, version.project_id),
    env.DB.prepare(`UPDATE versions SET status = 'active',
      file_count = (SELECT COUNT(*) FROM files WHERE version_id = ?),
      total_size = (SELECT COALESCE(SUM(size), 0) FROM files WHERE version_id = ?)
      WHERE id = ?`).bind(id, id, id),
    env.DB.prepare('UPDATE projects SET current_version_id = ? WHERE id = ?').bind(id, version.project_id),
  );
  await env.DB.batch(statements);
  return { ok: true, version: version.version };
}

/** POST /api/versions/:id/finalize  完成部署并原子发布为当前版本 */
async function finalizeVersion(request, env, url, { id }) {
  const body = await request.json().catch(() => ({}));
  const note = String(body.note || '').trim().slice(0, 240);
  if (note) await env.DB.prepare('UPDATE versions SET note = ? WHERE id = ? AND status = \'uploading\'').bind(note, id).run();
  const result = await publishVersion(env, id);
  if (result instanceof Response) return result;
  return json(result);
}

/** POST /api/versions/:id/abort  中止部署并清理残留文件 */
async function abortVersion(request, env, url, { id }) {
  const version = await env.DB.prepare('SELECT * FROM versions WHERE id = ?').bind(id).first();
  if (!version) return json({ error: '版本不存在' }, 404);
  if (version.status !== 'uploading') return json({ ok: true });
  await env.DB.prepare("UPDATE versions SET status = 'failed' WHERE id = ?").bind(id).run();
  await deleteR2Prefix(env, `sites/${version.project_id}/v${version.version}/`);
  return json({ ok: true });
}

/** POST /api/projects/:id/rollback  将当前文件树恢复为目标版本，并生成新的回滚版本。 */
async function rollbackProject(request, env, url, { id }) {
  const body = await request.json().catch(() => ({}));
  const vid = String(body.versionId || '');
  if (!vid) return json({ error: '缺少 versionId' }, 400);
  const target = await env.DB.prepare(
    "SELECT * FROM versions WHERE id = ? AND project_id = ? AND status = 'active'"
  ).bind(vid, id).first();
  if (!target) return json({ error: '目标版本不存在或未发布成功' }, 404);
  const project = await env.DB.prepare('SELECT current_version_id FROM projects WHERE id = ?').bind(id).first();
  await ensureProjectFiles(env, id, project.current_version_id);
  const [current, desired] = await Promise.all([
    env.DB.prepare('SELECT path, r2_key, size, mime FROM project_files WHERE project_id = ?').bind(id).all(),
    env.DB.prepare('SELECT path, r2_key, size, mime FROM files WHERE version_id = ?').bind(vid).all(),
  ]);
  const currentByPath = new Map(current.results.map((file) => [file.path, file]));
  const desiredByPath = new Map(desired.results.map((file) => [file.path, file]));
  const { next } = await env.DB.prepare('SELECT COALESCE(MAX(version), 0) + 1 AS next FROM versions WHERE project_id = ?')
    .bind(id).first();
  const rollbackId = uid('v_');
  const now = Date.now();
  await env.DB.prepare("INSERT INTO versions (id, project_id, version, status, created_at) VALUES (?, ?, ?, 'uploading', ?)")
    .bind(rollbackId, id, next, now).run();

  const changes = [];
  for (const [path, file] of currentByPath) {
    if (!desiredByPath.has(path)) changes.push([rollbackId, path, 'delete', null, 0, null]);
    else if (desiredByPath.get(path).r2_key !== file.r2_key) {
      const old = desiredByPath.get(path);
      changes.push([rollbackId, path, 'upsert', old.r2_key, old.size, old.mime]);
    }
  }
  for (const [path, file] of desiredByPath) {
    if (!currentByPath.has(path)) changes.push([rollbackId, path, 'upsert', file.r2_key, file.size, file.mime]);
  }
  if (!changes.length) {
    await env.DB.prepare("UPDATE versions SET status = 'failed' WHERE id = ?").bind(rollbackId).run();
    return json({ ok: true, already: true, version: target.version });
  }
  await env.DB.batch(changes.map((change) => env.DB.prepare(
    'INSERT INTO file_changes (version_id, path, action, r2_key, size, mime) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(...change)));
  const result = await publishVersion(env, rollbackId);
  if (result instanceof Response) return result;
  return json({ ...result, rollback_of: target.version });
}

// ------------------------------- R2 清理 -------------------------------

async function deleteR2Prefix(env, prefix) {
  let cursor;
  do {
    const listed = await env.BUCKET.list({ prefix, cursor });
    if (listed.objects.length) await env.BUCKET.delete(listed.objects.map((o) => o.key));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

// ------------------------------- 站点访问服务 -------------------------------

/**
 * 子域名模式（生产）：按 Host 头识别站点
 *   {slug}{suffix}.{base}        -> 当前版本（固定地址）
 *   {slug}-v{n}{suffix}.{base}   -> 历史版本地址
 * 每个站点独占域名根路径，站点内 /assets/... 等绝对路径天然正确。
 */
async function serveSiteByHost(request, env, base, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  const host = (request.headers.get('host') || '').toLowerCase();
  const label = host.slice(0, host.length - base.length - 1);
  if (!label || label.includes('.')) {
    return errorPage(404, '站点不存在', '请检查访问地址是否正确。');
  }
  const suffix = (env.SITE_HOST_SUFFIX || '').trim().toLowerCase();
  if (suffix && (!label.endsWith(suffix) || label === suffix)) {
    return errorPage(404, '站点不存在', '请检查访问地址是否正确。');
  }
  const projectLabel = suffix ? label.slice(0, -suffix.length) : label;
  // slug 为纯 [a-z0-9] 随机串（无连字符），故 -v{n} 后缀解析无歧义
  const m = projectLabel.match(/^(.+?)-v(\d+)$/);
  const slug = m ? m[1] : projectLabel;
  const versionNum = m ? Number(m[2]) : null;
  const siteOrigin = `${url.protocol}//${url.host}`;
  return serveProjectVersion(env, slug, versionNum, url.pathname.replace(/^\//, ''), { siteOrigin, isCurrent: !m });
}

/**
 * 路径模式（本地开发与 workers.dev 兜底）：
 *   /s/:slug/*          固定地址，始终解析到 projects.current_version_id
 *   /v/:slug/:version/* 历史版本地址
 */
async function serveSiteByPath(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  const seg = url.pathname.split('/').filter(Boolean);
  const slug = seg[1];
  if (!slug) return errorPage(404, '站点不存在', '请检查访问地址是否正确。');
  let versionNum = null;
  let rest;
  let siteOrigin;
  if (seg[0] === 's') {
    rest = seg.slice(2).join('/');
    siteOrigin = `${url.origin}/s/${encodeURIComponent(slug)}`;
  } else {
    versionNum = Number(seg[2]);
    if (!Number.isInteger(versionNum) || versionNum < 1) return errorPage(404, '版本不存在', '');
    rest = seg.slice(3).join('/');
    siteOrigin = `${url.origin}/v/${encodeURIComponent(slug)}/${versionNum}`;
  }
  return serveProjectVersion(env, slug, versionNum, rest, { siteOrigin, isCurrent: versionNum == null });
}

/** 解析项目与版本，然后输出文件 */
async function serveProjectVersion(env, slug, versionNum, rest, opts = {}) {
  const period = new Date().toISOString().slice(0, 7);
  let project = await env.DB.prepare(`SELECT p.*, u.id AS owner_id, u.status AS owner_status, u.plan_expires_at,
      pl.traffic_limit_bytes, COALESCE(mu.traffic_bytes, 0) AS traffic_bytes
    FROM projects p JOIN users u ON u.id = p.user_id JOIN plans pl ON pl.id = u.plan_id
    LEFT JOIN monthly_usage mu ON mu.user_id = u.id AND mu.period = ? WHERE p.slug = ?`).bind(period, slug).first();
  if (!project) return errorPage(404, '站点不存在', '该项目可能已被删除。');
  if (await refreshEntitlementSchedule(env, project.owner_id)) {
    project = await env.DB.prepare(`SELECT p.*, u.id AS owner_id, u.status AS owner_status, u.plan_expires_at,
        pl.traffic_limit_bytes, COALESCE(mu.traffic_bytes, 0) AS traffic_bytes
      FROM projects p JOIN users u ON u.id = p.user_id JOIN plans pl ON pl.id = u.plan_id
      LEFT JOIN monthly_usage mu ON mu.user_id = u.id AND mu.period = ? WHERE p.slug = ?`).bind(period, slug).first();
  }
  if (project.owner_status !== 'active' || (project.plan_expires_at && Number(project.plan_expires_at) <= Date.now())) {
    return errorPage(403, '网站已暂停', '账户套餐已到期或被暂停，续费后将自动恢复。');
  }
  if (Number(project.traffic_bytes) >= Number(project.traffic_limit_bytes)) {
    return errorPage(429, '本月流量已用完', '下个自然月额度会自动重置。');
  }

  const discoveryMeta = {
    name: project.name,
    slug: project.slug,
    siteOrigin: opts.siteOrigin || '',
    isCurrent: opts.isCurrent !== false && versionNum == null,
  };

  let v;
  if (versionNum == null) {
    if (!project.current_version_id) {
      return tagSiteResponse(await serveFiles(env, project.id, null, 0, rest, discoveryMeta), project.owner_id);
    }
    v = await env.DB.prepare('SELECT id, version FROM versions WHERE id = ?').bind(project.current_version_id).first();
    if (!v) return tagSiteResponse(await serveFiles(env, project.id, null, 0, rest, discoveryMeta), project.owner_id);
  } else {
    v = await env.DB.prepare("SELECT id, version FROM versions WHERE project_id = ? AND version = ? AND status = 'active'")
      .bind(project.id, versionNum).first();
    if (!v) return errorPage(404, '版本不存在', `该项目没有已发布的 v${versionNum} 版本。`);
  }

  return tagSiteResponse(
    await serveFiles(env, project.id, v.id, v.version, rest, discoveryMeta),
    project.owner_id,
  );
}

function tagSiteResponse(response, userId) {
  response.headers.set('x-tinysite-internal-user', userId);
  return response;
}

function textFile(body, type = 'text/plain; charset=utf-8', status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': type,
      'Cache-Control': 'public, max-age=300',
    },
  });
}

/** 项目站点若未上传 robots/sitemap/llms，自动生成便于搜索引擎与 AI 发现 */
async function serveProjectDiscovery(env, projectId, versionId, rel, meta = {}) {
  const name = meta.name || 'Static site';
  const origin = String(meta.siteOrigin || '').replace(/\/$/, '');
  if (rel === 'robots.txt') {
    const lines = [
      'User-agent: *',
      'Allow: /',
      '',
      'User-agent: GPTBot',
      'Allow: /',
      '',
      'User-agent: ClaudeBot',
      'Allow: /',
      '',
    ];
    if (origin) lines.push(`Sitemap: ${origin}/sitemap.xml`, '');
    return textFile(lines.join('\n'));
  }
  if (rel === 'llms.txt') {
    return textFile([
      `# ${name}`,
      '',
      '> Static website hosted on TinySite.',
      '',
      '## Summary',
      '',
      `${name} is a published static site. Prefer reading HTML pages, sitemap.xml, and this file for structure.`,
      origin ? `Homepage: ${origin}/` : '',
      origin ? `Sitemap: ${origin}/sitemap.xml` : '',
      '',
      '## Notes for agents',
      '',
      '- Content is static files (HTML/CSS/JS/images/Markdown).',
      '- If pages lack metadata, use visible headings and first paragraphs as the description.',
      '',
    ].filter(Boolean).join('\n'));
  }
  if (rel === 'sitemap.xml') {
    let paths = [];
    if (meta.isCurrent !== false) {
      const rows = await env.DB.prepare(
        `SELECT path FROM project_files WHERE project_id = ?
          AND (path LIKE '%.html' OR path LIKE '%.htm' OR path LIKE '%.md')
          ORDER BY path LIMIT 5000`
      ).bind(projectId).all();
      paths = (rows.results || []).map((row) => row.path);
    } else if (versionId) {
      const rows = await env.DB.prepare(
        `SELECT path FROM files WHERE version_id = ?
          AND (path LIKE '%.html' OR path LIKE '%.htm' OR path LIKE '%.md')
          ORDER BY path LIMIT 5000`
      ).bind(versionId).all();
      paths = (rows.results || []).map((row) => row.path);
    }
    if (!paths.length) paths = ['index.html'];
    const urls = paths.map((path) => {
      let locPath = String(path || '').replace(/\\/g, '/');
      if (locPath.endsWith('/index.html')) locPath = locPath.slice(0, -'index.html'.length);
      else if (locPath === 'index.html') locPath = '';
      else if (locPath.endsWith('/index.htm')) locPath = locPath.slice(0, -'index.htm'.length);
      else if (locPath === 'index.htm') locPath = '';
      else if (locPath.endsWith('/index.md')) locPath = locPath.slice(0, -'index.md'.length);
      else if (locPath === 'index.md') locPath = '';
      const encoded = locPath.split('/').filter(Boolean).map(encodeURIComponent).join('/');
      const loc = origin
        ? (encoded ? `${origin}/${encoded}` : `${origin}/`)
        : (encoded ? `/${encoded}` : '/');
      return `  <url><loc>${escapeXml(loc)}</loc></url>`;
    });
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
    return textFile(body, 'application/xml; charset=utf-8');
  }
  return null;
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function usagePeriod() {
  return new Date().toISOString().slice(0, 7);
}

async function recordTraffic(env, userId, bytes) {
  if (!userId || !Number.isFinite(bytes) || bytes <= 0) return;
  await env.DB.prepare(`INSERT INTO monthly_usage (user_id, period, traffic_bytes) VALUES (?, ?, ?)
    ON CONFLICT(user_id, period) DO UPDATE SET traffic_bytes = traffic_bytes + excluded.traffic_bytes`)
    .bind(userId, usagePeriod(), Math.floor(bytes)).run();
}

/** 从 R2 输出站点文件，含 SPA 回退与自定义 404 */
async function serveFiles(env, projectId, versionId, versionNum, rest, discoveryMeta = {}) {
  const defaultPrefix = `sites/${projectId}/defaults/`;
  const getVersionFile = async (path) => {
    if (!versionId) return null;
    // 当前固定域名：读线上文件树；历史版本：读该版本快照
    if (discoveryMeta.isCurrent !== false && versionNum == null) {
      const live = await env.DB.prepare('SELECT r2_key FROM project_files WHERE project_id = ? AND path = ?')
        .bind(projectId, path).first();
      if (live) return env.BUCKET.get(live.r2_key);
    }
    const file = await env.DB.prepare('SELECT r2_key FROM files WHERE version_id = ? AND path = ?')
      .bind(versionId, path).first();
    return file ? env.BUCKET.get(file.r2_key) : null;
  };
  let rel = safePath(decodeURIComponent(rest || ''));
  const isDirectory = !rel || rel.endsWith('/');
  if (isDirectory) rel += 'index.html';

  // SEO / AI 发现文件：用户上传优先，否则自动生成
  if (['robots.txt', 'sitemap.xml', 'llms.txt'].includes(rel)) {
    let obj = null;
    if (discoveryMeta.isCurrent !== false) {
      const live = await env.DB.prepare('SELECT r2_key FROM project_files WHERE project_id = ? AND path = ?')
        .bind(projectId, rel).first();
      if (live) obj = await env.BUCKET.get(live.r2_key);
    }
    if (!obj && versionId) {
      const snap = await env.DB.prepare('SELECT r2_key FROM files WHERE version_id = ? AND path = ?')
        .bind(versionId, rel).first();
      if (snap) obj = await env.BUCKET.get(snap.r2_key);
    }
    if (obj) {
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', rel.endsWith('.xml') ? 'application/xml; charset=utf-8' : 'text/plain; charset=utf-8');
      }
      headers.set('Cache-Control', 'public, max-age=300');
      return new Response(obj.body, { headers });
    }
    return await serveProjectDiscovery(env, projectId, versionId, rel, discoveryMeta);
  }

  let obj = await getVersionFile(rel);
  // Markdown 也可以作为独立站点的入口，适合直接分享 AI 生成的文档。
  if (!obj && isDirectory) {
    rel = rel.replace(/index\.html$/, 'index.md');
    obj = await getVersionFile(rel);
  }
  if (!obj && isDirectory) {
    rel = 'index.html';
    obj = await env.BUCKET.get(defaultPrefix + rel);
  }
  if (!obj && !/\.[a-z0-9]{1,10}$/i.test(rel)) {
    // SPA 回退：无扩展名的路由回退到 index.html
    obj = await getVersionFile('index.html');
    rel = 'index.html';
    if (!obj) obj = await env.BUCKET.get(defaultPrefix + rel);
  }
  if (!obj && ['404.html', '50x.html'].includes(rel)) {
    obj = await env.BUCKET.get(defaultPrefix + rel);
  }
  if (!obj) {
    // 若站点自带 404.html 则优先使用，否则使用创建项目时的默认页。
    const custom = await getVersionFile('404.html') || await env.BUCKET.get(defaultPrefix + '404.html');
    if (custom) {
      const h = new Headers();
      custom.writeHttpMetadata(h);
      h.set('Content-Type', 'text/html; charset=utf-8');
      return new Response(custom.body, { status: 404, headers: h });
    }
    return errorPage(404, '页面不存在', '该站点中找不到请求的资源。');
  }

  if (rel.toLowerCase().endsWith('.md')) return markdownPage(await obj.text());

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', mimeOf(rel));
  headers.set('ETag', obj.httpEtag);
  headers.set('Content-Length', String(obj.size));
  headers.set('Cache-Control', 'public, max-age=3600');
  return new Response(obj.body, { headers });
}

// ------------------------------- 入口 -------------------------------

/** GET /api/config  前端运行配置（站点域名后缀等） */
async function getConfig(request, env) {
  const base = (env.SITE_BASE_DOMAIN || '').trim();
  const suffix = (env.SITE_HOST_SUFFIX || '').trim();
  return json({ siteBase: base || null, siteSuffix: suffix || '' });
}

const apiRoutes = [
  ['GET', '/api/config', getConfig],
  ['POST', '/api/auth/register', register],
  ['POST', '/api/auth/login', login],
  ['POST', '/api/auth/logout', logout],
  ['GET', '/api/auth/me', async (request, env) => {
    const user = await currentUser(request, env);
    if (!user) return json({ user: null }, 401);
    await refreshEntitlementSchedule(env, user.id);
    const effectiveUser = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
    return json({ user: publicUser(effectiveUser) });
  }],
  ['GET', '/api/admin/overview', adminOverview],
  ['GET', '/api/admin/users', adminListUsers],
  ['PATCH', '/api/admin/users/:id', adminUpdateUser],
  ['POST', '/api/admin/users/:id/entitlements', adminGrantEntitlement],
  ['GET', '/api/admin/audit-logs', adminListAuditLogs],
  ['GET', '/api/admin/entitlements', adminListEntitlements],
  ['PATCH', '/api/admin/entitlements/:id', adminUpdateEntitlement],
  ['GET', '/api/admin/projects', adminListProjects],
  ['GET', '/api/admin/projects/:id', adminProjectDetail],
  ['DELETE', '/api/admin/projects/:id', adminDeleteProject],
  ['GET', '/api/admin/activation-codes', adminListActivationCodes],
  ['POST', '/api/admin/activation-codes', adminCreateActivationCode],
  ['DELETE', '/api/admin/activation-codes/:id', adminDeleteActivationCode],
  ['GET', '/api/account/usage', accountUsage],
  ['POST', '/api/account/plan', selectAccountPlan],
  ['POST', '/api/account/redeem-code', redeemActivationCode],
  ['POST', '/api/account/password', changePassword],
  ['POST', '/api/projects', createProject],
  ['GET', '/api/projects', listProjects],
  ['GET', '/api/projects/:id', getProject],
  ['PATCH', '/api/projects/:id', updateProject],
  ['GET', '/api/projects/:id/files', listProjectFiles],
  ['GET', '/api/projects/:id/download', downloadProjectFile],
  ['DELETE', '/api/projects/:id', deleteProject],
  ['GET', '/api/projects/:id/versions', listVersions],
  ['POST', '/api/projects/:id/versions', createVersion],
  ['POST', '/api/projects/:id/rollback', rollbackProject],
  ['POST', '/api/versions/:id/files', uploadFileStream],
  ['GET', '/api/versions/:id/changes', listVersionChanges],
  ['POST', '/api/versions/:id/delete', deleteDraftFiles],
  ['POST', '/api/versions/:id/finalize', finalizeVersion],
  ['POST', '/api/versions/:id/abort', abortVersion],
];

async function handleApi(request, env, url) {
  for (const [method, pattern, handler] of apiRoutes) {
    if (method !== request.method) continue;
    const params = matchPath(pattern, url.pathname);
    if (!params) continue;
    const isPublic = pattern === '/api/config' || pattern.startsWith('/api/auth/');
    if (isPublic) return handler(request, env, url, params);
    let user = await currentUser(request, env);
    if (!user) return json({ error: '请先登录' }, 401);
    if (await refreshEntitlementSchedule(env, user.id)) {
      user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
    }
    if (user.status !== 'active') return json({ error: '账号已暂停，请联系管理员' }, 403);
    if (url.pathname.startsWith('/api/admin/') && user.role !== 'admin') return json({ error: '需要管理员权限' }, 403);
    if (!(await requireOwnedResource(env, user, url.pathname))) return json({ error: '资源不存在' }, 404);
    const headers = new Headers(request.headers);
    headers.set('x-tinysite-user-id', user.id);
    return handler(new Request(request, { headers }), env, url, params);
  }
  return json({ error: '接口不存在' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const base = (env.SITE_BASE_DOMAIN || '').trim().toLowerCase();
    const host = (request.headers.get('host') || url.hostname).toLowerCase();
    try {
      // 项目域名:{slug}{suffix}.{base} 或 {slug}-v{n}{suffix}.{base};顶级服务域名走管理后台
      // 管理后台域名（如 ts.yongkl.cc）同属 base 的子域名，但不能被当作项目站点。
      const systemHosts = new Set([`ts.${base}`, `admin-ts.${base}`]);
      if (base && !systemHosts.has(host) && host.endsWith('.' + base)) {
        const response = await serveSiteByHost(request, env, base, url);
        const userId = response.headers.get('x-tinysite-internal-user');
        response.headers.delete('x-tinysite-internal-user');
        if (response.status < 400 && request.method === 'GET') {
          const bytes = Number(response.headers.get('content-length')) || 0;
          ctx.waitUntil(recordTraffic(env, userId, bytes));
        }
        return response;
      }
      if (url.pathname.startsWith('/api/')) return await handleApi(request, env, url);
      if (url.pathname.startsWith('/s/') || url.pathname.startsWith('/v/')) {
        const response = await serveSiteByPath(request, env, url);
        const userId = response.headers.get('x-tinysite-internal-user');
        response.headers.delete('x-tinysite-internal-user');
        if (response.status < 400 && request.method === 'GET') {
          ctx.waitUntil(recordTraffic(env, userId, Number(response.headers.get('content-length')) || 0));
        }
        return response;
      }
      // 其余请求交给管理后台静态资源
      // 直接将官网根路径交给 Assets。请求 /index.html 会被 Assets 规范化重定向到 /，
      // 在 run_worker_first 模式下会造成 / -> /index.html -> / 的重定向循环。
      if (url.pathname === '/') return await env.ASSETS.fetch(request);
      return await env.ASSETS.fetch(request);
    } catch (err) {
      console.error(err);
      if (url.pathname.startsWith('/api/')) return json({ error: String((err && err.message) || err) }, 500);
      return errorPage(500, '服务器错误', '请稍后重试。');
    }
  },
};
