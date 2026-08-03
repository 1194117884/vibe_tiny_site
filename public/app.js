/* ============ TinySite 管理后台 ============ */

const $ = (sel, el = document) => el.querySelector(sel);
const app = document.getElementById('app');
const THEME_KEY = 'tinysite-theme';

function resolveTheme(mode = localStorage.getItem(THEME_KEY) || 'auto') {
  if (mode === 'light' || mode === 'dark') return mode;
  const hour = new Date().getHours();
  return hour >= 7 && hour < 19 ? 'light' : 'dark';
}

function applyTheme(mode = localStorage.getItem(THEME_KEY) || 'auto') {
  document.documentElement.dataset.theme = resolveTheme(mode);
  const control = document.getElementById('theme-mode');
  if (control) control.value = mode;
}

function setupThemeControl() {
  const control = document.getElementById('theme-mode');
  if (!control) return;
  applyTheme();
  control.onchange = () => {
    localStorage.setItem(THEME_KEY, control.value);
    applyTheme(control.value);
  };
  setInterval(() => {
    if ((localStorage.getItem(THEME_KEY) || 'auto') === 'auto') applyTheme('auto');
  }, 60e3);
}

function refreshIcons() {
  window.lucide?.createIcons({ attrs: { 'stroke-width': 1.8, width: 16, height: 16 } });
}
new MutationObserver((records) => {
  const hasNewIcon = records.some((record) => [...record.addedNodes].some((node) =>
    node.nodeType === Node.ELEMENT_NODE &&
    (node.matches('i[data-lucide]') || node.querySelector('i[data-lucide]'))
  ));
  if (hasNewIcon) refreshIcons();
}).observe(document.body, { childList: true, subtree: true });
setupThemeControl();

// ---------------- 工具 ----------------

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 ** 2) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 ** 3) return (n / 1024 ** 2).toFixed(1) + ' MB';
  return (n / 1024 ** 3).toFixed(2) + ' GB';
}

function fmtTime(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60e3) return '刚刚';
  if (diff < 3600e3) return Math.floor(diff / 60e3) + ' 分钟前';
  if (diff < 86400e3) return Math.floor(diff / 3600e3) + ' 小时前';
  if (diff < 30 * 86400e3) return Math.floor(diff / 86400e3) + ' 天前';
  return new Date(ts).toLocaleDateString('zh-CN');
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// 站点访问地址:配置了域名后缀及项目标识(如 -ts.yongkl.cc)时用域名模式,否则退化为路径模式
let SITE_BASE = null;
let SITE_SUFFIX = '';
let CURRENT_USER = null;
const siteUrl = (slug) =>
  SITE_BASE ? `https://${slug}${SITE_SUFFIX}.${SITE_BASE}/` : `${location.origin}/s/${slug}/`;
const versionUrl = (slug, v) =>
  SITE_BASE ? `https://${slug}-v${v}${SITE_SUFFIX}.${SITE_BASE}/` : `${location.origin}/v/${slug}/${v}/`;
const fileUrl = (slug, path) =>
  siteUrl(slug) + path.split('/').map(encodeURIComponent).join('/');

function copyText(text) {
  if (navigator.clipboard && window.isSecureContext !== false) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  }
  return Promise.resolve(fallbackCopy(text));
}
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch {}
  ta.remove();
}

// ---------------- Toast ----------------

function toast(msg, type = 'success') {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'error' ? ' error' : '');
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 260);
  }, 3200);
}

// ---------------- 弹窗 ----------------

function openModal({ title, desc, bodyHTML, okText = '确定', danger = false }) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    root.innerHTML = `
      <div class="dialog-overlay" role="presentation">
        <div class="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
          <h3 id="dialog-title">${esc(title)}</h3>
          ${desc ? `<p class="dialog-desc">${esc(desc)}</p>` : ''}
          ${bodyHTML || ''}
          <div class="dialog-actions">
            <button type="button" class="btn btn-ghost" data-act="cancel">取消</button>
            <button type="button" class="btn ${danger ? 'btn-danger-solid' : ''}" data-act="ok">${esc(okText)}</button>
          </div>
        </div>
      </div>`;
    const overlay = root.firstElementChild;
    const close = (val) => { overlay.remove(); resolve(val); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
    $('[data-act="cancel"]', overlay).onclick = () => close(null);
    $('[data-act="ok"]', overlay).onclick = () => {
      const input = $('input', overlay);
      const checked = [...overlay.querySelectorAll('input[type="checkbox"]:checked')].map((el) => el.value);
      if (overlay.querySelector('input[type="checkbox"]')) close(checked);
      else close(input ? input.value.trim() : true);
    };
    const input = $('input', overlay);
    if (input) {
      input.focus();
      if (input.value) input.select();
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') $('[data-act="ok"]', overlay).click();
      });
    }
  });
}

const promptModal = (title, placeholder) =>
  openModal({ title, bodyHTML: `<input type="text" placeholder="${esc(placeholder)}" maxlength="60" />`, okText: '创建' });

const editTextModal = (title, desc, value, okText = '保存') =>
  openModal({
    title,
    desc,
    bodyHTML: `<input type="text" value="${esc(value)}" maxlength="60" />`,
    okText,
  });

const confirmModal = (title, desc, okText = '确认', danger = false) =>
  openModal({ title, desc, okText, danger });

// ---------------- API ----------------

async function req(path, opts = {}) {
  const r = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `请求失败 (${r.status})`);
  return data;
}

const api = {
  me: () => req('/api/auth/me'),
  login: (email, password) => req('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (email, password) => req('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => req('/api/auth/logout', { method: 'POST' }),
  accountUsage: () => req('/api/account/usage'),
  selectPlan: (planId) => req('/api/account/plan', { method: 'POST', body: JSON.stringify({ planId }) }),
  redeemCode: (code) => req('/api/account/redeem-code', { method: 'POST', body: JSON.stringify({ code }) }),
  changePassword: (currentPassword, newPassword) => req('/api/account/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
  adminOverview: () => req('/api/admin/overview'),
  adminUsers: () => req('/api/admin/users'),
  grantEntitlement: (id, planId, durationDays) => req(`/api/admin/users/${id}/entitlements`, { method: 'POST', body: JSON.stringify({ planId, durationDays }) }),
  adminAuditLogs: () => req('/api/admin/audit-logs'),
  adminEntitlements: () => req('/api/admin/entitlements'),
  updateEntitlement: (id, status) => req(`/api/admin/entitlements/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  updateUser: (id, data) => req(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  adminProjects: () => req('/api/admin/projects'),
  adminProjectDetail: (id) => req(`/api/admin/projects/${id}`),
  deleteAdminProject: (id) => req(`/api/admin/projects/${id}`, { method: 'DELETE' }),
  activationCodes: () => req('/api/admin/activation-codes'),
  createActivationCode: (planId, durationDays, maxUses, expiresAt) => req('/api/admin/activation-codes', { method: 'POST', body: JSON.stringify({ planId, durationDays, maxUses, expiresAt }) }),
  deleteActivationCode: (id) => req(`/api/admin/activation-codes/${id}`, { method: 'DELETE' }),
  listProjects: (q) => req('/api/projects' + (q ? `?q=${encodeURIComponent(q)}` : '')),
  createProject: (name) => req('/api/projects', { method: 'POST', body: JSON.stringify({ name }) }),
  getProject: (id) => req(`/api/projects/${id}`),
  updateProject: (id, data) => req(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteProject: (id) => req(`/api/projects/${id}`, { method: 'DELETE' }),
  listVersions: (id, page = 1) => req(`/api/projects/${id}/versions?page=${page}`),
  listFiles: (id) => req(`/api/projects/${id}/files`),
  createVersion: (id) => req(`/api/projects/${id}/versions`, { method: 'POST' }),
  rollback: (id, versionId) => req(`/api/projects/${id}/rollback`, { method: 'POST', body: JSON.stringify({ versionId }) }),
  finalize: (vid, note) => req(`/api/versions/${vid}/finalize`, { method: 'POST', body: JSON.stringify({ note }) }),
  versionChanges: (vid) => req(`/api/versions/${vid}/changes`),
  abort: (vid) => req(`/api/versions/${vid}/abort`, { method: 'POST' }),
  deleteDraftFiles: (vid, paths) => req(`/api/versions/${vid}/delete`, { method: 'POST', body: JSON.stringify({ paths }) }),
};

function renderAuth() {
  app.innerHTML = `<section class="empty" style="max-width:440px;margin:70px auto;text-align:left">
    <div class="empty-icon"><i data-lucide="zap"></i></div><h2 id="auth-title">登录 TinySite</h2><p id="auth-desc">使用账号管理你的静态网站。</p>
    <form id="auth-form" style="display:grid;gap:12px;margin-top:24px">
      <input name="email" type="email" placeholder="邮箱" required autocomplete="email" />
      <input name="password" type="password" placeholder="密码（至少 8 位）" required minlength="8" autocomplete="current-password" />
      <button class="btn" type="submit">登录</button>
    </form>
    <p style="margin-top:18px"><a href="#" id="auth-switch">没有账号？免费注册</a></p>
  </section>`;
  let registerMode = false;
  const form = $('#auth-form');
  const update = () => {
    $('#auth-title').textContent = registerMode ? '注册 TinySite' : '登录 TinySite';
    $('#auth-desc').textContent = registerMode ? '注册后即获得 Free 套餐，可随时兑换赠送码或开通套餐。' : '使用账号管理你的静态网站。';
    $('button', form).textContent = registerMode ? '注册并登录' : '登录';
    $('#auth-switch').textContent = registerMode ? '已有账号？去登录' : '没有账号？免费注册';
  };
  $('#auth-switch').onclick = (e) => { e.preventDefault(); registerMode = !registerMode; update(); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    try {
      const result = registerMode
        ? await api.register(data.get('email'), data.get('password'))
        : await api.login(data.get('email'), data.get('password'));
      CURRENT_USER = result.user;
      updateAccountBar();
      route();
    } catch (err) { toast(err.message, 'error'); }
  };
}

async function renderAdmin() {
  if (CURRENT_USER?.role !== 'admin') {
    app.innerHTML = `<div class="empty"><div class="empty-icon">🔒</div><h3>需要管理员账号</h3><p>请使用管理员激活码注册或登录。</p></div>`;
    return;
  }
  app.innerHTML = `<div class="page-head"><div><h1 class="page-title">运营后台</h1><div class="page-sub">用户、项目与套餐赠送码</div></div></div><div id="admin-body" class="skeleton">加载中…</div>`;
  try {
    const [overview, userData, projectData, codeData, auditData, entitlementData] = await Promise.all([api.adminOverview(), api.adminUsers(), api.adminProjects(), api.activationCodes(), api.adminAuditLogs(), api.adminEntitlements()]);
    $('#admin-body').innerHTML = `<div class="project-meta" style="font-size:16px;gap:28px;margin-bottom:28px"><span>用户 <b>${overview.users}</b></span><span>项目 <b>${overview.projects}</b></span><span>已发布版本 <b>${overview.active_versions}</b></span><span>可用激活码 <b>${overview.available_codes}</b></span></div>
      <div class="card" style="margin-bottom:24px"><h3>生成套餐赠送码</h3><div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px"><select id="code-plan"><option value="pro">Pro</option><option value="plus">Plus</option><option value="ultra">Ultra</option><option value="free">Free</option></select><input id="code-days" type="number" value="30" min="1" max="3650" title="赠送天数" style="width:90px"/><input id="code-count" type="number" value="1" min="1" max="1000" title="可兑换次数" style="width:90px"/><input id="code-expires" type="datetime-local" title="兑换码有效期（留空为永久）"/><button class="btn" id="create-code">生成</button></div><p class="page-sub">兑换后会生成独立的套餐权益记录，不会用于注册。</p><p id="new-code" class="page-sub"></p></div>
      <div class="card" style="margin-bottom:24px"><h3>用户</h3><div style="overflow:auto"><table><thead><tr><th>邮箱</th><th>当前套餐</th><th>角色</th><th>项目</th><th>状态</th><th>赠送套餐权益</th><th>操作</th></tr></thead><tbody>${userData.users.map((u) => `<tr data-user="${esc(u.id)}"><td>${esc(u.email)}</td><td>${esc(u.plan_id)}<br><small>${u.plan_expires_at ? `至 ${fmtTime(u.plan_expires_at)}` : '基础/长期'}</small></td><td>${esc(u.role)}</td><td>${u.project_count}</td><td><select data-status><option value="active" ${u.status === 'active' ? 'selected' : ''}>active</option><option value="suspended" ${u.status === 'suspended' ? 'selected' : ''}>suspended</option></select></td><td><select data-grant-plan><option value="pro">Pro</option><option value="plus">Plus</option><option value="ultra">Ultra</option></select><input data-grant-days type="number" value="30" min="1" max="3650" style="width:72px"/> 天 <button class="btn btn-ghost" data-grant-user>赠送</button></td><td><button class="btn btn-ghost" data-save-user>保存状态</button></td></tr>`).join('')}</tbody></table></div></div>
      <div class="card" style="margin-bottom:24px"><h3>项目</h3><div style="overflow:auto"><table><thead><tr><th>项目</th><th>所属用户</th><th>版本</th><th>存储</th><th>操作</th></tr></thead><tbody>${projectData.projects.map((p) => `<tr><td>${esc(p.name)}<br><small>${esc(p.slug)}</small></td><td>${esc(p.owner_email)}</td><td>${p.version_count}</td><td>${fmtBytes(p.storage_bytes)}</td><td><button class="btn btn-ghost" data-view-project="${esc(p.id)}">查看</button><button class="btn btn-ghost" data-delete-project="${esc(p.id)}">删除</button></td></tr>`).join('') || '<tr><td colspan="5">暂无项目</td></tr>'}</tbody></table></div></div>
      <div class="card"><h3>套餐赠送码记录</h3><div style="overflow:auto"><table><thead><tr><th>兑换码</th><th>套餐</th><th>赠送时长</th><th>使用状态</th><th>有效期</th><th>兑换记录</th><th>操作</th></tr></thead><tbody>${codeData.codes.map((c) => {
        const expired = c.expires_at && c.expires_at <= Date.now();
        const exhausted = c.used_count >= c.max_uses;
        const state = expired ? '已过期' : exhausted ? '已用完' : '可用';
        const records = c.activation_records?.length
          ? c.activation_records.map((r) => `${esc(r.email)}<br><small>${fmtTime(r.created_at)}</small>`).join('<hr style="margin:7px 0;border:0;border-top:1px solid #eee">')
          : '暂无';
        return `<tr><td><code>${esc(c.code_display || '旧兑换码无法恢复')}</code></td><td>${esc(c.plan_id)}</td><td>${c.duration_days} 天</td><td>${c.used_count}/${c.max_uses}<br><small>${state}</small></td><td>${c.expires_at ? fmtTime(c.expires_at) : '永久'}</td><td>${records}</td><td><button class="btn btn-ghost" data-delete-code="${esc(c.id)}">作废</button></td></tr>`;
      }).join('') || '<tr><td colspan="7">暂无记录</td></tr>'}</tbody></table></div></div>`;
    $('#admin-body').insertAdjacentHTML('beforeend', `<div class="card" style="margin-top:24px"><h3>套餐权益记录</h3><div style="overflow:auto"><table><thead><tr><th>用户</th><th>套餐</th><th>时长</th><th>来源</th><th>排期</th><th>状态</th><th>操作</th></tr></thead><tbody>${entitlementData.entitlements.map((e) => `<tr><td>${esc(e.email)}</td><td>${esc(e.plan_id)}</td><td>${e.duration_days} 天</td><td>${esc(e.source_type)}</td><td><small>${fmtTime(e.starts_at)}<br/>至 ${fmtTime(e.ends_at)}</small></td><td>${esc(e.status)}</td><td>${['active', 'queued'].includes(e.status) ? `<button class="btn btn-ghost" data-refund-entitlement="${esc(e.id)}">退款</button><button class="btn btn-ghost" data-revoke-entitlement="${esc(e.id)}">撤销</button>` : '-'}</td></tr>`).join('') || '<tr><td colspan="7">暂无权益记录</td></tr>'}</tbody></table></div></div>`);
    $('#admin-body').insertAdjacentHTML('beforeend', `<div class="card" style="margin-top:24px"><h3>最近操作记录</h3><div style="overflow:auto"><table><thead><tr><th>时间</th><th>操作者</th><th>操作</th><th>对象</th><th>详情</th></tr></thead><tbody>${auditData.logs.map((log) => `<tr><td>${fmtTime(log.created_at)}</td><td>${esc(log.actor_email || '系统')}</td><td>${esc(log.action)}</td><td>${esc(log.target_type)} · ${esc(log.target_id || '-')}</td><td><small>${esc(log.detail || '-')}</small></td></tr>`).join('') || '<tr><td colspan="5">暂无操作记录</td></tr>'}</tbody></table></div></div>`);
    $('#create-code').onclick = async () => {
      try {
        const expiresValue = $('#code-expires').value;
        const expiresAt = expiresValue ? new Date(expiresValue).getTime() : null;
        const r = await api.createActivationCode($('#code-plan').value, $('#code-days').value, $('#code-count').value, expiresAt);
        $('#new-code').textContent = `已生成：${r.code}`;
        renderAdmin();
      } catch (e) { toast(e.message, 'error'); }
    };
    document.querySelectorAll('[data-save-user]').forEach((button) => { button.onclick = async () => {
      const row = button.closest('tr');
      try { await api.updateUser(row.dataset.user, { status: $('[data-status]', row).value }); toast('用户状态已更新'); renderAdmin(); } catch (e) { toast(e.message, 'error'); }
    }; });
    document.querySelectorAll('[data-grant-user]').forEach((button) => { button.onclick = async () => {
      const row = button.closest('tr');
      const planId = $('[data-grant-plan]', row).value;
      const days = $('[data-grant-days]', row).value;
      if (!(await confirmModal('赠送套餐权益', `向该用户赠送 ${planId.toUpperCase()} ${days} 天；将作为独立权益进入队列。`, '赠送'))) return;
      try { await api.grantEntitlement(row.dataset.user, planId, days); toast('套餐权益已赠送'); renderAdmin(); } catch (e) { toast(e.message, 'error'); }
    }; });
    document.querySelectorAll('[data-view-project]').forEach((button) => { button.onclick = async () => {
      try { showAdminProjectDetail(await api.adminProjectDetail(button.dataset.viewProject)); } catch (e) { toast(e.message, 'error'); }
    }; });
    document.querySelectorAll('[data-delete-project]').forEach((button) => { button.onclick = async () => {
      if (!(await confirmModal('删除项目', '会删除该项目全部版本和已上传文件，此操作不可恢复。', '删除', true))) return;
      try { await api.deleteAdminProject(button.dataset.deleteProject); toast('项目已删除'); renderAdmin(); } catch (e) { toast(e.message, 'error'); }
    }; });
    document.querySelectorAll('[data-delete-code]').forEach((button) => { button.onclick = async () => {
      if (!(await confirmModal('作废激活码', '作废后不能再用于注册。', '作废', true))) return;
      try { await api.deleteActivationCode(button.dataset.deleteCode); toast('激活码已作废'); renderAdmin(); } catch (e) { toast(e.message, 'error'); }
    }; });
    document.querySelectorAll('[data-refund-entitlement],[data-revoke-entitlement]').forEach((button) => { button.onclick = async () => {
      const refund = Boolean(button.dataset.refundEntitlement);
      const id = button.dataset.refundEntitlement || button.dataset.revokeEntitlement;
      const action = refund ? '退款' : '撤销';
      if (!(await confirmModal(`${action}套餐权益`, `${action}后仅移除此条权益，并自动重新排期其他权益。`, action, true))) return;
      try { await api.updateEntitlement(id, refund ? 'refunded' : 'revoked'); toast(`权益已${action}`); renderAdmin(); } catch (e) { toast(e.message, 'error'); }
    }; });
  } catch (e) { $('#admin-body').textContent = `加载失败：${e.message}`; }
}

function showAdminProjectDetail(data) {
  const root = document.getElementById('modal-root');
  const { project, versions, files } = data;
  root.innerHTML = `<div class="dialog-overlay" role="presentation">
    <div class="dialog-panel admin-detail" role="dialog" aria-modal="true" aria-labelledby="project-detail-title">
      <div class="dialog-title-row"><div><h3 id="project-detail-title">${esc(project.name)}</h3><p class="dialog-desc">${esc(project.owner_email)} · ${esc(project.slug)}</p></div><button class="btn btn-ghost" data-close-detail>关闭</button></div>
      <h4>版本记录</h4>
      <div class="admin-detail-table"><table><thead><tr><th>版本</th><th>状态</th><th>文件</th><th>大小</th><th>创建时间</th></tr></thead><tbody>${versions.map((v) => `<tr><td>v${v.version}</td><td>${esc(v.status)}</td><td>${v.file_count || 0}</td><td>${fmtBytes(v.total_size)}</td><td>${fmtTime(v.created_at)}</td></tr>`).join('') || '<tr><td colspan="5">暂无版本</td></tr>'}</tbody></table></div>
      <h4>当前线上文件 <small>(${files.length})</small></h4>
      <div class="admin-file-list">${files.map((file) => `<div><code>${esc(file.path)}</code><span>${fmtBytes(file.size)} · ${esc(file.mime || '-')}</span></div>`).join('') || '<p class="page-sub">当前没有已发布文件。</p>'}</div>
    </div>
  </div>`;
  const overlay = root.firstElementChild;
  const close = () => overlay.remove();
  $('[data-close-detail]', overlay).onclick = close;
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
}

function showVersionChanges({ changes }) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="dialog-overlay" role="presentation"><div class="dialog-panel admin-detail" role="dialog" aria-modal="true"><div class="dialog-title-row"><div><h3>版本改动</h3><p class="dialog-desc">本版本实际记录的文件操作</p></div><button class="btn btn-ghost" data-close-changes>关闭</button></div><div class="admin-file-list">${changes.length ? changes.map((change) => `<div><code>${esc(change.path)}</code><span>${change.action === 'delete' ? '删除' : '上传 / 替换'} · ${change.action === 'delete' ? '-' : fmtBytes(change.size)}</span></div>`).join('') : '<p class="page-sub">该版本没有文件改动记录。</p>'}</div></div></div>`;
  const overlay = root.firstElementChild;
  const close = () => overlay.remove();
  $('[data-close-changes]', overlay).onclick = close;
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
}

function updateAccountBar() {
  const slot = document.getElementById('account-slot');
  if (!slot) return;
  if (!CURRENT_USER) { slot.textContent = ''; return; }
  slot.innerHTML = `<span>${esc(CURRENT_USER.email)} · ${esc(CURRENT_USER.plan_id)}</span><button class="btn btn-ghost" id="password-btn">修改密码</button><button class="btn btn-ghost" id="logout-btn">退出</button>`;
  $('#password-btn').onclick = showPasswordDialog;
  $('#logout-btn').onclick = async () => { await api.logout(); CURRENT_USER = null; location.hash = '#/'; updateAccountBar(); renderAuth(); };
}

function showPasswordDialog() {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="dialog-overlay" role="presentation"><form class="dialog-panel" id="password-form" role="dialog" aria-modal="true" aria-labelledby="password-title">
    <h3 id="password-title">修改密码</h3><p class="dialog-desc">修改后，其他已登录设备会自动退出。</p>
    <div class="password-fields"><input name="current" type="password" placeholder="当前密码" autocomplete="current-password" required/><input name="next" type="password" placeholder="新密码（至少 8 位）" autocomplete="new-password" minlength="8" required/><input name="confirm" type="password" placeholder="确认新密码" autocomplete="new-password" minlength="8" required/></div>
    <div class="dialog-actions"><button type="button" class="btn btn-ghost" data-close-password>取消</button><button type="submit" class="btn">保存新密码</button></div>
  </form></div>`;
  const overlay = root.firstElementChild;
  const close = () => overlay.remove();
  $('[data-close-password]', overlay).onclick = close;
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  const form = $('#password-form', overlay);
  $('input', form).focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const values = new FormData(form);
    if (values.get('next') !== values.get('confirm')) return toast('两次输入的新密码不一致', 'error');
    try { await api.changePassword(values.get('current'), values.get('next')); close(); toast('密码已更新，其他设备已退出'); }
    catch (err) { toast(err.message, 'error'); }
  };
}

/** XHR 上传（fetch 不支持上传进度） */
function xhrUpload(url, body, onProgress, contentType, headers = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    if (contentType) xhr.setRequestHeader('Content-Type', contentType);
    Object.entries(headers).forEach(([name, value]) => xhr.setRequestHeader(name, value));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || `上传失败 (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('网络错误，上传中断'));
    xhr.send(body);
  });
}

// ---------------- 首页：项目列表 ----------------

async function renderHome() {
  app.innerHTML = `
    <div class="home-workbench">
      <main class="home-main">
        <div class="workspace-kicker"><i data-lucide="layout-dashboard"></i> WORKSPACE</div>
        <div class="page-head home-head">
          <div>
            <h1 class="page-title">我的项目</h1>
            <div class="page-sub">创建、部署并管理你的静态网站。</div>
          </div>
          <div class="page-actions">
            <div class="search-box"><input id="search" type="text" placeholder="搜索项目名称 / 地址标识..." /></div>
            <button class="btn btn-primary" id="btn-new"><i data-lucide="plus"></i>新建项目</button>
          </div>
        </div>
        <section class="projects-workspace">
          <div class="workspace-section-head"><span>全部项目</span><small id="project-count">正在读取…</small></div>
          <div id="grid" class="project-grid"><div class="skeleton">加载中…</div></div>
        </section>
      </main>
      <aside class="account-rail" aria-label="账户与套餐">
        <div class="rail-head"><span>账户概览</span><i data-lucide="credit-card"></i></div>
        <div id="usage" class="usage-grid"><div class="skeleton">正在读取额度…</div></div>
        <details class="rail-group" id="plans-group">
          <summary>套餐与权益 <i data-lucide="chevron-down"></i></summary>
          <section id="plans" class="plan-section"><div class="skeleton">正在读取套餐…</div></section>
        </details>
      </aside>
    </div>`;

  let q = '';
  const load = async () => {
    try {
      const [{ projects }, account] = await Promise.all([api.listProjects(q), api.accountUsage()]);
      renderUsage(account);
      renderGrid(projects);
      $('#project-count').textContent = `${projects.length} 个项目`;
    } catch (e) {
      $('#grid').innerHTML = `<div class="skeleton">加载失败:${esc(e.message)}</div>`;
    }
  };

  $('#search').addEventListener('input', debounce((e) => { q = e.target.value.trim(); load(); }, 250));
  $('#btn-new').onclick = async () => {
    const name = await promptModal('新建项目', '输入项目名称,例如 my-blog');
    if (!name) return;
    try {
      const { project } = await api.createProject(name);
      toast(`项目「${project.name}」创建成功`);
      location.hash = `#/p/${project.id}`;
    } catch (e) { toast(e.message, 'error'); }
  };

  await load();
}

function renderUsage({ plan, usage, plans, entitlements }) {
  const progress = (value, limit) => Math.min(100, Math.round((value / Math.max(Number(limit), 1)) * 100));
  const card = (label, value, limit, note) => `<div class="usage-card"><span>${label}</span><strong>${value}</strong><small>${note || `上限 ${limit}`}</small><div class="usage-meter"><i style="width:${progress(value, limit)}%"></i></div></div>`;
  const expires = plan.expires_at ? `到期：${fmtTime(plan.expires_at)}` : '内测套餐 · 暂无到期日';
  $('#usage').innerHTML = `
    <div class="usage-plan"><span>当前套餐</span><strong>${esc(plan.id).toUpperCase()}</strong><small>${expires}</small></div>
    ${card('项目数量', usage.projects, plan.project_limit, `${usage.projects} / ${plan.project_limit} 个项目`)}
    ${card('存储空间', usage.storage_bytes, plan.storage_limit_bytes, `${fmtBytes(usage.storage_bytes)} / ${fmtBytes(plan.storage_limit_bytes)}`)}
    ${card('本月流量', usage.traffic_bytes, plan.traffic_limit_bytes, `${fmtBytes(usage.traffic_bytes)} / ${fmtBytes(plan.traffic_limit_bytes)} · ${usage.period}`)}`;
  renderPlanCards(plans, plan.id, entitlements);
}

function renderPlanCards(plans, currentPlanId, entitlements) {
  const price = (cents) => cents ? `¥${(cents / 100).toFixed(1)} / 月` : '免费';
  const queue = entitlements.filter((entry) => ['active', 'queued'].includes(entry.status));
  $('#plans').innerHTML = `<div class="section-heading"><div><h2>套餐中心</h2><p>购买和赠送权益会独立排队。</p></div><form id="redeem-form" class="redeem-form"><input name="code" placeholder="输入套餐赠送码" required/><button class="btn" type="submit">兑换</button></form></div><div class="plan-grid">${plans.map((plan) => {
    const active = plan.id === currentPlanId;
    const purchasable = plan.monthly_price_cents > 0;
    return `<article class="plan-card ${active ? 'active' : ''}"><div><span class="plan-name">${esc(plan.id).toUpperCase()}</span><strong>${price(plan.monthly_price_cents)}</strong></div><ul><li>${plan.project_limit} 个项目</li><li>${fmtBytes(plan.storage_limit_bytes)} 存储</li><li>${fmtBytes(plan.traffic_limit_bytes)} / 月流量</li></ul><button class="btn ${active ? 'btn-ghost' : ''}" data-select-plan="${esc(plan.id)}" ${purchasable ? '' : 'disabled'}>${purchasable ? (active ? '续费 30 天' : '模拟购买 30 天') : '基础套餐'}</button></article>`;
  }).join('')}</div><div class="entitlement-queue"><h3>套餐权益队列</h3>${queue.length ? queue.map((entry) => `<div class="entitlement-row ${entry.status}"><span>${entry.status === 'active' ? '当前生效' : '后续生效'}</span><b>${esc(entry.plan_id).toUpperCase()}</b><small>${entry.duration_days} 天 · ${fmtTime(entry.starts_at)} → ${fmtTime(entry.ends_at)} · ${entry.source_type === 'activation_code' ? '赠送码' : '模拟购买'}</small></div>`).join('') : '<p>当前没有付费套餐权益，使用 Free 基础套餐。</p>'}</div>`;
  $('#redeem-form').onsubmit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const button = $('button', form);
    button.disabled = true;
    try {
      const result = await api.redeemCode(new FormData(form).get('code'));
      CURRENT_USER = result.user;
      updateAccountBar();
      toast(`已兑换 ${String(result.plan_id).toUpperCase()} ${result.duration_days} 天`);
      renderHome();
    } catch (err) { toast(err.message, 'error'); button.disabled = false; }
  };
  document.querySelectorAll('[data-select-plan]').forEach((button) => { button.onclick = async () => {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = '模拟支付处理中…';
    try {
      await new Promise((resolve) => setTimeout(resolve, 650));
      const result = await api.selectPlan(button.dataset.selectPlan);
      CURRENT_USER = result.user;
      updateAccountBar();
      toast('套餐已生效');
      renderHome();
    } catch (e) { button.disabled = false; button.textContent = original; toast(e.message, 'error'); }
  }; });
}

function renderGrid(projects) {
  const grid = $('#grid');
  if (!projects.length) {
    grid.innerHTML = `
      <div class="empty" style="grid-column: 1 / -1;">
        <div class="empty-icon"><i data-lucide="rocket"></i></div>
        <h3>还没有项目</h3>
        <p>点击右上角「新建项目」,把 HTML 或打包好的 dist 目录拖进来即可上线</p>
      </div>`;
    return;
  }
  grid.innerHTML = projects.map((p) => `
    <div class="card project-card" data-id="${esc(p.id)}">
      <h3>${esc(p.name)} <span class="slug-chip">${esc(p.slug)}</span></h3>
      ${p.current_version_id
        ? `<a class="project-url" href="${siteUrl(p.slug)}" target="_blank" rel="noopener" data-stop><i data-lucide="external-link"></i> ${siteUrl(p.slug)}</a>`
        : `<span class="project-url" style="color:var(--muted)">尚未部署 · 拖拽文件即可上线</span>`}
      <div class="project-meta">
        <span>版本 <b>${p.version_count}</b></span>
        ${p.current_version ? `<span>当前 <b>v${p.current_version}</b></span>` : ''}
        ${p.last_deployed_at ? `<span>最近部署 <b>${timeAgo(p.last_deployed_at)}</b></span>` : ''}
        <span>创建于 <b>${timeAgo(p.created_at)}</b></span>
      </div>
    </div>`).join('');

  grid.querySelectorAll('.project-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-stop]')) return;
      location.hash = `#/p/${card.dataset.id}`;
    });
  });
}

// ---------------- 详情页：部署 + 版本管理 ----------------

const STATUS_MAP = {
  active: ['已发布', 'badge-active'],
  uploading: ['上传中', 'badge-uploading'],
  failed: ['失败', 'badge-failed'],
};

async function renderProject(id) {
  app.innerHTML = `<div class="skeleton">加载中…</div>`;

  let project, versionsData, currentFilesData;
  let versionPage = 1;
  try {
    [{ project }, versionsData, currentFilesData] = await Promise.all([api.getProject(id), api.listVersions(id, versionPage), api.listFiles(id)]);
  } catch (e) {
    app.innerHTML = `
      <a class="back-link" href="#/"><i data-lucide="arrow-left"></i> 返回项目列表</a>
      <div class="empty"><div class="empty-icon"><i data-lucide="circle-alert"></i></div><h3>项目不存在</h3><p>${esc(e.message)}</p></div>`;
    return;
  }

  // ---- 部署状态(本页面局部状态) ----
  let selected = [];      // [{ file, path }]
  let selectedZip = null;
  let selectedDeletes = new Set();
  let deploying = false;
  let activeDir = '';
  let dragDepth = 0;

  app.innerHTML = `
    <a class="back-link" href="#/"><i data-lucide="arrow-left"></i> 返回项目列表</a>
    <div class="project-workbench">
      <main class="project-main">
        <div class="workspace-kicker"><i data-lucide="folder-kanban"></i> PROJECT WORKSPACE</div>
        <div class="page-head project-head">
          <div>
            <h1 class="page-title"><span id="project-name">${esc(project.name)}</span> <span class="slug-chip">${esc(project.slug)}</span></h1>
            <div class="page-sub">在这里整理文件，并将一组变更发布为新版本。</div>
          </div>
          <div class="page-actions">
            <button class="btn btn-sm btn-ghost" id="btn-edit-project" type="button"><i data-lucide="pencil"></i>编辑项目</button>
          </div>
        </div>
        <div class="card deploy-card">
      <div class="workspace-head">
        <div><h2 class="section-title">文件工作区</h2><p>所有操作先进入草稿，发布版本时才一次性上线。右键文件、文件夹或空白区域可查看更多操作。</p></div>
        <div class="workspace-actions">
          <button class="btn btn-sm btn-ghost" id="btn-pick-files" type="button"><i data-lucide="upload"></i>上传文件</button>
          <button class="btn btn-sm btn-ghost" id="btn-pick-dir" type="button"><i data-lucide="folder-up"></i>上传文件夹</button>
          <button class="btn btn-sm btn-ghost" id="btn-new-folder" type="button"><i data-lucide="folder-plus"></i>新建文件夹</button>
        </div>
      </div>
      <input type="file" id="input-files" multiple hidden />
      <input type="file" id="input-dir" webkitdirectory hidden />

      <div class="file-workspace" id="file-workspace">
        <aside class="file-tree" id="file-tree"></aside>
        <section class="file-document" id="file-document">
          <div class="file-document-head"><span id="file-breadcrumb">根目录</span><span id="file-count"></span></div>
          <div class="file-list" id="file-list"></div>
        </section>
      </div>
      <div class="draft-bar"><div class="draft-summary" id="file-summary"></div><button class="btn btn-ghost" id="btn-clear">清空草稿</button><button class="btn btn-primary" id="btn-deploy"><i data-lucide="rocket"></i>发布版本</button></div>

      <div class="progress-wrap" id="progress-wrap">
        <div class="progress-bar"><div class="progress-fill" id="progress-fill"></div></div>
        <div class="progress-text">
          <span class="pt-status" id="pt-status">准备中…</span>
          <span id="pt-detail"></span>
        </div>
      </div>
        </div>
        <div class="card versions-card"><h2 class="section-title">🕘 历史版本</h2><div id="versions-body"></div></div>
      </main>
      <aside class="project-rail">
        <div class="rail-head"><span>项目信息</span><i data-lucide="info"></i></div>
        <div class="project-rail-block">
          <span>项目名称</span>
          <strong id="rail-project-name">${esc(project.name)}</strong>
          <small>创建于 ${fmtTime(project.created_at)} · 标识 ${esc(project.slug)}</small>
          <div class="rail-actions"><button class="btn btn-sm btn-ghost" id="btn-edit-project-rail" type="button"><i data-lucide="pencil"></i>编辑</button></div>
        </div>
        <div class="project-rail-block"><span>固定访问地址</span><code>${siteUrl(project.slug)}</code><div class="rail-actions"><button class="btn btn-sm btn-ghost" id="btn-copy">复制</button><a class="btn btn-sm btn-ghost" href="${siteUrl(project.slug)}" target="_blank" rel="noopener">打开 ↗</a></div></div>
        <div class="project-rail-block"><span>当前上线版本</span><strong>${project.current_version ? `v${project.current_version}` : '尚未发布'}</strong><small>${project.current_version ? '固定地址正指向此版本' : '发布文件后即可访问'}</small></div>
        <div class="project-rail-block rail-danger"><span>危险操作</span><small>删除项目会同时删除全部版本文件。</small><button class="btn btn-danger" id="btn-del">删除项目</button></div>
      </aside>
    </div>`;

  // ---- 项目信息 / 固定地址 ----
  function applyProjectName(name) {
    project.name = name;
    const title = $('#project-name');
    if (title) title.textContent = name;
    const railName = $('#rail-project-name');
    if (railName) railName.textContent = name;
  }

  async function editProject() {
    const name = await editTextModal(
      '编辑项目',
      '修改项目显示名称。固定访问地址不会改变。',
      project.name,
      '保存'
    );
    if (name == null) return;
    if (!name) {
      toast('项目名称不能为空', 'error');
      return;
    }
    if (name === project.name) return;
    try {
      const { project: updated } = await api.updateProject(project.id, { name });
      applyProjectName(updated.name);
      toast('项目信息已更新');
    } catch (e) { toast(e.message, 'error'); }
  }

  $('#btn-edit-project').onclick = editProject;
  $('#btn-edit-project-rail').onclick = editProject;
  $('#btn-copy').onclick = () => copyText(siteUrl(project.slug)).then(() => toast('访问地址已复制'));

  $('#btn-del').onclick = async () => {
    const ok = await confirmModal(
      '删除项目',
      `将永久删除「${project.name}」及其全部历史版本文件,该操作不可恢复。`,
      '永久删除', true
    );
    if (!ok) return;
    try {
      await api.deleteProject(project.id);
      toast('项目已删除');
      location.hash = '#/';
    } catch (e) { toast(e.message, 'error'); }
  };

  // ---- 版本表格 ----
  function renderVersions() {
    const body = $('#versions-body');
    const list = versionsData.versions;
    if (!list.length) {
      body.innerHTML = `<div class="skeleton">还没有部署记录,拖入文件发布第一个版本吧</div>`;
      return;
    }
    body.innerHTML = `
      <table class="vt">
        <thead><tr>
          <th>版本</th><th>状态</th><th>说明 / 改动</th><th>文件数</th><th>大小</th><th>部署时间</th><th>版本地址</th><th>操作</th>
        </tr></thead>
        <tbody>${list.map((v) => {
          const [label, cls] = STATUS_MAP[v.status] || [v.status, ''];
          const isCurrent = v.id === versionsData.current_version_id;
          return `<tr class="${isCurrent ? 'is-current' : ''}">
            <td><span class="v-num">v${v.version}</span></td>
            <td><span class="badge ${cls}">${label}</span>${isCurrent ? ' <span class="badge badge-current">当前</span>' : ''}</td>
            <td>${v.note ? `<small>${esc(v.note)}</small><br/>` : ''}<button class="btn btn-sm btn-ghost" data-changes="${v.id}">改动 ${v.change_count || 0}</button></td>
            <td>${v.file_count}</td>
            <td>${fmtBytes(v.total_size)}</td>
            <td class="v-time" title="${fmtTime(v.created_at)}">${timeAgo(v.created_at)}</td>
            <td>${v.status === 'active'
              ? `<a class="v-link" href="${versionUrl(project.slug, v.version)}" target="_blank" rel="noopener">${versionUrl(project.slug, v.version).replace(/^https?:\/\//, '')} ↗</a>`
              : '-'}</td>
            <td>${v.status === 'active' && !isCurrent
              ? `<button class="btn btn-sm btn-ghost" data-rollback="${v.id}" data-v="${v.version}">回滚到此版本</button>`
              : ''}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
      <div class="versions-pagination">
        <span>共 ${versionsData.total || list.length} 个版本 · 第 ${versionsData.page || 1} / ${versionsData.total_pages || 1} 页</span>
        <div><button class="btn btn-sm btn-ghost" data-version-page="prev" ${versionPage <= 1 ? 'disabled' : ''}>上一页</button><button class="btn btn-sm btn-ghost" data-version-page="next" ${versionPage >= (versionsData.total_pages || 1) ? 'disabled' : ''}>下一页</button></div>
      </div>`;

    body.querySelectorAll('[data-rollback]').forEach((btn) => {
      btn.onclick = async () => {
        const ok = await confirmModal(
          '回滚版本',
          `固定地址将立即切换回 v${btn.dataset.v} 的内容,随时可再次回滚回来。`,
          '确认回滚'
        );
        if (!ok) return;
        try {
          await api.rollback(project.id, btn.dataset.rollback);
          toast(`已回滚到 v${btn.dataset.v}`);
          await refresh();
        } catch (e) { toast(e.message, 'error'); }
      };
    });
    body.querySelectorAll('[data-changes]').forEach((btn) => { btn.onclick = async () => {
      try { showVersionChanges(await api.versionChanges(btn.dataset.changes)); } catch (e) { toast(e.message, 'error'); }
    }; });
    body.querySelectorAll('[data-version-page]').forEach((btn) => { btn.onclick = async () => {
      versionPage += btn.dataset.versionPage === 'next' ? 1 : -1;
      await refresh();
    }; });
  }

  async function refresh(resetVersionPage = false) {
    if (resetVersionPage) versionPage = 1;
    [{ project }, versionsData, currentFilesData] = await Promise.all([api.getProject(project.id), api.listVersions(project.id, versionPage), api.listFiles(project.id)]);
    renderVersions();
  }

  renderVersions();

  // ---- 文件选择 ----
  const fileDocument = $('#file-document');
  const inputFiles = $('#input-files');
  const inputDir = $('#input-dir');

  $('#btn-pick-files').onclick = (e) => { e.stopPropagation(); inputFiles.click(); };
  $('#btn-pick-dir').onclick = (e) => { e.stopPropagation(); inputDir.click(); };
  $('#btn-new-folder').onclick = async () => {
    const name = await promptModal('新建文件夹', '输入文件夹名称');
    if (!name) return;
    if (/[\\/]/.test(name) || name === '.' || name === '..') return toast('文件夹名称不能包含路径分隔符', 'error');
    const marker = new File([''], '.tinysite-keep', { type: 'text/plain' });
    addFiles([{ file: marker, path: `${activeDir}${name}/.tinysite-keep` }]);
  };

  inputFiles.onchange = () => {
    addFiles([...inputFiles.files].map((f) => ({ file: f, path: activeDir + f.name })));
    inputFiles.value = '';
  };
  inputDir.onchange = () => {
    addFiles([...inputDir.files].map((f) => ({
      file: f,
      path: stripTopDir(f.webkitRelativePath || f.name),
    })));
    inputDir.value = '';
  };

  /** 选择文件夹时去掉顶层目录名,让入口保持为 index.html */
  function stripTopDir(p) {
    const parts = p.split('/');
    return parts.length > 1 ? parts.slice(1).join('/') : p;
  }

  // ---- 拖拽 ----
  fileDocument.addEventListener('dragenter', (e) => {
    e.preventDefault(); dragDepth++; fileDocument.classList.add('dragover');
  });
  fileDocument.addEventListener('dragover', (e) => e.preventDefault());
  fileDocument.addEventListener('dragleave', (e) => {
    e.preventDefault(); dragDepth--;
    if (dragDepth <= 0) { dragDepth = 0; fileDocument.classList.remove('dragover'); }
  });

  fileDocument.addEventListener('drop', async (e) => {
    dragDepth = 0;
    fileDocument.classList.remove('dragover');
    const items = e.dataTransfer.items;
    if (items && items.length && items[0].webkitGetAsEntry) {
      const entries = [...items].map((it) => it.webkitGetAsEntry()).filter(Boolean);
      const nested = await Promise.all(entries.map((en) => traverseEntry(en, '', true)));
      addFiles(nested.flat());
    } else {
      addFiles([...e.dataTransfer.files].map((f) => ({ file: f, path: activeDir + f.name })));
    }
  });

  /** 递归遍历拖入的目录,保留相对路径 */
  async function traverseEntry(entry, prefix, isTopLevel = false) {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      return [{ file, path: prefix + file.name }];
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      const all = [];
      let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        all.push(...batch);
      } while (batch.length > 0);
      // 顶层目录作为发布根目录；嵌套目录则保留其目录名。
      const base = isTopLevel ? prefix : prefix + entry.name + '/';
      if (!all.length) {
        return [{ file: new File([''], '.tinysite-keep', { type: 'text/plain' }), path: `${base}.tinysite-keep` }];
      }
      const nested = await Promise.all(all.map((e) => traverseEntry(e, base)));
      return nested.flat();
    }
    return [];
  }

  function addFiles(list) {
    if (deploying) return;
    selectedZip = null;
    const map = new Map(selected.map((f) => [f.path, f]));
    for (const f of list) if (f.path) { map.set(f.path, f); selectedDeletes.delete(f.path); }
    selected = [...map.values()];
    renderSelected();
  }

  function renderSelected() {
    renderFileWorkspace();
  }

  function parentDir(path) {
    const i = path.lastIndexOf('/');
    return i < 0 ? '' : path.slice(0, i + 1);
  }

  function fileName(path) { return path.slice(path.lastIndexOf('/') + 1); }

  function fileIcon(name) {
    const ext = name.split('.').pop().toLowerCase();
    if (['html', 'htm'].includes(ext)) return ['file-code-2', 'markup'];
    if (['css', 'scss', 'sass', 'less'].includes(ext)) return ['palette', 'style'];
    if (['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'vue', 'svelte'].includes(ext)) return ['file-code-2', 'script'];
    if (['json', 'jsonc', 'xml', 'yaml', 'yml', 'toml'].includes(ext)) return ['file-json-2', 'data'];
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'avif'].includes(ext)) return ['file-image', 'image'];
    if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'].includes(ext)) return ['file-audio-2', 'audio'];
    if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) return ['file-video-2', 'video'];
    if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext)) return ['file-archive', 'archive'];
    if (['csv', 'xls', 'xlsx', 'ods'].includes(ext)) return ['file-spreadsheet', 'sheet'];
    if (['pdf', 'md', 'txt', 'doc', 'docx', 'rtf'].includes(ext)) return ['file-text', 'text'];
    if (['woff', 'woff2', 'ttf', 'otf'].includes(ext)) return ['file-type-2', 'font'];
    return ['file', 'default'];
  }

  function fileIconHTML(name) {
    const [icon, type] = fileIcon(name);
    return `<i class="file-icon ${type}" data-lucide="${icon}" aria-hidden="true"></i>`;
  }

  function renderFileWorkspace() {
    const current = new Map((currentFilesData.files || []).map((file) => [file.path, file]));
    const staged = new Map(selected.map((file) => [file.path, file]));
    const paths = new Set([...current.keys(), ...staged.keys(), ...selectedDeletes]);
    const dirs = new Set(['']);
    for (const path of paths) {
      const parts = path.split('/');
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/') + '/');
    }
    if (!dirs.has(activeDir)) activeDir = '';

    const children = [...dirs].filter((dir) => dir !== activeDir && parentDir(dir.slice(0, -1)) === activeDir)
      .sort().map((dir) => ({ type: 'dir', path: dir, name: fileName(dir.slice(0, -1)) }));
    const files = [...paths].filter((path) => parentDir(path) === activeDir && fileName(path) !== '.tinysite-keep').sort().map((path) => {
      const uploading = staged.get(path);
      const existing = current.get(path);
      const removed = selectedDeletes.has(path);
      return { type: 'file', path, name: fileName(path), size: uploading ? uploading.file.size : existing?.size || 0,
        state: removed ? 'delete' : uploading ? (existing ? 'replace' : 'add') : 'keep' };
    });

    $('#file-tree').innerHTML = [...dirs].sort().map((dir) => `<button class="tree-row ${dir === activeDir ? 'active' : ''}" data-dir="${esc(dir)}">${dir ? '▸ ' + esc(fileName(dir.slice(0, -1))) : '⌂ 根目录'}</button>`).join('');
    $('#file-tree').querySelectorAll('[data-dir]').forEach((el) => { el.onclick = () => { activeDir = el.dataset.dir; renderFileWorkspace(); }; });
    $('#file-breadcrumb').textContent = activeDir ? `根目录 / ${activeDir}` : '根目录';
    $('#file-count').textContent = `${children.length + files.length} 项 · 右键操作`;
    $('#file-list').innerHTML = [...children, ...files].map((item) => item.type === 'dir'
      ? `<button class="file-row dir" data-open-dir="${esc(item.path)}"><i class="file-icon folder" data-lucide="folder" aria-hidden="true"></i><span>${esc(item.name)}</span><small>文件夹</small></button>`
      : `<div class="file-row ${item.state !== 'keep' ? 'is-' + item.state : ''}" data-file="${esc(item.path)}">${fileIconHTML(item.name)}<span>${esc(item.name)}</span><small>${fmtBytes(item.size)}</small>${item.state !== 'keep' ? `<b class="change-tag ${item.state}">${({ add: '新增', replace: '替换', delete: '删除' })[item.state]}</b>` : ''}</div>`).join('') || '<div class="file-empty">当前目录为空。拖入文件即可加入部署草稿。</div>';
    $('#file-list').querySelectorAll('[data-open-dir]').forEach((el) => {
      el.onclick = () => { activeDir = el.dataset.openDir; renderFileWorkspace(); };
      el.oncontextmenu = (event) => { event.preventDefault(); openDirectoryMenu(event.clientX, event.clientY, el.dataset.openDir); };
    });
    $('#file-list').querySelectorAll('[data-file]').forEach((el) => {
      el.oncontextmenu = (event) => { event.preventDefault(); openFileMenu(event.clientX, event.clientY, el.dataset.file); };
    });
    $('#file-list').oncontextmenu = (event) => {
      if (event.target.closest('[data-file],[data-open-dir]')) return;
      event.preventDefault();
      openWorkspaceMenu(event.clientX, event.clientY);
    };

    const added = selected.filter((file) => !current.has(file.path)).length;
    const replaced = selected.length - added;
    const summary = $('#file-summary');
    if (selectedZip) summary.innerHTML = `<span>ZIP 完整发布：${esc(selectedZip.name)} · ${fmtBytes(selectedZip.size)}</span><span>将以 ZIP 文件树计算新增、替换与删除</span>`;
    else if (selected.length || selectedDeletes.size) summary.innerHTML = `<strong>本次部署草稿</strong><span class="change-tag add">新增 ${added}</span><span class="change-tag replace">替换 ${replaced}</span><span class="change-tag delete">删除 ${selectedDeletes.size}</span><span class="draft-size">上传 ${fmtBytes(selected.reduce((sum, file) => sum + file.file.size, 0))}</span>`;
    else summary.innerHTML = '<span>暂无草稿操作。文件的新增、替换与删除会集中在这里，发布前不会影响线上站点。</span>';
    $('#btn-deploy').disabled = deploying || (!selected.length && !selectedZip && !selectedDeletes.size);
  }

  function openFileMenu(x, y, path) {
    const isDeleted = selectedDeletes.has(path);
    const published = (currentFilesData.files || []).some((file) => file.path === path) && !isDeleted;
    const menu = openContextMenu(x, y, `<button data-copy-link>↗ 复制访问链接</button><button data-download ${published ? '' : 'disabled'}>⇩ ${published ? '下载文件' : '下载文件（需先发布）'}</button><button data-mark-delete>${isDeleted ? '↶ 撤销删除' : '⌫ 标记删除'}</button>`);
    $('[data-copy-link]', menu).onclick = () => {
      copyText(fileUrl(project.slug, path)).then(() => toast('访问链接已复制'));
      menu.remove();
    };
    if (published) $('[data-download]', menu).onclick = () => {
      window.location.assign(`/api/projects/${encodeURIComponent(project.id)}/download?path=${encodeURIComponent(path)}`);
      menu.remove();
    };
    $('[data-mark-delete]', menu).onclick = () => {
      const isNew = selected.some((file) => file.path === path) && !(currentFilesData.files || []).some((file) => file.path === path);
      if (isDeleted) selectedDeletes.delete(path);
      else if (isNew) selected = selected.filter((file) => file.path !== path);
      else { selected = selected.filter((file) => file.path !== path); selectedDeletes.add(path); }
      menu.remove(); renderSelected();
    };
  }

  function openDirectoryMenu(x, y, path) {
    const menu = openContextMenu(x, y, `<button data-enter>↳ 进入文件夹</button><button data-copy-path>⧉ 复制目录路径</button><button data-delete-dir>⌫ 标记删除整个目录</button>`);
    $('[data-enter]', menu).onclick = () => { activeDir = path; menu.remove(); renderFileWorkspace(); };
    $('[data-copy-path]', menu).onclick = () => { copyText(path).then(() => toast('目录路径已复制')); menu.remove(); };
    $('[data-delete-dir]', menu).onclick = () => {
      const existing = (currentFilesData.files || []).filter((file) => file.path.startsWith(path)).map((file) => file.path);
      const allDeleted = existing.length && existing.every((filePath) => selectedDeletes.has(filePath));
      if (allDeleted) existing.forEach((filePath) => selectedDeletes.delete(filePath));
      else {
        selected = selected.filter((file) => !file.path.startsWith(path));
        existing.forEach((filePath) => selectedDeletes.add(filePath));
      }
      menu.remove(); renderSelected();
    };
  }

  function openWorkspaceMenu(x, y) {
    const menu = openContextMenu(x, y, `<button data-upload-files>↑ 上传文件</button><button data-upload-dir>↑ 上传文件夹</button><button data-new-folder>＋ 新建文件夹</button>`);
    $('[data-upload-files]', menu).onclick = () => { menu.remove(); inputFiles.click(); };
    $('[data-upload-dir]', menu).onclick = () => { menu.remove(); inputDir.click(); };
    $('[data-new-folder]', menu).onclick = () => { menu.remove(); $('#btn-new-folder').click(); };
  }

  function openContextMenu(x, y, html) {
    document.getElementById('file-context')?.remove();
    const menu = document.createElement('div');
    menu.id = 'file-context'; menu.className = 'file-context'; menu.tabIndex = -1;
    menu.innerHTML = html;
    document.body.appendChild(menu);
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    menu.style.left = `${Math.min(x, window.innerWidth - width - 8)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - height - 8)}px`;
    menu.focus();
    menu.onkeydown = (event) => { if (event.key === 'Escape') menu.remove(); };
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
    return menu;
  }

  $('#btn-clear').onclick = () => { selected = []; selectedZip = null; selectedDeletes.clear(); renderSelected(); };
  renderFileWorkspace();

  // ---- 部署 ----
  $('#btn-deploy').onclick = async () => {
    if ((!selected.length && !selectedZip && !selectedDeletes.size) || deploying) return;
    const note = await promptModal('发布说明（可选）', '例如：更新首页 Logo');
    if (note === null) return;
    deploying = true;
    fileDocument.classList.add('disabled');
    $('#btn-deploy').disabled = true;
    $('#progress-wrap').classList.add('show');

    const fill = $('#progress-fill');
    const status = $('#pt-status');
    const detail = $('#pt-detail');
    const setProgress = (pct, st, dt) => {
      fill.style.width = `${Math.min(100, Math.round(pct))}%`;
      if (st) status.textContent = st;
      if (dt !== undefined) detail.textContent = dt;
    };

    let vid = null;
    try {
      setProgress(2, '创建新版本…', '');
      const v = await api.createVersion(project.id);
      vid = v.id;

      const totalBytes = selected.reduce((s, f) => s + f.file.size, 0);
      let sentBase = 0;
      for (let i = 0; i < selected.length; i++) {
        const entry = selected[i];
        await xhrUpload(`/api/versions/${vid}/files`, entry.file, (loaded) => {
          const bytes = sentBase + loaded;
          setProgress((bytes / totalBytes) * 95, `上传中… ${i}/${selected.length} 个文件`, `${fmtBytes(bytes)} / ${fmtBytes(totalBytes)}`);
        }, entry.file.type || 'application/octet-stream', {
          'X-TinySite-Path': encodeURIComponent(entry.path),
          'X-TinySite-Size': String(entry.file.size),
        });
        sentBase += entry.file.size;
        setProgress((sentBase / totalBytes) * 95, `上传中… ${i + 1}/${selected.length} 个文件`, `${fmtBytes(sentBase)} / ${fmtBytes(totalBytes)}`);
      }

      if (selectedDeletes.size) {
        setProgress(96, '登记删除操作…', `${selectedDeletes.size} 个文件`);
        await api.deleteDraftFiles(vid, [...selectedDeletes]);
      }

      setProgress(98, '发布中…', '');
      await api.finalize(vid, note);
      setProgress(100, '部署完成 🎉', `v${v.version} 已上线`);
      toast(`部署成功,已发布 v${v.version}`);

      selected = []; selectedZip = null; selectedDeletes.clear();
      renderSelected();
      await refresh(true);
    } catch (e) {
      if (vid) { try { await api.abort(vid); } catch {} }
      setProgress(0, '部署失败', '');
      toast(`部署失败:${e.message}`, 'error');
    } finally {
      deploying = false;
      fileDocument.classList.remove('disabled');
      $('#btn-deploy').disabled = false;
      setTimeout(() => $('#progress-wrap').classList.remove('show'), 2500);
    }
  };
}

// ---------------- 路由 ----------------

function route() {
  if (!CURRENT_USER) return renderAuth();
  if (location.hostname.startsWith('admin-ts.')) return renderAdmin();
  const hash = location.hash || '#/';
  const m = hash.match(/^#\/p\/([\w-]+)/);
  if (m) renderProject(m[1]);
  else renderHome();
}

window.addEventListener('hashchange', route);

// 先拉取运行配置（站点域名后缀）,再进入路由渲染
fetch('/api/config')
  .then((r) => r.json())
  .then((cfg) => { SITE_BASE = cfg.siteBase || null; SITE_SUFFIX = cfg.siteSuffix || ''; })
  .catch(() => {})
  .then(async () => {
    try { CURRENT_USER = (await api.me()).user; } catch { CURRENT_USER = null; }
  })
  .finally(() => { updateAccountBar(); route(); });
