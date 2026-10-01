/**
 * AUTH.JS — Authentication controller for Bầu Cua Victory
 * Implements accessible 3-state modal: ĐĂNG KÝ, ĐĂNG NHẬP, QUÊN MẬT KHẨU
 * Features: Focus trap, Escape close, inline validation and same-origin
 * cookie/session authentication. The session token remains HttpOnly; only the
 * short-lived CSRF value is kept in memory by this controller.
 */

export function createAuth({ onAuthenticated } = {}) {
  const dialog = document.getElementById('auth-dialog');
  if (!dialog) {
    console.warn('[auth] #auth-dialog not found in DOM');
    return { openAuth: () => {}, closeAuth: () => {}, cleanup: () => {} };
  }

  // Titles & tabs
  const titleText = document.getElementById('auth-title-text');
  const tabsContainer = document.getElementById('auth-tabs');
  const tabRegister = document.getElementById('auth-tab-register');
  const tabLogin = document.getElementById('auth-tab-login');
  const btnClose = document.getElementById('auth-close-btn');

  // Views
  const viewRegister = document.getElementById('auth-view-register');
  const viewLogin = document.getElementById('auth-view-login');
  const viewForgot = document.getElementById('auth-view-forgot');

  // Register elements
  const regForm = document.getElementById('auth-form-register');
  const regUsername = document.getElementById('auth-reg-username');
  const regEmail = document.getElementById('auth-reg-email');
  const regPassword = document.getElementById('auth-reg-password');
  const regConfirm = document.getElementById('auth-reg-confirm');
  const regDisplayName = document.getElementById('auth-reg-displayname');
  const errRegUsername = document.getElementById('err-auth-reg-username');
  const errRegEmail = document.getElementById('err-auth-reg-email');
  const errRegPassword = document.getElementById('err-auth-reg-password');
  const errRegConfirm = document.getElementById('err-auth-reg-confirm');
  const errRegDisplayName = document.getElementById('err-auth-reg-displayname');
  const statusReg = document.getElementById('auth-status-register');
  const btnRegister = document.getElementById('auth-btn-register-submit');

  // Login elements
  const loginForm = document.getElementById('auth-form-login');
  const loginUsername = document.getElementById('auth-login-username');
  const loginPassword = document.getElementById('auth-login-password');
  const errLoginUsername = document.getElementById('err-auth-login-username');
  const errLoginPassword = document.getElementById('err-auth-login-password');
  const statusLogin = document.getElementById('auth-status-login');
  const btnLogin = document.getElementById('auth-btn-login-submit');
  const linkForgot = document.getElementById('auth-link-forgot');
  const btnDemo = document.getElementById('auth-btn-demo-play');

  // Forgot elements
  const forgotForm = document.getElementById('auth-form-forgot');
  const forgotUsername = document.getElementById('auth-forgot-username');
  const forgotEmail = document.getElementById('auth-forgot-email');
  const errForgotUsername = document.getElementById('err-auth-forgot-username');
  const errForgotEmail = document.getElementById('err-auth-forgot-email');
  const statusForgot = document.getElementById('auth-status-forgot');
  const btnOk = document.getElementById('auth-btn-forgot-ok');
  const linkBackLogin = document.getElementById('auth-link-back-login');

  let currentView = 'login';
  let previousActiveElement = null;
  let currentUser = null;
  let csrfToken = null;

  // Set message helpers with textContent to avoid XSS
  function setError(element, message) {
    if (!element) return;
    element.textContent = message || '';
  }

  function setStatus(element, message, type = 'error') {
    if (!element) return;
    element.textContent = message || '';
    element.className = 'auth-status';
    if (message) {
      element.classList.add(`auth-status--${type}`);
    }
  }

  function clearAllErrors() {
    [errRegUsername, errRegEmail, errRegPassword, errRegConfirm, errRegDisplayName,
     errLoginUsername, errLoginPassword, errForgotUsername, errForgotEmail].forEach(el => setError(el, ''));
    [statusReg, statusLogin, statusForgot].forEach(el => setStatus(el, ''));
    dialog.querySelectorAll('input').forEach(input => input.removeAttribute('aria-invalid'));
  }

  // Password visibility toggles
  const pwToggles = dialog.querySelectorAll('.auth-pw-toggle');
  pwToggles.forEach(toggle => {
    toggle.addEventListener('click', () => {
      const targetId = toggle.getAttribute('data-target');
      const input = document.getElementById(targetId);
      if (!input) return;
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      toggle.setAttribute('aria-label', isPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
      toggle.textContent = isPassword ? '🙈' : '👁️';
    });
  });

  // Switch between register / login / forgot
  function switchView(viewName) {
    currentView = viewName;
    clearAllErrors();

    if (viewName === 'register') {
      if (tabsContainer) tabsContainer.style.display = 'flex';
      tabRegister?.setAttribute('aria-selected', 'true');
      tabLogin?.setAttribute('aria-selected', 'false');
      viewRegister?.classList.add('auth-view--active');
      viewRegister?.setAttribute('aria-hidden', 'false');
      viewLogin?.classList.remove('auth-view--active');
      viewLogin?.setAttribute('aria-hidden', 'true');
      viewForgot?.classList.remove('auth-view--active');
      viewForgot?.setAttribute('aria-hidden', 'true');
      if (titleText) titleText.textContent = 'ĐĂNG KÝ TÀI KHOẢN';
      regUsername?.focus();
    } else if (viewName === 'login') {
      if (tabsContainer) tabsContainer.style.display = 'flex';
      tabRegister?.setAttribute('aria-selected', 'false');
      tabLogin?.setAttribute('aria-selected', 'true');
      viewRegister?.classList.remove('auth-view--active');
      viewRegister?.setAttribute('aria-hidden', 'true');
      viewLogin?.classList.add('auth-view--active');
      viewLogin?.setAttribute('aria-hidden', 'false');
      viewForgot?.classList.remove('auth-view--active');
      viewForgot?.setAttribute('aria-hidden', 'true');
      if (titleText) titleText.textContent = 'ĐĂNG NHẬP';
      loginUsername?.focus();
    } else if (viewName === 'forgot') {
      if (tabsContainer) tabsContainer.style.display = 'none';
      viewRegister?.classList.remove('auth-view--active');
      viewRegister?.setAttribute('aria-hidden', 'true');
      viewLogin?.classList.remove('auth-view--active');
      viewLogin?.setAttribute('aria-hidden', 'true');
      viewForgot?.classList.add('auth-view--active');
      viewForgot?.setAttribute('aria-hidden', 'false');
      if (titleText) titleText.textContent = 'QUÊN MẬT KHẨU';
      forgotUsername?.focus();
    }
  }

  // Focus trap implementation
  function getFocusableElements() {
    const selector = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(dialog.querySelectorAll(selector)).filter(el => {
      return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
    });
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAuth();
      return;
    }

    if (event.key === 'Tab') {
      const focusables = getFocusableElements();
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (event.shiftKey) {
        if (document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
  }

  // Open modal
  function openAuth(initialState = 'login', initialName = '') {
    previousActiveElement = document.activeElement;
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }

    if (initialName) {
      if (loginUsername) loginUsername.value = initialName;
      if (regDisplayName) regDisplayName.value = initialName;
      if (regUsername) regUsername.value = initialName.toLowerCase().replace(/[^a-z0-9_]/g, '');
    }

    switchView(initialState);
    dialog.addEventListener('keydown', handleKeyDown);
  }

  // Close modal
  function closeAuth() {
    dialog.removeEventListener('keydown', handleKeyDown);
    if (typeof dialog.close === 'function') {
      if (dialog.open) dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
    if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
      previousActiveElement.focus();
    }
  }

  async function api(path, { method = 'GET', body = null, csrf = false } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== null) headers['Content-Type'] = 'application/json';
    if (csrf && csrfToken) headers['X-CSRF-Token'] = csrfToken;
    const response = await fetch(path, {
      method,
      credentials: 'include',
      headers,
      body: body === null ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.error?.message || 'Không thể kết nối máy chủ tài khoản.');
      error.code = payload?.error?.code || 'REQUEST_FAILED';
      error.status = response.status;
      throw error;
    }
    return payload.data;
  }

  async function submitRequest({ button, status, action }) {
    if (button) button.disabled = true;
    const originalText = button ? button.innerHTML : '';
    if (button) button.innerHTML = '<span class="auth-spinner" aria-hidden="true"></span>Đang xử lý…';
    setStatus(status, '');
    try {
      return await action();
    } finally {
      if (button) {
        button.disabled = false;
        button.innerHTML = originalText;
      }
    }
  }

  function acceptSession(data) {
    currentUser = data?.user || null;
    if (currentUser && Number.isSafeInteger(data?.wallet?.balance)) {
      currentUser = { ...currentUser, balance: data.wallet.balance };
    }
    csrfToken = data?.csrfToken || csrfToken;
    if (currentUser && typeof onAuthenticated === 'function') {
      onAuthenticated({
        user: currentUser,
        csrfToken,
        displayName: currentUser.displayName,
        isDemo: false,
      });
    }
    return currentUser;
  }

  async function restoreSession() {
    try {
      return acceptSession(await api('/api/auth/me'));
    } catch (error) {
      if (error.status !== 401) console.warn('[auth] Session restore failed:', error.message);
      currentUser = null;
      csrfToken = null;
      return null;
    }
  }

  async function logout() {
    if (!currentUser) return;
    await api('/api/auth/logout', { method: 'POST', body: {}, csrf: true });
    currentUser = null;
    csrfToken = null;
  }

  // Form validations
  function validateRegister() {
    clearAllErrors();
    let valid = true;

    const u = regUsername?.value?.trim() || '';
    if (!u) {
      setError(errRegUsername, 'Vui lòng nhập tên đăng nhập.');
      regUsername?.setAttribute('aria-invalid', 'true');
      valid = false;
    } else if (!/^[a-zA-Z0-9_]{3,24}$/.test(u)) {
      setError(errRegUsername, '3–24 ký tự chữ, số hoặc dấu gạch dưới.');
      regUsername?.setAttribute('aria-invalid', 'true');
      valid = false;
    }

    const e = regEmail?.value?.trim() || '';
    if (!e) {
      setError(errRegEmail, 'Vui lòng nhập email.');
      regEmail?.setAttribute('aria-invalid', 'true');
      valid = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 254) {
      setError(errRegEmail, 'Email không đúng định dạng.');
      regEmail?.setAttribute('aria-invalid', 'true');
      valid = false;
    }

    const p = regPassword?.value || '';
    if (!p) {
      setError(errRegPassword, 'Vui lòng nhập mật khẩu.');
      regPassword?.setAttribute('aria-invalid', 'true');
      valid = false;
    } else if (p.length < 8) {
      setError(errRegPassword, 'Mật khẩu phải từ 8 ký tự trở lên.');
      regPassword?.setAttribute('aria-invalid', 'true');
      valid = false;
    }

    const c = regConfirm?.value || '';
    if (!c) {
      setError(errRegConfirm, 'Vui lòng xác nhận mật khẩu.');
      regConfirm?.setAttribute('aria-invalid', 'true');
      valid = false;
    } else if (c !== p) {
      setError(errRegConfirm, 'Mật khẩu xác nhận không khớp.');
      regConfirm?.setAttribute('aria-invalid', 'true');
      valid = false;
    }

    const d = regDisplayName?.value?.trim() || '';
    if (!d) {
      setError(errRegDisplayName, 'Vui lòng nhập tên hiển thị.');
      regDisplayName?.setAttribute('aria-invalid', 'true');
      valid = false;
    } else if (d.length < 2 || d.length > 24) {
      setError(errRegDisplayName, 'Tên hiển thị từ 2 đến 24 ký tự.');
      regDisplayName?.setAttribute('aria-invalid', 'true');
      valid = false;
    }

    return valid;
  }

  function validateLogin() {
    clearAllErrors();
    let valid = true;

    const u = loginUsername?.value?.trim() || '';
    if (!u) {
      setError(errLoginUsername, 'Vui lòng nhập tên đăng nhập.');
      loginUsername?.setAttribute('aria-invalid', 'true');
      valid = false;
    }

    const p = loginPassword?.value || '';
    if (!p) {
      setError(errLoginPassword, 'Vui lòng nhập mật khẩu.');
      loginPassword?.setAttribute('aria-invalid', 'true');
      valid = false;
    }

    return valid;
  }

  function validateForgot() {
    clearAllErrors();
    let valid = true;

    const u = forgotUsername?.value?.trim() || '';
    if (!u) {
      setError(errForgotUsername, 'Vui lòng nhập tên đăng nhập.');
      forgotUsername?.setAttribute('aria-invalid', 'true');
      valid = false;
    }

    const e = forgotEmail?.value?.trim() || '';
    if (!e) {
      setError(errForgotEmail, 'Vui lòng nhập email đăng ký.');
      forgotEmail?.setAttribute('aria-invalid', 'true');
      valid = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      setError(errForgotEmail, 'Email không đúng định dạng.');
      forgotEmail?.setAttribute('aria-invalid', 'true');
      valid = false;
    }

    return valid;
  }

  // Event wiring
  tabRegister?.addEventListener('click', () => switchView('register'));
  tabLogin?.addEventListener('click', () => switchView('login'));
  linkForgot?.addEventListener('click', e => { e.preventDefault(); switchView('forgot'); });
  linkBackLogin?.addEventListener('click', e => { e.preventDefault(); switchView('login'); });
  btnClose?.addEventListener('click', () => closeAuth());

  // Click backdrop to close
  dialog.addEventListener('click', event => {
    if (event.target === dialog) {
      closeAuth();
    }
  });

  // Register submit
  regForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!validateRegister()) return;
    try {
      const data = await submitRequest({
        button: btnRegister,
        status: statusReg,
        action: () => api('/api/auth/register', {
          method: 'POST',
          body: {
            username: regUsername.value.trim(),
            email: regEmail.value.trim(),
            password: regPassword.value,
            displayName: regDisplayName.value.trim(),
          },
        }),
      });
      acceptSession(data);
      closeAuth();
    } catch (error) {
      setStatus(statusReg, error.message, 'error');
    }
  });

  // Login submit
  loginForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!validateLogin()) return;
    try {
      const data = await submitRequest({
        button: btnLogin,
        status: statusLogin,
        action: () => api('/api/auth/login', {
          method: 'POST',
          body: { username: loginUsername.value.trim(), password: loginPassword.value },
        }),
      });
      acceptSession(data);
      closeAuth();
    } catch (error) {
      setStatus(statusLogin, error.message, 'error');
    }
  });

  // Forgot submit
  forgotForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!validateForgot()) return;
    try {
      await submitRequest({
        button: btnOk,
        status: statusForgot,
        action: () => api('/api/auth/password-reset/request', {
          method: 'POST',
          body: { username: forgotUsername.value.trim(), email: forgotEmail.value.trim() },
        }),
      });
      setStatus(statusForgot, 'Nếu thông tin khớp, hướng dẫn đặt lại mật khẩu sẽ được gửi đến email của bạn.', 'success');
    } catch (error) {
      setStatus(statusForgot, error.message, 'error');
    }
  });

  // Demo play path (Honest offline entry)
  btnDemo?.addEventListener('click', () => {
    const rawName = loginUsername?.value?.trim() || regDisplayName?.value?.trim() || '';
    const cleanName = rawName.slice(0, 24) || `Khách_${Math.floor(1000 + Math.random() * 9000)}`;
    closeAuth();
    if (typeof onAuthenticated === 'function') {
      onAuthenticated({ displayName: cleanName, isDemo: true });
    }
  });

  function cleanup() {
    dialog.removeEventListener('keydown', handleKeyDown);
  }

  return {
    openAuth,
    closeAuth,
    switchView,
    restoreSession,
    logout,
    getUser: () => currentUser,
    getCsrfToken: () => csrfToken,
    request: (path, options = {}) => api(path, { ...options, csrf: Boolean(options.method && options.method !== 'GET') }),
    cleanup,
  };
}
