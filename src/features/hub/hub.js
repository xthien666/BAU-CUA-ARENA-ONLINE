/**
 * hub.js — Bầu Cua Victory Game Hub
 * Post-login game hub: 4 animated cards + bottom rail + modals
 * All animation, rewarded-ad state machine, and Socket.IO wiring.
 */

import { createCardMotion } from './card-motion.js';
import { createFriendMotion } from './friend-motion.js';

// ── Rewarded-Ad State Machine ──────────────────────────────────
const AD_STATES = ['idle', 'loading_ad', 'playing_ad', 'completed', 'granting_reward', 'success', 'cancelled', 'error'];
const AD_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours
const AD_REWARD_AMOUNT = 50000;
const IS_DEV = import.meta.env.DEV; // Vite replaces this at build time; production stays locked

let adState = 'idle';
let adCooldownUntil = 0;
let adCountdownInterval = null;
let adAnimFrame = null;
let adWatchCompleted = false; // only true after real ad-SDK callback or dev mock

// ── Particle System ─────────────────────────────────────────────
let particleCanvas = null;
let particleCtx = null;
let particles = [];
let particleRaf = null;
const MAX_PARTICLES = 28;

function initParticles() {
  particleCanvas = document.getElementById('hub-particles');
  if (!particleCanvas) return;
  particleCtx = particleCanvas.getContext('2d');
  resizeParticleCanvas();
  for (let i = 0; i < MAX_PARTICLES; i++) spawnParticle(true);
  animateParticles();
}

function resizeParticleCanvas() {
  if (!particleCanvas) return;
  particleCanvas.width = particleCanvas.offsetWidth;
  particleCanvas.height = particleCanvas.offsetHeight;
}

function spawnParticle(scatter = false) {
  if (!particleCanvas) return null;
  const w = particleCanvas.width;
  const h = particleCanvas.height;
  return {
    x: scatter ? Math.random() * w : Math.random() * w,
    y: scatter ? Math.random() * h : h + 5,
    r: Math.random() * 2 + 0.5,
    speed: Math.random() * 0.4 + 0.1,
    opacity: Math.random() * 0.5 + 0.1,
    hue: Math.random() < 0.7 ? 35 : (Math.random() < 0.5 ? 0 : 120),
    drift: (Math.random() - 0.5) * 0.3,
    life: 1,
  };
}

function animateParticles() {
  if (!particleCtx || !particleCanvas || document.hidden) {
    particleRaf = null;
    return;
  }

  const w = particleCanvas.width;
  const h = particleCanvas.height;
  particleCtx.clearRect(0, 0, w, h);

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.y -= p.speed;
    p.x += p.drift;
    p.life -= 0.003;
    const alpha = p.opacity * Math.min(p.life, 1);

    particleCtx.beginPath();
    particleCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    particleCtx.fillStyle = `hsla(${p.hue}, 80%, 70%, ${alpha})`;
    particleCtx.fill();

    if (p.y < -10 || p.x < -10 || p.x > w + 10 || p.life <= 0) {
      particles[i] = spawnParticle(false);
    }
  }

  // Spawn until max
  while (particles.length < MAX_PARTICLES) particles.push(spawnParticle(true));

  particleRaf = requestAnimationFrame(animateParticles);
}

// ── Hub Module ─────────────────────────────────────────────────
export function createHub({ enterRoom, socket, audioEnabled, notice }) {
  const hubEl = document.getElementById('hub');
  if (!hubEl) return null;

  // Gather elements
  const get = id => document.getElementById(id);
  const dragonPlayback = createCardMotion(get('hub-dragon-motion'));
  const friendPlayback = createFriendMotion(get('hub-friend-motion'), get('hub-friend-clip'));
  const tablePlayback = createCardMotion(get('hub-table-motion'));

  // ── Show/hide hub ──────────────────────────────────────────────
  let hubVisible = false;

  function showHub(playerName) {
    const nameEl = get('hub-player-name');
    if (nameEl && playerName) nameEl.textContent = playerName;

    hubEl.hidden = false;
    hubVisible = true;
    hubEl.style.setProperty('--hub-motion-state', 'running');
    dragonPlayback.setVisible(true);
    friendPlayback.setVisible(true);
    tablePlayback.setVisible(true);

    // The hidden lobby input can leave the fixed arcade viewport scrolled.
    // Reset it and move focus to the active view so the header is never clipped.
    const arcadeViewport = hubEl.closest('.arcade-viewport');
    requestAnimationFrame(() => {
      if (arcadeViewport) {
        arcadeViewport.scrollTop = 0;
        arcadeViewport.scrollLeft = 0;
      }
      hubEl.focus({ preventScroll: true });
    });

    // Sync sound state
    const soundBtn = get('hub-sound-toggle');
    if (soundBtn) soundBtn.setAttribute('aria-pressed', String(audioEnabled()));

    // Start particles
    if (!particleCanvas) {
      initParticles();
    } else if (!particleRaf) {
      animateParticles();
    }

  }

  function hideHub() {
    hubEl.hidden = true;
    hubVisible = false;
    hubEl.style.setProperty('--hub-motion-state', 'paused');
    dragonPlayback.setVisible(false);
    friendPlayback.setVisible(false);
    tablePlayback.setVisible(false);
    cancelAnimationFrame(particleRaf);
    particleRaf = null;
  }

  // Pause animations when page is hidden
  function onVisibilityChange() {
    hubEl.style.setProperty('--hub-motion-state', hubVisible && !document.hidden ? 'running' : 'paused');
    if (document.hidden) {
      cancelAnimationFrame(particleRaf);
      particleRaf = null;
    } else if (hubVisible) {
      animateParticles();
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange);

  // ── Card Actions ───────────────────────────────────────────────

  function setCardBusy(card, busy) {
    card.setAttribute('aria-busy', String(busy));
    card.disabled = busy;
  }

  // Card 1: Chơi nhanh — create a room immediately using existing logic
  const quickCard = get('hub-card-quick');
  if (quickCard) {
    quickCard.addEventListener('click', async () => {
      if (quickCard.getAttribute('aria-busy') === 'true') return;
      const name = getPlayerName();
      if (!name) { showNameWarning(); return; }

      setCardBusy(quickCard, true);
      try {
        await enterRoom('room:create', name, '');
        // enterRoom will call hideHub via state transition in main.js
      } catch (err) {
        console.error('[Hub] Quick play error:', err);
      } finally {
        setCardBusy(quickCard, false);
      }
    });
  }

  // Card 2: Chơi với bạn — open friend-room modal
  const friendCard = get('hub-card-friend');
  if (friendCard) {
    friendCard.addEventListener('click', () => {
      openModal('hub-friend-dialog');
      // Sync name from lobby input
      const name = getPlayerName();
      const nameInput = get('hub-friend-name');
      if (nameInput && name) nameInput.value = name;
    });
  }

  // Card 3: Chọn bàn — open table-select modal
  const tableCard = get('hub-card-table');
  if (tableCard) {
    tableCard.addEventListener('click', () => {
      openModal('hub-table-dialog');
      loadTableList();
    });
  }

  // Card 4: Game khác — coming soon
  const otherCard = get('hub-card-other');
  if (otherCard) {
    otherCard.addEventListener('click', () => openModal('hub-othergames-dialog'));
  }

  // ── Player name resolution ─────────────────────────────────────
  function getPlayerName() {
    // Try hub name first, then fallback to lobby form
    const lobbyInput = document.getElementById('player-name');
    return lobbyInput?.value?.trim() || '';
  }

  function showNameWarning() {
    const lobby = document.getElementById('home');
    if (lobby) {
      hideHub();
      lobby.hidden = false;
      const inp = document.getElementById('player-name');
      inp?.focus();
    }
  }

  // ── Friend-room modal actions ──────────────────────────────────
  const createRoomBtn = get('hub-create-room-btn');
  const joinRoomBtn = get('hub-join-room-btn');

  if (createRoomBtn) {
    createRoomBtn.addEventListener('click', async () => {
      const name = get('hub-friend-name')?.value?.trim() || getPlayerName();
      if (!name || name.length < 2) {
        setFriendStatus('Vui lòng nhập tên (ít nhất 2 ký tự).', true);
        return;
      }
      createRoomBtn.disabled = true;
      setFriendStatus('Đang tạo phòng…');
      try {
        closeModal('hub-friend-dialog');
        await enterRoom('room:create', name, '');
      } catch (err) {
        setFriendStatus(err.message || 'Lỗi tạo phòng.', true);
        createRoomBtn.disabled = false;
      }
    });
  }

  if (joinRoomBtn) {
    joinRoomBtn.addEventListener('click', async () => {
      const name = get('hub-friend-name')?.value?.trim() || getPlayerName();
      const code = get('hub-room-code-input')?.value?.trim().toUpperCase() || '';
      if (!name || name.length < 2) {
        setFriendStatus('Vui lòng nhập tên.', true);
        return;
      }
      if (!/^[A-Z0-9]{6}$/.test(code)) {
        setFriendStatus('Mã phòng phải đúng 6 ký tự.', true);
        return;
      }
      joinRoomBtn.disabled = true;
      setFriendStatus('Đang vào phòng…');
      try {
        closeModal('hub-friend-dialog');
        await enterRoom('room:join', name, code);
      } catch (err) {
        setFriendStatus(err.message || 'Không vào được phòng.', true);
        joinRoomBtn.disabled = false;
      }
    });
  }

  // Normalize room code input
  const hubCodeInput = get('hub-room-code-input');
  if (hubCodeInput) {
    hubCodeInput.addEventListener('input', () => {
      hubCodeInput.value = hubCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });
    hubCodeInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') joinRoomBtn?.click();
    });
  }

  function setFriendStatus(msg, isError = false) {
    const el = get('hub-friend-status');
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('error', isError);
  }

  // ── Table list (honest empty state if no backend list) ─────────
  function loadTableList() {
    const list = get('hub-table-list');
    const empty = get('hub-table-empty');
    if (!list || !empty) return;

    list.replaceChildren();
    empty.textContent = 'Chức năng danh sách bàn chưa được kích hoạt. Hãy dùng "Chơi với bạn" để vào phòng qua mã.';
    empty.hidden = false;

    // Integration boundary: when backend exposes a room list endpoint,
    // fetch it here and render hub-table-item rows. Example:
    //
    // fetch('/api/rooms').then(r => r.json()).then(rooms => {
    //   if (!rooms.length) return; // keep empty state
    //   empty.hidden = true;
    //   rooms.forEach(room => list.appendChild(buildTableItem(room)));
    // }).catch(() => {
    //   empty.textContent = 'Không tải được danh sách phòng.';
    // });
  }

  // ── Bottom rail actions ────────────────────────────────────────
  const navMap = {
    'hub-nav-friends':    'hub-addfriend-dialog',
    'hub-nav-gift':       'hub-gift-dialog',
    'hub-nav-tournament': 'hub-tournament-dialog',
    'hub-nav-alert':      'hub-alert-dialog',
    'hub-nav-chat':       'hub-livechat-dialog',
  };

  Object.entries(navMap).forEach(([btnId, modalId]) => {
    const btn = get(btnId);
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (btnId === 'hub-nav-gift') {
        openGiftModal();
      } else {
        openModal(modalId);
      }
    });
  });

  // ── Hub header buttons ─────────────────────────────────────────
  const hubSoundBtn = get('hub-sound-toggle');
  if (hubSoundBtn) {
    hubSoundBtn.addEventListener('click', () => {
      // Delegate to the existing sound toggle in arena
      document.getElementById('sound-toggle')?.click();
      hubSoundBtn.setAttribute('aria-pressed', String(audioEnabled()));
    });
  }

  const hubSettingsBtn = get('hub-settings-btn');
  if (hubSettingsBtn) {
    hubSettingsBtn.addEventListener('click', () => {
      document.getElementById('settings-toggle')?.click();
    });
  }

  get('hub-account-settings-btn')?.addEventListener('click', () => {
    document.getElementById('settings-toggle')?.click();
  });
  get('hub-account-news-btn')?.addEventListener('click', () => openModal('hub-news-dialog'));

  // ── Modal management ──────────────────────────────────────────
  function openModal(id) {
    const dialog = document.getElementById(id);
    if (!dialog) return;
    dialog.showModal();
    // Trap focus: find first focusable
    const focusable = dialog.querySelector('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    focusable?.focus();
  }

  function closeModal(id) {
    const dialog = document.getElementById(id);
    if (!dialog) return;
    dialog.close();
  }

  // Generic close-modal buttons
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
  });

  // Close modal on Escape (native dialog handles this)
  // Close on backdrop click
  document.querySelectorAll('.hub-modal').forEach(dialog => {
    dialog.addEventListener('click', e => {
      // Dialog element is the backdrop; card is inside
      if (e.target === dialog) dialog.close();
    });
  });

  // ── Rewarded Ad State Machine ──────────────────────────────────
  const AD_DURATION_MS = 15000; // 15s mock ad

  function openGiftModal() {
    // Determine correct initial state
    const now = Date.now();
    if (adState === 'success' && now < adCooldownUntil) {
      setAdState('idle'); // show cooldown info
    } else if (adState === 'success' || adState === 'cooldown') {
      adState = 'idle';
    }
    openModal('hub-gift-dialog');
    renderAdState();
  }

  function setAdState(state) {
    if (!AD_STATES.includes(state)) return;
    adState = state;
    renderAdState();
  }

  function renderAdState() {
    const states = document.querySelectorAll('#hub-gift-content [data-gift-state]');
    states.forEach(el => {
      el.hidden = el.dataset.giftState !== adState;
    });

    // Render cooldown text if in idle but cooling down
    if (adState === 'idle') {
      const now = Date.now();
      const cooldownEl = get('hub-gift-cooldown');
      const watchBtn = get('hub-watch-ad-btn');
      if (now < adCooldownUntil) {
        const remaining = Math.ceil((adCooldownUntil - now) / 60000);
        if (cooldownEl) {
          cooldownEl.textContent = `Quay lại sau ${remaining} phút để nhận quà tiếp.`;
          cooldownEl.hidden = false;
        }
        if (watchBtn) watchBtn.disabled = true;
      } else {
        if (cooldownEl) cooldownEl.hidden = true;
        if (watchBtn) watchBtn.disabled = false;
      }
    }

    if (adState === 'success') {
      const rewardEl = get('hub-reward-amount');
      if (rewardEl) rewardEl.textContent = Number(AD_REWARD_AMOUNT).toLocaleString('vi-VN');
      const nextInfo = get('hub-next-reward-info');
      const cooldownHours = Math.round(AD_COOLDOWN_MS / 3600000);
      if (nextInfo) nextInfo.textContent = `Bạn có thể nhận quà tiếp theo sau ${cooldownHours} giờ.`;
    }
  }

  // Watch-ad button
  const watchAdBtn = get('hub-watch-ad-btn');
  if (watchAdBtn) {
    watchAdBtn.addEventListener('click', () => {
      if (Date.now() < adCooldownUntil) return;
      if (adState !== 'idle') return;
      startAdFlow();
    });
  }

  // Retry button
  const retryBtn = get('hub-gift-retry-btn');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      setAdState('idle');
    });
  }

  // Cancel mock ad
  const cancelAdBtn = get('hub-ad-cancel-btn');
  if (cancelAdBtn) {
    cancelAdBtn.addEventListener('click', () => {
      cancelAd();
    });
  }

  function startAdFlow() {
    adWatchCompleted = false;
    setAdState('loading_ad');

    // ── Integration boundary: real Ad SDK ──────────────────────
    // When a real ad SDK is configured:
    //   adSdk.loadAd().then(() => {
    //     setAdState('playing_ad');
    //     adSdk.showAd({
    //       onComplete: () => { adWatchCompleted = true; grantReward(); },
    //       onCancelled: () => cancelAd(),
    //       onError: (err) => showAdError(err.message),
    //     });
    //   }).catch(err => showAdError(err.message));
    //
    // In production without SDK, show an honest disabled state:
    if (!IS_DEV) {
      // Honest unavailable state: no ad SDK configured
      setTimeout(() => {
        setAdState('error');
        const errEl = get('hub-gift-error-msg');
        if (errEl) errEl.textContent = 'Hệ thống quảng cáo chưa được cài đặt. Liên hệ admin.';
      }, 600);
      return;
    }

    // DEV-ONLY mock (IS_DEV === true):
    setTimeout(() => {
      setAdState('playing_ad');
      runMockAdCountdown();
    }, 800);
  }

  function runMockAdCountdown() {
    const totalMs = AD_DURATION_MS;
    const startTime = Date.now();
    const timerEl = get('hub-ad-timer');
    const progressBar = get('hub-ad-progress-bar');

    clearInterval(adCountdownInterval);
    adCountdownInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, totalMs - elapsed);
      const pct = ((elapsed / totalMs) * 100).toFixed(1);

      if (timerEl) timerEl.textContent = Math.ceil(remaining / 1000);
      if (progressBar) progressBar.style.width = `${pct}%`;

      if (elapsed >= totalMs) {
        clearInterval(adCountdownInterval);
        adWatchCompleted = true;
        grantReward();
      }
    }, 200);
  }

  function cancelAd() {
    clearInterval(adCountdownInterval);
    adWatchCompleted = false;
    setAdState('error');
    const errEl = get('hub-gift-error-msg');
    if (errEl) errEl.textContent = 'Đã bỏ qua quảng cáo. Không nhận được phần thưởng.';
  }

  function showAdError(msg) {
    clearInterval(adCountdownInterval);
    adWatchCompleted = false;
    setAdState('error');
    const errEl = get('hub-gift-error-msg');
    if (errEl) errEl.textContent = msg || 'Đã xảy ra lỗi khi tải quảng cáo.';
  }

  function grantReward() {
    // Safety check: only grant if ad was genuinely completed
    if (!adWatchCompleted) {
      cancelAd();
      return;
    }
    setAdState('completed');

    // ── Integration boundary: server-authoritative reward ──────
    // In production: send a signed completion token to the server
    // and wait for confirmation before showing 'success'.
    //
    // fetch('/api/rewards/ad-complete', { method: 'POST', body: JSON.stringify({ token: adSdk.completionToken }) })
    //   .then(r => r.json()).then(data => {
    //     if (data.ok) { adCooldownUntil = Date.now() + AD_COOLDOWN_MS; setAdState('success'); }
    //     else showAdError(data.error);
    //   }).catch(() => showAdError('Không thể xác nhận phần thưởng.'));
    //
    // For now (dev mock): grant locally
    setTimeout(() => {
      adCooldownUntil = Date.now() + AD_COOLDOWN_MS;
      adWatchCompleted = false;
      setAdState('success');

      // Restore focus to gift button when modal closes
      const giftDialog = get('hub-gift-dialog');
      if (giftDialog) {
        giftDialog.addEventListener('close', () => get('hub-nav-gift')?.focus(), { once: true });
      }
    }, 1200);
  }

  // Restore focus when gift dialog closes
  const giftDialog = get('hub-gift-dialog');
  if (giftDialog) {
    giftDialog.addEventListener('close', () => {
      // Return focus to gift nav button
      get('hub-nav-gift')?.focus();
    });
  }

  // ── Live Chat (simple in-hub chat, not Arena chat) ─────────────
  const chatForm = get('hub-chat-form');
  const chatInput = get('hub-chat-input');
  const chatMessages = get('hub-chat-messages');
  let chatLastSent = 0;
  const CHAT_RATE_LIMIT_MS = 2000;

  if (chatForm && chatInput && chatMessages) {
    chatForm.addEventListener('submit', e => {
      e.preventDefault();
      const text = chatInput.value.trim();
      if (!text) return;

      const now = Date.now();
      if (now - chatLastSent < CHAT_RATE_LIMIT_MS) {
        return; // rate limit
      }
      chatLastSent = now;

      // Sanitize
      const safe = text.slice(0, 200);
      const msg = document.createElement('div');
      msg.className = 'hub-chat-msg hub-chat-msg--me';
      msg.textContent = safe;
      chatMessages.appendChild(msg);
      chatMessages.scrollTop = chatMessages.scrollHeight;
      chatInput.value = '';

      // Integration boundary: emit to Socket.IO if connected
      // socket?.emit('hub:chat', { text: safe });
    });
  }

  // ── Resize canvas on window resize ────────────────────────────
  const resizeObserver = new ResizeObserver(() => resizeParticleCanvas());
  if (particleCanvas) resizeObserver.observe(particleCanvas);
  else {
    // Canvas may not exist yet, observe hub on first show
    window.addEventListener('resize', resizeParticleCanvas, { passive: true });
  }

  // ── Cleanup ────────────────────────────────────────────────────
  function cleanup() {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    dragonPlayback.cleanup();
    friendPlayback.cleanup();
    tablePlayback.cleanup();
    cancelAnimationFrame(particleRaf);
    particleRaf = null;
    clearInterval(adCountdownInterval);
    cancelAnimationFrame(adAnimFrame);
    resizeObserver.disconnect();
  }

  return { showHub, hideHub, cleanup };
}
