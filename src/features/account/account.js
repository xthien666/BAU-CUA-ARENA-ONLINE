import './account.css';

const presets = ['avatar_default', 'bau', 'cua', 'tom', 'ca', 'ga', 'nai'];
const format = value => Number(value ?? 0).toLocaleString('vi-VN');
const date = value => new Date(value).toLocaleString('vi-VN');

export function createAccountPanel({ auth, onProfile, onSignedOut }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'account-dialog';
  dialog.setAttribute('aria-labelledby', 'account-title');
  // Fixed template only; user-supplied values are assigned through textContent/value.
  dialog.innerHTML = `<header><h2 id="account-title">Hồ sơ & ví chung</h2><button type="button" data-close aria-label="Đóng hồ sơ">Đóng</button></header>
    <p data-status role="status" aria-live="polite"></p>
    <section data-profile>
      <p data-summary></p>
      <form data-profile-form><label>Tên hiển thị<input name="displayName" minlength="2" maxlength="24" required></label>
        <label>Avatar có sẵn<select name="avatarKey"></select></label><button type="submit">Lưu hồ sơ</button></form>
      <p data-email-state></p><button type="button" data-verify>Gửi email xác minh</button>
      <details><summary>Đổi mật khẩu</summary><form data-password-form>
        <label>Mật khẩu hiện tại<input name="currentPassword" type="password" autocomplete="current-password" required></label>
        <label>Mật khẩu mới<input name="newPassword" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></label>
        <button type="submit">Đổi mật khẩu và thu hồi mọi phiên</button></form></details>
      <button type="button" data-logout-all>Đăng xuất tất cả thiết bị</button>
      <details open><summary>Lịch sử xu</summary><ul data-transactions></ul><nav aria-label="Trang lịch sử xu"><button type="button" data-prev>Trang trước</button><span data-page></span><button type="button" data-next>Trang sau</button></nav></details>
      <details><summary>Lịch sử ván gần đây</summary><ul data-history></ul></details>
    </section>
    <form data-reset hidden><p>Liên kết đặt lại mật khẩu dùng một lần, có hạn 30 phút.</p>
      <label>Mật khẩu mới<input name="newPassword" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></label>
      <label>Nhập lại mật khẩu<input name="confirmPassword" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></label>
      <button type="submit">Đặt lại mật khẩu</button></form>`;
  document.body.append(dialog);
  const find = name => dialog.querySelector(`[data-${name}]`);
  let offset = 0;
  let transactionCount = 0;
  let linkToken = null;
  let profile;
  let lastFocus;
  function status(message, error = false) { find('status').textContent = message; find('status').classList.toggle('is-error', error); }
  function open() { lastFocus = document.activeElement; if (!dialog.open) dialog.showModal(); }
  dialog.addEventListener('close', () => lastFocus?.focus());
  find('close').onclick = () => dialog.close();
  for (const key of presets) {
    const option = document.createElement('option'); option.value = key; option.textContent = key === 'avatar_default' ? 'Mặc định' : key.toUpperCase();
    find('profile-form').elements.avatarKey.append(option);
  }
  async function work(button, callback) {
    button.disabled = true; status('Đang xử lý…');
    try { await callback(); }
    catch (error) { status(error.message, true); }
    finally {
      button.disabled = false;
      find('prev').disabled = offset === 0;
      find('next').disabled = transactionCount < 10;
    }
  }
  function items(target, values) {
    const list = values.length ? values : ['Chưa có dữ liệu.'];
    find(target).replaceChildren(...list.map(value => { const item = document.createElement('li'); item.textContent = value; return item; }));
  }
  async function transactions() {
    const data = await auth.request(`/api/me/wallet/transactions?limit=10&offset=${offset}`);
    transactionCount = data.length;
    items('transactions', data.map(tx => `${date(tx.createdAt)} · ${tx.transactionType} · ${format(tx.amount)} xu · số dư sau ${format(tx.balanceAfter)}`));
    find('prev').disabled = offset === 0; find('next').disabled = data.length < 10;
    find('page').textContent = `Trang ${offset / 10 + 1}`;
  }
  async function load() {
    profile = await auth.request('/api/me');
    find('summary').textContent = `${profile.username} · ${profile.email} · tham gia ${date(profile.joinedAt)} · ${format(profile.balance)} xu · ${profile.stats.gamesPlayed} ván (${profile.stats.wins} thắng / ${profile.stats.losses} thua)`;
    find('profile-form').elements.displayName.value = profile.displayName;
    find('profile-form').elements.avatarKey.value = presets.includes(profile.avatarKey) ? profile.avatarKey : 'avatar_default';
    find('email-state').textContent = profile.emailVerified ? 'Email đã xác minh.' : 'Email chưa xác minh; xác minh để có thể khôi phục mật khẩu.';
    find('verify').hidden = profile.emailVerified;
    await transactions();
    const rounds = await auth.request('/api/me/history?limit=20');
    items('history', rounds.map(round => `${date(round.settledAt)} · phòng ${round.roomCode} · ván ${round.roundNumber} · cược ${format(round.totalBet)}, nhận ${format(round.totalReturn)} xu`));
    status('Ví và lịch sử được lấy từ PostgreSQL.');
  }
  function openProfile() {
    find('profile').hidden = false; find('reset').hidden = true; offset = 0; open();
    work(find('close'), load);
  }
  document.getElementById('hub-auth-profile')?.addEventListener('click', openProfile);
  document.getElementById('hub-account-wallet-btn')?.addEventListener('click', openProfile);
  find('prev').onclick = () => { offset = Math.max(0, offset - 10); work(find('prev'), async () => { await transactions(); status('Đã tải lịch sử.'); }); };
  find('next').onclick = () => { offset += 10; work(find('next'), async () => { await transactions(); status('Đã tải lịch sử.'); }); };
  find('profile-form').onsubmit = event => {
    event.preventDefault(); const form = event.currentTarget;
    work(form.querySelector('button'), async () => {
      const data = await auth.request('/api/me/profile', { method: 'PATCH', body: Object.fromEntries(new FormData(form)) });
      onProfile(data.user); await load(); status('Đã lưu hồ sơ.');
    });
  };
  find('verify').onclick = () => work(find('verify'), async () => {
    await auth.request('/api/auth/email-verification/request', { method: 'POST', body: {} }); status('Đã gửi email xác minh. Kiểm tra cả thư rác.');
  });
  find('password-form').onsubmit = event => {
    event.preventDefault(); const form = event.currentTarget;
    work(form.querySelector('button'), async () => {
      await auth.request('/api/auth/change-password', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      form.reset(); dialog.close(); onSignedOut();
    });
  };
  find('logout-all').onclick = () => work(find('logout-all'), async () => {
    if (!window.confirm('Đăng xuất tài khoản trên tất cả thiết bị? Cược đã nhận vẫn được thanh toán.')) { status('Đã hủy thao tác.'); return; }
    await auth.request('/api/auth/logout-all', { method: 'POST', body: {} }); dialog.close(); onSignedOut();
  });
  find('reset').onsubmit = event => {
    event.preventDefault(); const form = event.currentTarget;
    if (form.elements.newPassword.value !== form.elements.confirmPassword.value) { status('Mật khẩu xác nhận không khớp.', true); return; }
    work(form.querySelector('button'), async () => {
      await auth.request('/api/auth/password-reset/confirm', { method: 'POST', body: { token: linkToken, newPassword: form.elements.newPassword.value } });
      linkToken = null; form.reset(); dialog.close(); onSignedOut();
    });
  };
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (fragment.has('reset-password') || fragment.has('verify-email')) {
    linkToken = fragment.get('reset-password') || fragment.get('verify-email');
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    find('profile').hidden = true; open();
    if (fragment.has('reset-password')) { find('reset').hidden = false; status('Nhập mật khẩu mới.'); }
    else work(find('close'), async () => {
      await auth.request('/api/auth/email-verification/confirm', { method: 'POST', body: { token: linkToken } });
      linkToken = null; status('Email đã xác minh. Bạn có thể đăng nhập và sử dụng chức năng khôi phục mật khẩu.');
    });
  }
}
