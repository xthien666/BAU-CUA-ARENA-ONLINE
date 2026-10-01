import './admin.css';
import { createAdminDialog } from './admin-dialog.js';

const el = id => document.getElementById(id);
const number = value => Number(value ?? 0).toLocaleString('vi-VN');
const date = value => value ? new Date(value).toLocaleString('vi-VN') : '—';
let csrfToken = null;
let user = null;
let selectedUser = null;
let rooms = [];
let currentView = 'overview';
let usersOffset = 0;
let auditOffset = 0;
let usersTotal = 0;
let auditTotal = 0;
let cleanupPreview = null;
let cleanupVersion = 0;
const LIMIT = 20;
const mutationIds = new Map();
const actionDialog = createAdminDialog({
  dialog: el('confirm-dialog'), form: el('confirm-dialog').querySelector('form'),
  title: el('confirm-title'), message: el('confirm-message'),
  reasonField: el('confirm-reason-field'), reasonInput: el('confirm-reason'), reasonError: el('confirm-reason-error'),
  accept: el('confirm-accept'), cancel: el('confirm-dialog').querySelector('[value="cancel"]'), document,
});

function node(tag, text = '', className = '') {
  const result = document.createElement(tag);
  result.textContent = text;
  if (className) result.className = className;
  return result;
}
function toast(message, error = false) {
  const item = node('div', message, error ? 'toast toast--error' : 'toast');
  el('toast-region').replaceChildren(item);
  setTimeout(() => item.remove(), 6000);
}
async function api(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const response = await fetch(path, { method, headers, credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || 'Không thể tải dữ liệu. Vui lòng thử lại.');
    error.code = payload.error?.code;
    error.status = response.status;
    throw error;
  }
  return payload.data;
}
async function mutation(path, body, method = 'POST') {
  // Keep the same request id after an uncertain timeout; a deliberate change
  // to the operation gets a new id.
  const key = JSON.stringify([method, path, body]);
  const requestId = mutationIds.get(key) || crypto.randomUUID();
  mutationIds.set(key, requestId);
  const result = await api(path, { method, body: { ...body, requestId } });
  mutationIds.delete(key);
  return result;
}
async function busy(button, work) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Đang xử lý…';
  try { return await work(); }
  catch (error) { toast(error.message, true); }
  finally {
    button.disabled = false; button.textContent = label;
    if (button.isConnected && document.activeElement === document.body) button.focus({ preventScroll: true });
  }
}
async function confirmAction(message) {
  return (await actionDialog.ask({ message })).confirmed;
}
function formError(form, message) {
  let error = form.querySelector('[data-form-error]');
  if (!error) { error = node('p', '', 'form-error'); error.dataset.formError = ''; error.setAttribute('role', 'alert'); form.append(error); }
  error.textContent = message;
}
function state(section, loading, error = '') {
  const spinner = el(`${section}-loading`);
  if (spinner) spinner.hidden = !loading;
  const notice = el(`${section}-error`);
  if (notice) { notice.hidden = !error; notice.textContent = error; }
}

function showLogin(message = 'Đăng nhập bằng tài khoản quản trị hệ thống.') {
  el('mfa-panel')?.remove();
  el('session-gate').hidden = false;
  el('admin-app').hidden = true;
  el('gate-loading').hidden = true;
  el('login-form').hidden = false;
  el('access-denied').hidden = true;
  el('gate-description').textContent = message;
}
async function showMfa() {
  const status = await api('/api/auth/mfa/status');
  if (status.verified && status.configured) return openDashboard();
  el('session-gate').hidden = false;
  el('admin-app').hidden = true;
  el('gate-loading').hidden = true;
  el('login-form').hidden = true;
  el('gate-description').textContent = status.configured
    ? 'Nhập mã 6 số từ ứng dụng Authenticator để tiếp tục.'
    : 'Thiết lập xác thực hai bước cho tài khoản quản trị.';
  el('mfa-panel')?.remove();
  const panel = node('div', '', 'login-form'); panel.id = 'mfa-panel';
  let setup = false;
  let setupReady = status.configured;
  if (!status.configured) {
    const start = node('button', 'Tạo khóa Authenticator', 'button button--primary'); start.type = 'button';
    start.onclick = () => busy(start, async () => {
      const data = await api('/api/auth/mfa/setup', { method: 'POST', body: {} });
      setup = true;
      setupReady = true;
      start.remove();
      const instruction = node('p', 'Trong ứng dụng Authenticator chọn thêm khóa thiết lập, nhập tên Bầu Cua và khóa bên dưới; chọn mã theo thời gian.', 'muted');
      const secret = node('input'); secret.value = data.secret; secret.readOnly = true; secret.setAttribute('aria-label', 'Khóa thiết lập Authenticator');
      panel.prepend(instruction, secret);
      form.hidden = false;
    });
    panel.append(start);
  }
  const form = node('form'); form.className = 'login-form';
  form.hidden = !setupReady;
  const label = node('label', 'Mã xác thực 6 số'); label.htmlFor = 'mfa-code';
  const input = node('input'); input.id = 'mfa-code'; input.inputMode = 'numeric'; input.autocomplete = 'one-time-code'; input.pattern = '[0-9]{6}'; input.maxLength = 6; input.required = true;
  const submit = node('button', 'Xác minh', 'button button--primary button--full'); submit.type = 'submit';
  form.append(label, input, submit);
  form.onsubmit = event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    busy(submit, async () => {
      try {
        await api(setup ? '/api/auth/mfa/verify-setup' : '/api/auth/mfa/verify', { method: 'POST', body: { code: input.value } });
        panel.remove(); await openDashboard();
      } catch (error) { formError(form, error.message); }
    });
  };
  const logout = node('button', 'Đăng xuất', 'button button--subtle'); logout.type = 'button'; logout.onclick = signOut;
  panel.append(form, logout);
  el('session-gate').querySelector('.login-card').append(panel);
}
async function acceptSession(data) {
  csrfToken = data.csrfToken;
  user = data.user;
  if (user.role !== 'admin') {
    el('gate-loading').hidden = true;
    el('login-form').hidden = true;
    el('access-denied').hidden = false;
    el('gate-description').textContent = 'Quyền quản trị là quyền tài khoản hệ thống.';
    return;
  }
  await showMfa();
}
async function openDashboard() {
  el('session-gate').hidden = true;
  el('admin-app').hidden = false;
  el('admin-name').textContent = user.displayName;
  el('admin-username').textContent = user.username;
  el('admin-avatar').textContent = user.displayName.slice(0, 1).toUpperCase();
  await switchView(location.hash.slice(1) || 'overview');
}
async function signOut() {
  try { await api('/api/auth/logout', { method: 'POST', body: {} }); }
  catch (error) { if (error.status !== 401) { toast(error.message, true); return; } }
  csrfToken = null; user = null; selectedUser = null; mutationIds.clear();
  el('mfa-panel')?.remove(); showLogin();
}
el('login-form').onsubmit = event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  busy(form.querySelector('button[type=submit]'), async () => {
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: { username: el('login-username').value.trim(), password: el('login-password').value } });
      el('login-password').value = ''; el('login-error').textContent = '';
      await acceptSession(data);
    } catch (error) { el('login-error').textContent = error.message; }
  });
};
el('logout-button').onclick = signOut;
el('retry-account').onclick = signOut;

async function switchView(name) {
  if (!['overview', 'users', 'rooms', 'override', 'audit', 'cleanup'].includes(name)) name = 'overview';
  currentView = name;
  const titles = { overview: 'Tổng quan', users: 'Người chơi', rooms: 'Phòng chơi', override: 'Kết quả ván', audit: 'Nhật ký', cleanup: 'Dọn dữ liệu' };
  document.querySelectorAll('[data-section]').forEach(section => { section.hidden = section.dataset.section !== name; section.classList.toggle('is-active', !section.hidden); });
  document.querySelectorAll('[data-view]').forEach(button => {
    const active = button.dataset.view === name;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  el('page-title').textContent = titles[name];
  history.replaceState(null, '', `#${name}`);
  closeMenu();
  el('admin-content').focus({ preventScroll: true });
  await refresh(name);
}
document.querySelectorAll('[data-view]').forEach(button => { button.onclick = () => switchView(button.dataset.view); });
document.querySelectorAll('[data-refresh]').forEach(button => { button.onclick = () => refresh(button.dataset.refresh); });
function closeMenu() { el('sidebar').classList.remove('is-open'); el('sidebar-scrim').hidden = true; el('menu-button').setAttribute('aria-expanded', 'false'); }
el('menu-button').onclick = () => { el('sidebar').classList.add('is-open'); el('sidebar-scrim').hidden = false; el('menu-button').setAttribute('aria-expanded', 'true'); };
el('sidebar-scrim').onclick = closeMenu;
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });

async function refresh(name) {
  try {
    state(name, true);
    if (name === 'overview') await loadOverview();
    if (name === 'users') await loadUsers();
    if (name === 'rooms' || name === 'override') await loadRooms();
    if (name === 'audit') await loadAudit();
    el('connection-status').textContent = '';
  } catch (error) {
    state(name, false, error.message);
    el('connection-status').textContent = 'Dữ liệu chưa cập nhật. Hãy làm mới để thử lại.';
    if (error.status === 401) showLogin('Phiên đã hết hạn. Đăng nhập lại để tiếp tục.');
    if (['MFA_REQUIRED', 'MFA_SETUP_REQUIRED'].includes(error.code)) await showMfa();
  } finally { state(name, false, el(`${name}-error`)?.textContent || ''); }
}
async function loadOverview() {
  const data = await api('/api/admin/overview');
  const metrics = [ ['Người đang kết nối', data.live.players], ['Phòng đang chạy', data.live.rooms], ['Tài khoản', data.users.total], ['Tài khoản bị khóa', data.users.banned], ['Xu admin đã cấp', data.coins.adminGrants], ['Cược đang chờ', data.pendingBets.amount] ];
  el('overview-metrics').replaceChildren(...metrics.map(([label, value]) => {
    const item = node('article', '', 'metric-card'); item.append(node('p', label, 'metric-label'), node('strong', number(value), 'metric-value')); return item;
  }));
  el('overview-metrics').hidden = false;
  el('overview-updated').textContent = `Cập nhật lúc ${date(data.live.observedAt)} · Bấm Làm mới để lấy số liệu hiện tại`;
  el('overview-details').replaceChildren(...[
    ['Phòng tạm dừng', data.rooms.paused], ['Ván chưa chốt', data.rounds.unfinished], ['Ván quá hạn cần kiểm tra', data.rounds.stalled], ['Lượt đăng nhập còn hiệu lực', data.activeSessions.sessions],
  ].map(([label, value]) => { const entry = node('div', '', 'detail-item'); entry.append(node('span', label), node('strong', number(value))); return entry; }));
}
function badge(status) { return node('span', ({ active: 'Hoạt động', banned: 'Đã khóa', deleted: 'Đã xóa', paused: 'Tạm dừng', closed: 'Đã đóng' })[status] || status, `status-badge status-badge--${status}`); }
async function loadUsers() {
  const query = new URLSearchParams({ search: el('user-search').value.trim(), status: el('user-status-filter').value, limit: LIMIT, offset: usersOffset });
  const data = await api(`/api/admin/users?${query}`); usersTotal = data.total;
  el('users-body').replaceChildren(...data.items.map(account => {
    const row = node('tr');
    const identity = node('td'); identity.append(node('strong', account.displayName), node('small', `${account.username} · ${account.email}`, 'muted'));
    const status = node('td'); status.append(badge(account.status));
    const action = node('td'); const button = node('button', 'Chi tiết', 'button button--subtle'); button.type = 'button'; button.onclick = () => busy(button, () => loadUser(account.id)); action.append(button);
    row.append(identity, status, node('td', account.role === 'admin' ? 'Admin' : 'Người chơi'), node('td', number(account.wallet?.balance), 'numeric'), node('td', date(account.createdAt)), action);
    [...row.children].forEach((cell, index) => { cell.dataset.label = ['Tài khoản', 'Trạng thái', 'Quyền', 'Ví xu', 'Ngày tạo', 'Thao tác'][index]; });
    return row;
  }));
  el('users-table').hidden = !data.items.length; el('users-empty').hidden = Boolean(data.items.length);
  el('users-page').textContent = `Trang ${Math.floor(usersOffset / LIMIT) + 1} · ${number(data.total)} tài khoản`;
  el('users-prev').disabled = usersOffset === 0; el('users-next').disabled = usersOffset + LIMIT >= usersTotal;
}
async function loadUser(id) {
  const data = await api(`/api/admin/users/${id}`); selectedUser = data.user;
  el('user-detail-empty').hidden = true; el('user-detail-content').hidden = false;
  el('user-detail-title').textContent = selectedUser.displayName;
  el('user-profile-summary').replaceChildren(node('p', `${selectedUser.username} · ${selectedUser.email}`), node('p', `ID: ${selectedUser.id}`), node('strong', `Số dư: ${number(selectedUser.wallet?.balance)} xu`), badge(selectedUser.status));
  el('pending-bets').replaceChildren(node('h4', 'Cược đang chờ'), ...data.pendingBets.map(bet => node('p', `${bet.roomCode} · ${bet.symbol} · ${number(bet.amount)} xu · ${bet.roundStatus}`)));
  if (!data.pendingBets.length) el('pending-bets').append(node('p', 'Không có cược đang chờ.', 'muted'));
  const transactions = node('details'); transactions.append(node('summary', 'Giao dịch gần đây'));
  transactions.append(...data.recentTransactions.map(tx => node('p', `${date(tx.createdAt)} · ${tx.type} · ${number(tx.amount)} xu · sau: ${number(tx.balanceAfter)}`)));
  el('pending-bets').append(transactions);
  for (const id of ['grant-form', 'ban-form', 'delete-user-form']) el(id).hidden = selectedUser.status === 'deleted' || selectedUser.role === 'admin';
  el('ban-form').hidden ||= selectedUser.status === 'banned';
  el('unban-form').hidden = selectedUser.status !== 'banned';
}
el('close-user-detail').onclick = () => { selectedUser = null; el('user-detail-content').hidden = true; el('user-detail-empty').hidden = false; };
el('user-search-form').onsubmit = event => { event.preventDefault(); usersOffset = 0; refresh('users'); };
el('users-prev').onclick = () => { usersOffset = Math.max(0, usersOffset - LIMIT); refresh('users'); };
el('users-next').onclick = () => { usersOffset += LIMIT; refresh('users'); };

for (const [formId, path, method, message] of [
  ['grant-form', 'grants', 'POST', 'Cấp xu'], ['ban-form', 'ban', 'POST', 'Khóa tài khoản'], ['unban-form', 'unban', 'POST', 'Gỡ khóa'], ['delete-user-form', '', 'DELETE', 'Xóa mềm tài khoản'],
]) {
  el(formId).onsubmit = async event => {
    event.preventDefault(); const form = event.currentTarget;
    if (!selectedUser || !form.reportValidity()) return;
    const fields = Object.fromEntries(new FormData(form));
    if (formId === 'grant-form') fields.amount = Number(fields.amount);
    if (fields.bannedUntil) fields.bannedUntil = new Date(fields.bannedUntil).toISOString();
    if (!await confirmAction(`${message} đối với ${selectedUser.username}? ${formId === 'grant-form' ? `${number(fields.amount)} xu. Số dư dự kiến: ${number(selectedUser.wallet?.balance)} → ${number(Number(selectedUser.wallet?.balance) + fields.amount)} xu.` : ''}`)) return;
    busy(form.querySelector('button[type=submit]'), async () => {
      try {
        await mutation(`/api/admin/users/${selectedUser.id}${path ? `/${path}` : ''}`, fields, method);
        toast(`${message} thành công.`); await loadUser(selectedUser.id); await refresh('users');
      } catch (error) { formError(form, error.message); }
    });
  };
}
async function roomAction(room, action, extra = {}) {
  const labels = { pause: 'Tạm dừng', resume: 'Tiếp tục', close: 'Đóng phòng', cancel: 'Hủy ván', kick: 'Đưa ra khỏi phòng', lock: extra.locked ? 'Khóa phòng' : 'Mở khóa phòng', 'betting-duration': 'Đổi thời gian ván sau' };
  const label = labels[action];
  let message = `${label} · Phòng ${room.code}.`;
  if (action === 'close') message += ' Phòng sẽ đóng và cược chưa chốt được hoàn theo quy tắc hệ thống.';
  if (action === 'cancel') message += ' Hủy ván hiện tại và hoàn cược chưa chốt.';
  if (action === 'betting-duration') message += ` Thời gian mới: ${extra.durationSeconds} giây, áp dụng từ ván sau.`;
  if (action === 'kick') message += ` Người chơi: ${room.members.find(member => member.id === extra.userId)?.displayName || extra.userId}.`;
  const { confirmed, reason } = await actionDialog.ask({ title: label, message, requireReason: true, confirmLabel: label });
  if (!confirmed) return;
  let path = `/api/admin/rooms/${room.id}`; let body = { reason, ...extra };
  if (['pause', 'resume', 'close'].includes(action)) { path += '/status'; body.status = { pause: 'paused', resume: 'active', close: 'closed' }[action]; }
  else if (action === 'cancel') { path = `/api/admin/rounds/${room.currentRound.id}/cancel`; body.roomId = room.id; }
  else if (action === 'kick') path += `/members/${extra.userId}/kick`;
  else path += `/${action}`;
  await mutation(path, body); toast('Thao tác quản trị đã được áp dụng.'); await refresh('rooms');
}
async function loadRooms() {
  const data = await api('/api/admin/rooms?limit=100'); rooms = data.items;
  el('rooms-list').replaceChildren(...rooms.map(room => {
    const card = node('article', '', 'panel room-card');
    card.append(node('h3', `${room.code} · ${room.name}`), badge(room.status), node('p', `Host: ${room.host.displayName} · ${room.memberCount}/${room.capacity} người`), node('p', `Ván: ${room.currentRound?.roundNumber || '—'} · ${room.currentRound?.status || 'chưa mở'} · ${room.locked ? 'Khóa' : 'Mở'} · ${room.bettingDuration}s`));
    if (room.currentRound) card.append(node('p', `Hạn cược: ${room.status === 'paused' ? 'Đang tạm dừng' : date(room.currentRound.bettingDeadline)}`));
    if (room.status !== 'closed') {
      const actions = node('div', '', 'room-actions');
      const controls = [ [room.status === 'paused' ? 'Tiếp tục' : 'Tạm dừng', room.status === 'paused' ? 'resume' : 'pause', {}], [room.locked ? 'Mở khóa' : 'Khóa phòng', 'lock', { locked: !room.locked }], ['Đóng phòng', 'close', {}] ];
      if (room.currentRound) controls.push(['Hủy ván', 'cancel', {}]);
      for (const [label, action, extra] of controls) { const button = node('button', label, 'button button--secondary'); button.type = 'button'; button.onclick = () => busy(button, () => roomAction(room, action, extra)); actions.append(button); }
      const duration = node('select'); duration.setAttribute('aria-label', `Thời gian cược phòng ${room.code}`);
      for (const seconds of [15, 30, 45, 60]) { const option = node('option', `${seconds} giây`); option.value = seconds; option.selected = room.bettingDuration === seconds; duration.append(option); }
      const save = node('button', 'Đổi thời gian ván sau', 'button button--subtle'); save.type = 'button'; save.onclick = () => busy(save, () => roomAction(room, 'betting-duration', { durationSeconds: Number(duration.value) })); actions.append(duration, save); card.append(actions);
      const members = node('details'); members.append(node('summary', 'Thành viên trong phòng'));
      for (const member of room.members) { const line = node('div', '', 'member-row'); line.append(node('span', `${member.displayName} · ${member.role}`)); const kick = node('button', 'Đưa ra khỏi phòng', 'button button--subtle'); kick.type = 'button'; kick.onclick = () => busy(kick, () => roomAction(room, 'kick', { userId: member.id })); line.append(kick); members.append(line); }
      card.append(members);
    }
    return card;
  }));
  el('rooms-list').hidden = !rooms.length; el('rooms-empty').hidden = Boolean(rooms.length);
  const selected = el('override-room').value;
  el('override-room').replaceChildren(node('option', 'Chọn phòng đang chạy'));
  el('override-room').firstChild.value = '';
  for (const room of rooms.filter(item => item.currentRound && item.status !== 'closed')) { const option = node('option', `${room.code} · Ván ${room.currentRound.roundNumber} · ${room.currentRound.resultMode}`); option.value = room.id; el('override-room').append(option); }
  el('override-room').value = selected; updateSelectedRoom();
}
const SYMBOLS = { bau: 'Bầu', cua: 'Cua', tom: 'Tôm', ca: 'Cá', ga: 'Gà', nai: 'Nai' };
for (let i = 1; i <= 3; i++) for (const [value, label] of Object.entries(SYMBOLS)) { const option = node('option', label); option.value = value; el(`override-die-${i}`).append(option); }
function updateSelectedRoom() { const room = rooms.find(item => item.id === el('override-room').value); el('override-round').value = room?.currentRound?.id || ''; el('selected-room-summary').textContent = room ? `${room.code} · ${room.currentRound?.status} · ${room.currentRound?.resultMode}` : 'Chưa chọn phòng.'; }
el('override-room').onchange = updateSelectedRoom;
el('override-random').onchange = () => { el('dice-fields').disabled = el('override-random').checked; };
el('override-form').onsubmit = event => {
  event.preventDefault(); const form = event.currentTarget;
  if (!form.reportValidity()) return;
  busy(form.querySelector('button[type=submit]'), async () => {
    try {
      await mutation(`/api/admin/rounds/${el('override-round').value}/override`, { roomId: el('override-room').value, dice: el('override-random').checked ? null : [1, 2, 3].map(i => el(`override-die-${i}`).value), reason: el('override-reason').value });
      toast('Đã áp dụng kết quả cho đúng ván được chọn.'); await loadRooms();
    } catch (error) { formError(form, error.message); }
  });
};
async function loadAudit() {
  const query = new URLSearchParams({ limit: LIMIT, offset: auditOffset, action: el('audit-action').value.trim() });
  const data = await api(`/api/admin/audit-logs?${query}`); auditTotal = data.total;
  el('audit-body').replaceChildren(...data.items.map(entry => {
    const row = node('tr'); row.append(node('td', date(entry.createdAt)), node('td', entry.adminUsername || entry.adminId), node('td', entry.action), node('td', `${entry.targetType}: ${entry.targetId}`), node('td', entry.reason));
    [...row.children].forEach((cell, index) => { cell.dataset.label = ['Thời gian', 'Quản trị viên', 'Hành động', 'Đối tượng', 'Lý do'][index]; });
    const details = node('details'); details.append(node('summary', 'Trước/sau'), node('pre', JSON.stringify(entry.changes, null, 2))); row.lastChild.append(details); return row;
  }));
  el('audit-table').hidden = !data.items.length; el('audit-empty').hidden = Boolean(data.items.length);
  el('audit-page').textContent = `Trang ${Math.floor(auditOffset / LIMIT) + 1} · ${number(auditTotal)} bản ghi`;
  el('audit-prev').disabled = auditOffset === 0; el('audit-next').disabled = auditOffset + LIMIT >= auditTotal;
}
el('audit-filter-form').onsubmit = event => { event.preventDefault(); auditOffset = 0; refresh('audit'); };
el('audit-prev').onclick = () => { auditOffset = Math.max(0, auditOffset - LIMIT); refresh('audit'); };
el('audit-next').onclick = () => { auditOffset += LIMIT; refresh('audit'); };

function invalidateCleanup() {
  cleanupVersion += 1;
  cleanupPreview = null;
  el('cleanup-preview').hidden = true;
  el('cleanup-confirmation').value = '';
  el('cleanup-execute').disabled = true;
}
function updateCleanupButton() {
  el('cleanup-execute').disabled = !cleanupPreview || cleanupPreview.expiresAt < Date.now()
    || el('cleanup-confirmation').value !== 'XOA VINH VIEN'
    || !['rooms', 'users', 'audit'].some(key => cleanupPreview.counts[key] > 0);
}
el('cleanup-preview-form').addEventListener('input', invalidateCleanup);
el('cleanup-confirmation').addEventListener('input', updateCleanupButton);
el('cleanup-preview-form').onsubmit = event => {
  event.preventDefault();
  if (!event.currentTarget.reportValidity()) return;
  invalidateCleanup();
  const version = cleanupVersion;
  const body = { retentionDays: Number(el('cleanup-days').value), categories: Object.fromEntries(['rooms', 'users', 'audit'].map(key => [key, el(`cleanup-${key}`).checked])) };
  el('cleanup-result').hidden = true;
  busy(event.currentTarget.querySelector('button[type=submit]'), async () => {
    state('cleanup', true);
    try {
      const data = await api('/api/admin/cleanup/preview', { method: 'POST', body });
      if (version !== cleanupVersion) return;
      cleanupPreview = data;
      el('cleanup-cutoff').textContent = `Chỉ dọn dữ liệu đủ điều kiện trước ${date(data.cutoff)}. Database hiện ${(data.databaseBytes / 1024 / 1024).toFixed(1)} MB.`;
      el('cleanup-counts').replaceChildren(...[['rooms', 'Phòng đã đóng'], ['users', 'Người chơi đã xóa mềm'], ['audit', 'Nhật ký cũ']].map(([key, label]) => {
        const item = node('div', '', 'cleanup-count'); item.append(node('strong', number(data.counts[key])), node('span', label)); return item;
      }));
      el('cleanup-skipped').textContent = data.skippedUsers
        ? `${number(data.skippedUsers)} người chơi đã xóa mềm chưa được chọn vì còn dữ liệu liên quan cần giữ hoặc vượt giới hạn lượt dọn.`
        : 'Chỉ xóa người chơi không còn liên quan đến phòng, cược hoặc dữ liệu cần giữ.';
      const labels = { rounds: 'Ván chơi', bets: 'Khoản cược', results: 'Kết quả người chơi', memberships: 'Thành viên phòng', wallets: 'Ví', transactions: 'Giao dịch của tài khoản sẽ xóa', sessions: 'Phiên đăng nhập', tokens: 'Token tài khoản', rewards: 'Phiên quà tặng', commands: 'Lệnh của dữ liệu đã kết thúc' };
      el('cleanup-related').replaceChildren(...Object.entries(labels).flatMap(([key, label]) => [node('dt', label), node('dd', number(data.counts[key]))]));
      el('cleanup-preview').hidden = false;
      state('cleanup', false);
      updateCleanupButton();
    } catch (error) {
      state('cleanup', false, error.message);
      if (error.status === 401) showLogin();
      if (['MFA_REQUIRED', 'MFA_SETUP_REQUIRED'].includes(error.code)) await showMfa();
    } finally { el('cleanup-loading').hidden = true; }
  });
};
el('cleanup-execute-form').onsubmit = event => {
  event.preventDefault();
  if (!event.currentTarget.reportValidity() || !cleanupPreview) return;
  const preview = cleanupPreview;
  const version = cleanupVersion;
  busy(el('cleanup-execute'), async () => {
    try {
      const confirmed = await actionDialog.ask({ title: 'Xóa vĩnh viễn dữ liệu cũ',
        message: `Xóa ${number(preview.counts.rooms)} phòng, ${number(preview.counts.users)} người chơi và ${number(preview.counts.audit)} nhật ký cùng dữ liệu liên quan đã xem trước. Thao tác không thể hoàn tác trên web.`,
        requireReason: true, confirmLabel: 'Xóa vĩnh viễn' });
      if (!confirmed.confirmed) return;
      if (version !== cleanupVersion || el('cleanup-confirmation').value !== 'XOA VINH VIEN') throw new Error('Phạm vi đã thay đổi. Hãy xem trước lại.');
      const result = await mutation('/api/admin/cleanup', { previewToken: preview.previewToken, confirmation: 'XOA VINH VIEN', reason: confirmed.reason });
      invalidateCleanup();
      el('cleanup-result').textContent = `Đã dọn ${number(result.counts.rooms)} phòng, ${number(result.counts.users)} người chơi và ${number(result.counts.audit)} nhật ký. Tài khoản Admin và dữ liệu đang hoạt động được giữ. Xem trước lại nếu muốn dọn lượt tiếp theo.`;
      el('cleanup-result').hidden = false;
      state('cleanup', false);
      toast('Đã dọn dữ liệu và lưu nhật ký thao tác.');
      usersOffset = 0; auditOffset = 0; selectedUser = null;
      el('user-detail-content').hidden = true; el('user-detail-empty').hidden = false;
    } catch (error) {
      state('cleanup', false, error.message);
      if (['PREVIEW_CHANGED', 'PREVIEW_EXPIRED', 'PREVIEW_INVALID'].includes(error.code)) invalidateCleanup();
      if (error.status === 401) showLogin();
      if (['MFA_REQUIRED', 'MFA_SETUP_REQUIRED'].includes(error.code)) await showMfa();
    }
  }).finally(updateCleanupButton);
};
window.addEventListener('hashchange', () => { if (user?.role === 'admin') switchView(location.hash.slice(1)); });
try { await acceptSession(await api('/api/auth/me')); }
catch (error) { showLogin(error.status === 401 ? undefined : error.message); }
