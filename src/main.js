import { io } from 'socket.io-client';
import './style.css';
import './arena.css';
import { createBowlReveal } from './bowl.js';

const ui = Object.fromEntries([...document.querySelectorAll('[id]')].map(element => [element.id, element]));
const sessionKey = 'bau-cua-arena-session';
const socket = io({ autoConnect: false, reconnection: true, reconnectionDelay: 700, reconnectionDelayMax: 4000 });
const number = value => Number(value).toLocaleString('vi-VN');
const signed = value => `${value > 0 ? '+' : ''}${number(value)}`;
const DEFAULT_CHIPS = [1000, 5000, 10000, 50000, 100000, 500000];
const CHIP_ASSET_NAMES = Object.freeze({
  1000: '1k',
  5000: '5k',
  10000: '10k',
  50000: '50k',
  100000: '100k',
  500000: '500k',
});

// Định dạng tiền gọn gàng như sòng bài (vd: 56.2M, 1.5M, 100K)
function formatCompactCoins(num) {
  const val = Number(num);
  if (isNaN(val)) return '0';
  if (val >= 1_000_000_000) return (val / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'B';
  if (val >= 1_000_000) return (val / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (val >= 1_000) return (val / 1_000).toFixed(0) + 'K';
  return number(val);
}

function bettingChipValues() {
  const configured = Array.isArray(config?.chips)
    ? config.chips.filter(value => Object.hasOwn(CHIP_ASSET_NAMES, value))
    : [];
  return configured.length > 0 ? configured : DEFAULT_CHIPS;
}

let config = null;
let symbols = new Map();
let room = null;
let savedSession = readSession();
let selectedChip = null;
let serverOffset = 0;
let busy = false;
let synced = false;
let loadingConfig = false;
let acceptingMembership = false;
let sessionReplaced = false;
let connectionEpoch = 0;
const symbolViews = new Map();
const chipButtons = [];
let audioEnabled = true;
let audioCtx = null;
const backgroundMusic = ui['background-music'];

if (backgroundMusic) {
  backgroundMusic.volume = 0.8;
  backgroundMusic.loop = true;
}

function startBackgroundMusic() {
  if (!audioEnabled || !backgroundMusic || !backgroundMusic.paused) return;
  const playback = backgroundMusic.play();
  if (playback?.catch) playback.catch(() => { });
}

function syncBackgroundMusic() {
  if (!backgroundMusic) return;
  if (audioEnabled && !document.hidden) startBackgroundMusic();
  else backgroundMusic.pause();
}

// Browsers only allow music after the first user gesture.
document.addEventListener('pointerdown', startBackgroundMusic, { once: true });
document.addEventListener('keydown', startBackgroundMusic, { once: true });
document.addEventListener('visibilitychange', syncBackgroundMusic);

// Giả lập danh sách người chơi VIP cho phòng đầy đủ, sang trọng như ảnh mẫu
const MOCK_VIPS = [
  { name: 'Quang Thuần', vip: 10, balance: 56200000, avatar: 'symbol-ga.png' },
  { name: 'Đức Thịnh', vip: 6, balance: 32800000, avatar: 'symbol-cua.png' },
  { name: 'Thảo Vy', vip: 4, balance: 17900000, avatar: 'symbol-ca.png' },
  { name: 'Tọc Thịnh', vip: 1, balance: 1000, avatar: 'symbol-tom.png' },
];

// Khởi tạo bộ âm thanh Web Audio API
function getAudioContext() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playSound(type) {
  if (!audioEnabled) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    if (type === 'chip') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1400, now);
      osc.frequency.exponentialRampToValueAtTime(750, now + 0.05);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.05);
    } else if (type === 'shake') {
      const bufferSize = ctx.sampleRate * 0.15;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1100;
      filter.Q.value = 3;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
      noise.connect(filter).connect(gain).connect(ctx.destination);
      noise.start(now);
    } else if (type === 'win') {
      [523.25, 659.25, 783.99, 1046.50].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, now + idx * 0.08);
        gain.gain.linearRampToValueAtTime(0.25, now + idx * 0.08 + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.32);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + idx * 0.08);
        osc.stop(now + idx * 0.08 + 0.35);
      });
    }
  } catch { /* Ignored if audio permission is not yet granted */ }
}

const bowl = createBowlReveal(ui, {
  onReveal: () => { if (room) applyState(room); },
  symbolName: id => symbols.get(id)?.name || id,
  createDie: id => {
    const die = element('div', 'die-slot');
    die.append(createDiceFace(id));
    return die;
  },
});

function readSession() {
  try {
    const value = JSON.parse(sessionStorage.getItem(sessionKey));
    return value && typeof value.token === 'string' && typeof value.roomCode === 'string' ? value : null;
  } catch { return null; }
}

function rememberSession(session) {
  if (!session?.token) return;
  savedSession = { token: session.token, roomCode: session.roomCode, name: ui['player-name'].value.trim() };
  try { sessionStorage.setItem(sessionKey, JSON.stringify(savedSession)); } catch { }
}

function forgetSession() {
  savedSession = null;
  try { sessionStorage.removeItem(sessionKey); } catch { }
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function createDiceFace(symbolId) {
  const face = element('span', 'die-face');
  face.dataset.symbol = symbolId;
  face.setAttribute('role', 'img');
  face.setAttribute('aria-label', symbols.get(symbolId)?.name || symbolId);
  return face;
}

function notice(message, isError = false) {
  const target = room ? ui['room-notice'] : ui['lobby-status'];
  if (!target) return;
  target.textContent = message;
  target.classList.toggle('error', isError);
  target.hidden = false;
  if (room) {
    clearTimeout(notice._timer);
    notice._timer = setTimeout(() => { target.hidden = true; }, 3800);
  }
}

function connectionStatus(label, state) {
  // Silent or log connection state
}

function canBet() {
  return Boolean(room && synced && socket.connected && !busy && !room.paused && room.phase === 'betting' && room.you.eligible &&
    (!room.deadline || Date.now() + serverOffset < room.deadline));
}

function totalBet() {
  return room ? Object.values(room.you.bets).reduce((sum, value) => sum + value, 0) : 0;
}

// Máy chủ mới gửi số dư khả dụng đã trừ cược. Với máy chủ cũ đang chạy,
// giao diện tự trừ tổng cược để người chơi vẫn thấy ví cập nhật ngay lập tức.
function availableBalance() {
  if (!room) return 0;
  const reservedByLegacyServer = config?.balanceMode === 'available' ? 0 : totalBet();
  return Math.max(0, room.you.balance - reservedByLegacyServer);
}

function renderControls() {
  const ready = Boolean(config && socket.connected && !busy && !acceptingMembership && !sessionReplaced);
  ui['create-room'].disabled = !ready;
  ui['join-room'].disabled = !ready;
  ui['player-name'].disabled = busy || acceptingMembership;
  ui['room-code-input'].disabled = busy || acceptingMembership;
  ui['symbol-controls'].disabled = !canBet();
  ui['reset-bet'].disabled = !canBet() || totalBet() === 0;
  for (const button of chipButtons) button.disabled = !canBet();

  if (!room) return;
  const isHost = room.hostId === room.you.id;
  const available = ready && synced;
  const betweenRounds = ['waiting', 'result'].includes(room.phase);
  if (ui['host-panel']) ui['host-panel'].hidden = !isHost;
  if (ui['admin-controls']) ui['admin-controls'].disabled = !available || !isHost;
  if (ui['apply-betting-duration']) ui['apply-betting-duration'].disabled = !available || !isHost;
  if (ui['pause-room']) ui['pause-room'].textContent = room.paused ? 'Tiếp tục' : 'Tạm dừng';
  if (ui['lock-room']) ui['lock-room'].textContent = room.locked ? 'Mở khóa phòng' : 'Khóa phòng';
  if (ui['cancel-round']) ui['cancel-round'].disabled = room.phase !== 'betting';
  if (ui['set-result']) ui['set-result'].disabled = room.phase !== 'betting';
  if (ui['random-result']) ui['random-result'].disabled = room.phase !== 'betting';
  if (ui['grant-coins']) ui['grant-coins'].disabled = room.phase === 'revealing';
  const target = room.players.find(player => player.id === ui['admin-player']?.value);
  if (ui['kick-player']) ui['kick-player'].disabled = room.phase === 'revealing' || !target || target.id === room.you.id;
  if (ui['transfer-host']) ui['transfer-host'].disabled = !target?.connected || target.id === room.you.id;
  if (ui['reset-room']) ui['reset-room'].hidden = !isHost;
  if (ui['open-round']) {
    ui['open-round'].hidden = room.phase === 'betting' || room.phase === 'revealing';
    ui['open-round'].disabled = !available || !isHost || !betweenRounds;
  }
  if (ui.shake) {
    ui.shake.hidden = betweenRounds;
    ui.shake.disabled = !available || !isHost || room.paused || room.phase !== 'betting';
  }
  const canReset = betweenRounds || (room.phase === 'betting' && Object.values(room.boardTotals).every(value => value === 0));
  if (ui['reset-room']) ui['reset-room'].disabled = !available || !isHost || !canReset;
  if (ui['leave-room']) ui['leave-room'].disabled = !available;
}

function renderSelectedChip() {
  for (const button of chipButtons) {
    const value = button.dataset.chip === 'all' ? 'all' : Number(button.dataset.chip);
    const selected = value === selectedChip;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
}

function chipAssetName(amount) {
  return CHIP_ASSET_NAMES[amount] || '1k';
}

function renderPlacedChips(container, amount) {
  if (!container) return;
  const configuredChips = bettingChipValues();
  const denominations = [...configuredChips]
    .filter(value => Number.isSafeInteger(value) && value > 0)
    .sort((left, right) => right - left);
  let remaining = amount;
  const visibleChips = [];

  for (const denomination of denominations) {
    const count = Math.floor(remaining / denomination);
    for (let index = 0; index < Math.min(count, 4 - visibleChips.length); index += 1) {
      visibleChips.push(denomination);
    }
    remaining -= count * denomination;
    if (visibleChips.length === 4) break;
  }

  if (amount > 0 && visibleChips.length === 0) visibleChips.push(denominations.at(-1) || 1000);
  container.replaceChildren(...visibleChips.map((denomination, index) => {
    const chip = element('img', 'placed-chip');
    chip.src = `/assets/arena/chip-${chipAssetName(denomination)}.png`;
    chip.alt = '';
    chip.ariaHidden = 'true';
    chip.draggable = false;
    chip.style.setProperty('--chip-index', index);
    return chip;
  }));
  container.hidden = visibleChips.length === 0;
}

// Bàn cược 6 linh vật đúng thứ tự của ảnh mẫu: NAI, BẦU, GÀ / CÁ, CUA, TÔM
function buildBoard() {
  ui['game-grid'].replaceChildren();
  ui['chip-controls'].replaceChildren();
  symbolViews.clear();
  chipButtons.length = 0;

  const boardOrder = ['nai', 'bau', 'ga', 'ca', 'cua', 'tom'];
  for (const symbolId of boardOrder) {
    const symbol = symbols.get(symbolId) || { id: symbolId, name: symbolId.toUpperCase() };
    const spot = element('button', 'bet-spot');
    spot.type = 'button';
    spot.dataset.symbol = symbol.id;
    spot.setAttribute('aria-label', `Đặt cược ${symbol.name}, tỷ lệ một ăn một`);

    spot.title = `${symbol.name} · 1 : 1`;

    // Chip cược được đặt trực tiếp lên linh thú đã có sẵn trong background.
    const placedChips = element('span', 'placed-chip-stack');
    placedChips.hidden = true;
    placedChips.setAttribute('aria-hidden', 'true');

    // Huy hiệu cược của bạn
    const myBet = element('span', 'my-bet-badge', '0');
    myBet.id = `bet-${symbol.id}`;

    // Tổng cược cả bàn
    const boardTotal = element('span', 'spot-board-total', 'Cả bàn: 0');

    spot.append(placedChips, myBet, boardTotal);
    spot.addEventListener('click', () => {
      playSound('chip');
      placeBet(symbol.id);
    });

    ui['game-grid'].append(spot);
    symbolViews.set(symbol.id, { button: spot, amount: myBet, total: boardTotal, chips: placedChips });
  }

  // 6 mức chip: 1K, 5K, 10K, 50K, 100K, 500K; ALL IN luôn đứng cuối.
  const chipList = bettingChipValues();
  chipList.forEach((amount) => {
    const chipBtn = element('button', 'chip-slot-btn');
    chipBtn.type = 'button';
    chipBtn.dataset.chip = String(amount);
    chipBtn.setAttribute('aria-label', `Chip ${formatCompactCoins(amount)} xu`);

    const img = element('img');
    img.src = `/assets/arena/chip-${chipAssetName(amount)}.png`;
    img.alt = formatCompactCoins(amount);
    img.draggable = false;

    chipBtn.append(img);
    chipBtn.addEventListener('click', () => {
      if (!canBet()) return;
      playSound('chip');
      selectedChip = amount;
      renderSelectedChip();
    });

    chipButtons.push(chipBtn);
    ui['chip-controls'].append(chipBtn);
  });

  if (ui['all-in']) {
    chipButtons.push(ui['all-in']);
    ui['chip-controls'].append(ui['all-in']);
  }

  selectedChip = chipList[0] || 1000;

  for (let index = 1; index <= 3; index++) {
    if (ui[`demo-dice-${index}`]) {
      ui[`demo-dice-${index}`].replaceChildren(...config.symbols.map(symbol => {
        const option = element('option', '', symbol.name);
        option.value = symbol.id;
        return option;
      }));
    }
  }
  renderSelectedChip();
}

function phaseMessage() {
  if (room.paused) return 'Phòng đang tạm dừng.';
  if (room.phase === 'waiting') return 'Phòng đã sẵn sàng. Chờ mở cược.';
  if (room.phase === 'revealing') return 'Đang lắc xúc xắc… cược đã khóa.';
  if (room.phase === 'result') return bowl.covered() ? 'Mở bát để xem kết quả!' : 'Đã có kết quả!';
  return 'Thời gian đặt cược. Chọn chip rồi chạm linh vật!';
}

function applyState(next) {
  if (!next?.you || !config) return;
  if (room && room.code === next.code && room.you.id === next.you.id && next.revision < room.revision) return;
  const previous = room;
  room = next;
  document.body.classList.add('in-room');
  bowl.update(next);
  const covered = bowl.covered();
  serverOffset = next.serverNow - Date.now();

  ui.home.hidden = true;
  ui.game.hidden = false;
  ui['room-code'].textContent = room.code;

  const you = room.players.find(player => player.id === room.you.id);
  ui['player-display-name'].textContent = you?.name || 'Ngọc Anh';
  ui['round-number'].textContent = `PHIÊN #${room.roundNumber || 158326}`;

  const phaseNames = {
    waiting: 'CHỜ MỞ CƯỢC',
    betting: 'ĐANG ĐẶT CƯỢC',
    revealing: 'ĐANG LẮC BẦU...',
    result: covered ? 'CHỜ MỞ BÁT' : 'ĐÃ CÓ KẾT QUẢ'
  };
  if (ui['round-phase-label']) ui['round-phase-label'].textContent = phaseNames[room.phase] || 'ĐANG LẮC BẦU...';

  const spendableBalance = availableBalance();
  ui['balance'].textContent = covered ? '•••' : number(spendableBalance);
  if (ui['available-balance']) ui['available-balance'].textContent = number(spendableBalance);
  ui['total-bet'].textContent = number(totalBet());

  // Cập nhật trạng thái từng ô cược
  for (const [id, view] of symbolViews) {
    const myAmount = room.you.bets[id] || 0;
    const boardAmt = room.boardTotals[id] || 0;
    view.amount.textContent = myAmount > 0 ? formatCompactCoins(myAmount) : '0';
    view.total.textContent = `Cả bàn: ${formatCompactCoins(boardAmt)}`;
    view.total.hidden = boardAmt <= 0;
    renderPlacedChips(view.chips, myAmount);
    view.button.classList.toggle('has-bet', myAmount > 0);
    const isWin = !covered && room.phase === 'result' && room.dice.includes(id);
    view.button.classList.toggle('is-winner', isWin);
  }

  // Hiệu ứng lắc được trình bày trong lớp mở bát toàn màn hình.
  const isShaking = room.phase === 'revealing';
  if (isShaking && previous?.phase !== 'revealing') playSound('shake');

  if (room.phase === 'result' && !covered && !previous?.resultHandled) {
    playSound('win');
  }

  renderAdmin();
  renderCountdown();
  renderPlayers();
  renderResults();
  renderHistory();
  renderControls();
}

function renderCountdown() {
  if (!room) return;
  const remaining = room.paused ? room.remainingMs : room.deadline ? room.deadline - (Date.now() + serverOffset) : null;
  bowl.tick(remaining);

  const bettingMs = room.bettingMs || 30000;
  const progress = room.phase === 'betting' ? Math.max(0, Math.min(100, ((remaining ?? bettingMs) / bettingMs) * 100)) : 0;
  ui['clock-progress'].style.width = `${progress}%`;

  const seconds = remaining === null ? 0 : Math.max(0, Math.ceil(remaining / 1000));
  const minStr = String(Math.floor(seconds / 60)).padStart(2, '0');
  const secStr = String(seconds % 60).padStart(2, '0');
  ui['round-countdown'].textContent = !synced || !socket.connected ? '00:00' : `${minStr}:${secStr}`;
  renderControls();
}
setInterval(renderCountdown, 250);

function renderAdmin() {
  if (room.hostId !== room.you.id || !ui['admin-player']) return;
  if (ui['betting-duration']) ui['betting-duration'].value = String((room.bettingMs || 30000) / 1000);
  const select = ui['admin-player'];
  const previous = select.value;
  const identity = room.players.map(player => `${player.id}:${player.name}`).join('|');
  if (select.dataset.roster !== identity) {
    select.replaceChildren(...room.players.map(player => {
      const option = element('option', '', `${player.name}${player.id === room.you.id ? ' (bạn)' : ''}`);
      option.value = player.id;
      return option;
    }));
    select.dataset.roster = identity;
    if (room.players.some(player => player.id === previous)) select.value = previous;
  }
}

// Cột trái: Người chơi & Bảng VIP Leaderboard
function renderPlayers() {
  if (!ui['player-list']) return;
  const totalCount = room.players.length;
  ui['online-count'].textContent = String(Math.max(totalCount, 123));

  // Kết hợp người chơi thật và danh sách VIP mô phỏng đẹp mắt
  const realPlayers = room.players.map((p, idx) => ({
    name: p.name,
    vip: Math.max(1, 8 - idx),
    balance: config?.balanceMode === 'available' ? p.balance : Math.max(0, p.balance - (p.betTotal || 0)),
    avatar: `/assets/arena/symbol-${['ca', 'cua', 'ga', 'nai', 'tom', 'bau'][idx % 6]}.png`,
    isMe: p.id === room.you.id,
    connected: p.connected,
  }));

  // Nếu ít người chơi, thêm VIP mẫu để bàn luôn nhộn nhịp như casino thật
  const displayList = [...realPlayers];
  if (displayList.length < 7) {
    for (const mock of MOCK_VIPS) {
      if (!displayList.some(p => p.name === mock.name)) {
        displayList.push({
          name: mock.name,
          vip: mock.vip,
          balance: mock.balance,
          avatar: `/assets/arena/${mock.avatar}`,
          isMe: false,
          connected: true,
        });
      }
      if (displayList.length >= 7) break;
    }
  }

  ui['player-list'].replaceChildren(...displayList.map(player => {
    const row = element('div', `vip-player-row${player.isMe ? ' is-me' : ''}`);

    const avatarWrap = element('div', 'vip-player-avatar-wrap');
    avatarWrap.append(element('div', 'vip-crown-mini', '👑'));
    const img = element('img', 'vip-player-avatar');
    img.src = player.avatar;
    img.alt = player.name;
    avatarWrap.append(img);

    const meta = element('div', 'vip-player-meta');
    const levelTag = element('span', 'vip-level-tag', `VIP ${player.vip}`);
    const nameSpan = element('span', 'vip-player-name', player.name + (player.isMe ? ' (bạn)' : ''));
    meta.append(levelTag, nameSpan);

    const coinSpan = element('span', 'vip-player-coin', formatCompactCoins(player.balance));

    row.append(avatarWrap, meta, coinSpan);
    return row;
  }));
}

function renderResults() {
  if (bowl.covered()) return;
  const stats = room.you.stats;
  if (ui['stat-games']) ui['stat-games'].textContent = number(stats.gamesPlayed);
  if (ui['stat-record']) ui['stat-record'].textContent = `${stats.wins} / ${stats.losses}`;
  if (ui['stat-win-rate']) ui['stat-win-rate'].textContent = `${stats.gamesPlayed ? Math.round(stats.wins / stats.gamesPlayed * 100) : 0}%`;
  if (ui['stat-total-returned']) ui['stat-total-returned'].textContent = number(stats.totalReturned);
}

// Cột phải: Lịch sử phiên (Grid 4 cột x 5 hàng = 20 kết quả viên tròn)
function renderHistory() {
  const historyGrid = ui['history-grid'];
  if (!historyGrid) return;

  const validRounds = room.history.filter(round => !bowl.covered() || round.id !== room.roundId);
  const allDiceResults = [];
  for (const r of validRounds) {
    if (Array.isArray(r.dice)) {
      for (const d of r.dice) allDiceResults.push(d);
    }
  }

  // Lấy 20 kết quả xúc xắc gần nhất
  const recent20 = allDiceResults.slice(-20);
  const totalSlots = 20;
  const items = [];

  for (let i = 0; i < totalSlots; i++) {
    const symbolId = recent20[i];
    const token = element('div', `history-token${symbolId ? '' : ' empty'}`);
    if (symbolId) {
      const img = element('img');
      img.src = `/assets/arena/symbol-${symbolId}.png`;
      img.alt = symbols.get(symbolId)?.name || symbolId;
      token.append(img);
    }
    items.push(token);
  }

  historyGrid.replaceChildren(...items);
}

function send(event, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!socket.connected || sessionReplaced) {
      reject(new Error('Mất kết nối máy chủ.'));
      return;
    }
    socket.volatile.timeout(8000).emit(event, payload, (timeout, reply) => {
      if (timeout) {
        reject(new Error('Chưa nhận được phản hồi.'));
      } else if (!reply?.ok) {
        reject(new Error(reply?.error?.message || 'Lỗi thao tác.'));
      } else resolve(reply);
    });
  });
}

function requestId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function syncRoom(epoch = connectionEpoch) {
  synced = false;
  renderControls();
  const reply = await send('room:sync');
  if (epoch !== connectionEpoch) return;
  rememberSession(reply.session);
  applyState(reply.state);
  synced = true;
  renderControls();
}

async function mutate(event, payload, successMessage) {
  if (!room || busy || !synced || !socket.connected) return;
  const epoch = connectionEpoch;
  busy = true;
  renderControls();
  try {
    const reply = await send(event, { ...payload, requestId: requestId() });
    if (epoch !== connectionEpoch) return;
    applyState(reply.state);
    notice(successMessage || phaseMessage());
  } catch (error) {
    if (epoch !== connectionEpoch) return;
    notice(error.message, true);
  } finally {
    if (epoch === connectionEpoch) {
      busy = false;
      renderControls();
    }
  }
}

function placeBet(symbol) {
  if (!canBet()) return;
  const spendableBalance = availableBalance();
  if (selectedChip === 'all') {
    if (spendableBalance <= 0) {
      notice(`Bạn không còn xu khả dụng để cược ALL IN.`, true);
      return;
    }
    mutate('bet:add', { roundId: room.roundId, symbol, allIn: true });
    return;
  }
  if (selectedChip > spendableBalance) {
    notice(`Số xu còn lại không đủ để đặt mức này.`, true);
    return;
  }
  mutate('bet:add', { roundId: room.roundId, symbol, amount: selectedChip });
}

function clearRoom(message) {
  bowl.reset();
  document.body.classList.remove('in-room');
  room = null;
  synced = false;
  busy = false;
  acceptingMembership = false;
  forgetSession();
  ui.game.hidden = true;
  ui.home.hidden = false;
  renderControls();
  notice(message);
}

async function enterRoom(event) {
  if (!config || busy || acceptingMembership || !socket.connected || sessionReplaced) return;
  const name = ui['player-name'].value.trim();
  ui['player-name'].value = name;
  if (!ui['player-name'].reportValidity()) return;
  const code = ui['room-code-input'].value.trim().toUpperCase();
  if (event === 'room:join' && !/^[A-Z0-9]{6}$/.test(code)) {
    notice('Nhập mã phòng 6 ký tự.', true);
    ui['room-code-input'].focus();
    return;
  }
  busy = true;
  acceptingMembership = true;
  renderControls();
  notice(event === 'room:create' ? 'Đang tạo phòng mới…' : 'Đang vào phòng…');
  const epoch = connectionEpoch;
  try {
    const reply = await send(event, event === 'room:create' ? { name } : { name, code });
    if (epoch !== connectionEpoch) return;
    rememberSession(reply.session);
    synced = true;
    applyState(reply.state);
  } catch (error) {
    if (epoch !== connectionEpoch) return;
    notice(error.message, true);
  } finally {
    if (epoch === connectionEpoch) { busy = false; acceptingMembership = false; renderControls(); }
  }
}

async function resumeRoom(epoch) {
  acceptingMembership = true;
  synced = false;
  renderControls();
  notice('Đang khôi phục phòng…');
  try {
    const reply = await send('room:resume', { token: savedSession.token });
    if (epoch !== connectionEpoch) return;
    rememberSession(reply.session);
    synced = true;
    applyState(reply.state);
  } catch {
    if (epoch !== connectionEpoch) return;
    clearRoom('Phiên chơi đã hết hạn. Hãy tạo hoặc vào phòng mới.');
  } finally {
    if (epoch === connectionEpoch) { acceptingMembership = false; renderControls(); }
  }
}

socket.on('connect', async () => {
  const epoch = ++connectionEpoch;
  busy = false;
  connectionStatus('Đã kết nối', 'connected');
  if (savedSession) await resumeRoom(epoch);
  else {
    synced = false;
    renderControls();
    notice('Sẵn sàng. Tạo phòng mới hoặc nhập mã.');
  }
});

socket.on('connect_error', () => {
  busy = false;
  acceptingMembership = false;
  renderControls();
  notice('Không thể kết nối máy chủ. Nếu đang dùng điện thoại, hãy mở bằng địa chỉ mạng nội bộ và khởi động lại server.', true);
});

socket.on('disconnect', () => {
  connectionEpoch += 1;
  synced = false;
  busy = false;
  acceptingMembership = false;
  connectionStatus('Mất kết nối', 'disconnected');
  renderControls();
});

socket.on('room:state', state => {
  if (sessionReplaced || (!room && !acceptingMembership)) return;
  if (room && state.code !== room.code) return;
  applyState(state);
});

socket.on('room:kicked', () => {
  connectionEpoch += 1;
  clearRoom('Bạn đã được đưa ra khỏi bàn chơi.');
});

function adminCommand(event, payload = {}, message) {
  if (!room || room.hostId !== room.you.id) return;
  return mutate(event, { ...payload, gameId: room.gameId, roundNumber: room.roundNumber }, message);
}

// Gán các sự kiện tương tác giao diện
ui['lobby-form'].addEventListener('submit', event => { event.preventDefault(); enterRoom('room:create'); });
ui['join-room'].addEventListener('click', () => enterRoom('room:join'));
ui['room-code-input'].addEventListener('input', () => { ui['room-code-input'].value = ui['room-code-input'].value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
ui['room-code-input'].addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); enterRoom('room:join'); } });

// Xóa cược & Đặt cược
ui['reset-bet'].addEventListener('click', () => {
  if (canBet()) {
    playSound('chip');
    mutate('bet:clear', { roundId: room.roundId }, 'Đã xóa cược của bạn.');
  }
});

if (ui['confirm-bet-btn']) {
  ui['confirm-bet-btn'].addEventListener('click', () => {
    playSound('win');
    notice('Cược của bạn đã được ghi nhận trên máy chủ!');
  });
}

if (ui['all-in']) {
  ui['all-in'].addEventListener('click', () => {
    if (!canBet()) return;
    selectedChip = 'all';
    playSound('chip');
    renderSelectedChip();
  });
}

// Điều hướng Carousel Chip
if (ui['chip-prev']) {
  ui['chip-prev'].addEventListener('click', () => {
    const chipList = [...bettingChipValues(), 'all'];
    const currIdx = chipList.indexOf(selectedChip);
    const newIdx = currIdx > 0 ? currIdx - 1 : chipList.length - 1;
    selectedChip = chipList[newIdx];
    playSound('chip');
    renderSelectedChip();
  });
}

if (ui['chip-next']) {
  ui['chip-next'].addEventListener('click', () => {
    const chipList = [...bettingChipValues(), 'all'];
    const currIdx = chipList.indexOf(selectedChip);
    const newIdx = currIdx < chipList.length - 1 ? currIdx + 1 : 0;
    selectedChip = chipList[newIdx];
    playSound('chip');
    renderSelectedChip();
  });
}

// Cấp xu nhanh
if (ui['quick-add-coin']) {
  ui['quick-add-coin'].addEventListener('click', () => {
    if (room) {
      adminCommand('host:grant', { playerId: room.you.id, amount: 500000 }, 'Đã cộng thêm 500.000 xu may mắn!');
    }
  });
}

// Toàn màn hình & xoay ngang, gồm fallback cho Safari/Chrome/Firefox trên iPhone.
const fullscreenButtons = [ui['request-fullscreen'], ui['fullscreen-toggle']].filter(Boolean);
const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandaloneDisplay = () => window.matchMedia('(display-mode: standalone)').matches ||
  window.matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
const currentFullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement ||
  document.webkitCurrentFullScreenElement;
if (isIOSDevice && !isStandaloneDisplay()) {
  // 1. Ẩn nút "Toàn Màn Hình" vì Safari iOS không cho phép API này
  if (ui['request-fullscreen']) {
    ui['request-fullscreen'].style.display = 'none';
  }
  // 2. Đổi câu thông báo để hướng dẫn người dùng iPhone xoay tay
  const promptText = document.querySelector('.rotate-card p');
  if (promptText) {
    promptText.innerHTML = 'Hệ điều hành iOS không hỗ trợ xoay tự động.<br>Vui lòng tắt <b>Khóa Hướng Dọc</b> và xoay ngang điện thoại bằng tay.';
  }
}

function syncFullscreenControls() {
  if (isStandaloneDisplay()) document.body.classList.add('fullscreen-fit');
  const active = Boolean(currentFullscreenElement() || isStandaloneDisplay() ||
    document.body.classList.contains('fullscreen-fit'));
  for (const button of fullscreenButtons) button.setAttribute('aria-pressed', String(active));
}

function syncAppViewport() {
  const viewport = window.visualViewport;
  const width = Math.round(viewport?.width || document.documentElement.clientWidth || window.innerWidth);
  const height = Math.round(viewport?.height || document.documentElement.clientHeight || window.innerHeight);
  document.documentElement.style.setProperty('--app-viewport-width', `${width}px`);
  document.documentElement.style.setProperty('--app-viewport-height', `${height}px`);
}

async function exitGameFullscreen() {
  document.body.classList.remove('force-landscape', 'fullscreen-fit');
  delete document.body.dataset.nativeFullscreen;
  try { screen.orientation?.unlock?.(); } catch { /* Safari có thể không hỗ trợ unlock. */ }
  const exit = document.exitFullscreen || document.webkitExitFullscreen || document.webkitCancelFullScreen;
  if (currentFullscreenElement() && exit) {
    try { await exit.call(document); } catch { /* Giữ giao diện hiện tại nếu Safari từ chối. */ }
  }
  syncFullscreenControls();
}

async function enterGameFullscreen() {
  document.body.classList.add('fullscreen-fit');
  let nativeFullscreen = Boolean(currentFullscreenElement() || isStandaloneDisplay());
  const root = document.documentElement;
  const request = root.requestFullscreen || root.webkitRequestFullscreen || root.webkitRequestFullScreen;

  if (!nativeFullscreen && request) {
    try {
      const result = root.requestFullscreen
        ? request.call(root, { navigationUI: 'hide' })
        : request.call(root);
      if (result?.then) await result;
      nativeFullscreen = true;
      document.body.dataset.nativeFullscreen = 'true';
    } catch {
      nativeFullscreen = false;
    }
  }

  let orientationLocked = false;
  if (screen.orientation?.lock && (nativeFullscreen || isStandaloneDisplay())) {
    try {
      await screen.orientation.lock('landscape');
      orientationLocked = true;
    } catch { /* iPhone Safari thường không cho khóa hướng. */ }
  }

  if (!orientationLocked && window.matchMedia('(orientation: portrait)').matches) {
    document.body.classList.add('force-landscape');
  }

  if (!nativeFullscreen && isIOSDevice) {
    notice('Đã bật chế độ ngang tương thích. Muốn ẩn hoàn toàn thanh Safari: Chia sẻ → Thêm vào Màn hình chính.');
  } else {
    notice('Đã bật toàn màn hình và chế độ ngang.');
  }
  syncAppViewport();
  syncFullscreenControls();
}

async function toggleGameFullscreen() {
  const fallbackActive = document.body.classList.contains('fullscreen-fit');
  if (currentFullscreenElement() || fallbackActive) await exitGameFullscreen();
  else await enterGameFullscreen();
}

for (const button of fullscreenButtons) button.addEventListener('click', toggleGameFullscreen);

function handleFullscreenChange() {
  if (!currentFullscreenElement() && !isStandaloneDisplay() && document.body.dataset.nativeFullscreen === 'true') {
    document.body.classList.remove('force-landscape', 'fullscreen-fit');
    delete document.body.dataset.nativeFullscreen;
  }
  syncAppViewport();
  syncFullscreenControls();
}

for (const eventName of ['fullscreenchange', 'webkitfullscreenchange']) {
  document.addEventListener(eventName, handleFullscreenChange);
}

function handleViewportOrientationChange() {
  if (window.matchMedia('(orientation: landscape)').matches) document.body.classList.remove('force-landscape');
  setTimeout(() => {
    syncAppViewport();
    syncFullscreenControls();
  }, 150);
}

window.addEventListener('orientationchange', handleViewportOrientationChange);
window.addEventListener('resize', handleViewportOrientationChange, { passive: true });
window.visualViewport?.addEventListener('resize', handleViewportOrientationChange, { passive: true });

syncAppViewport();
syncFullscreenControls();

// Quản lý Âm thanh
if (ui['sound-toggle']) {
  ui['sound-toggle'].addEventListener('click', () => {
    audioEnabled = !audioEnabled;
    if (audioEnabled) getAudioContext();
    syncBackgroundMusic();
    ui['sound-icon'].src = audioEnabled ? '/assets/arena/icon-sound.png' : '/assets/arena/icon-mute.png';
    ui['sound-toggle'].setAttribute('aria-pressed', String(audioEnabled));
    notice(audioEnabled ? 'Đã bật âm thanh' : 'Đã tắt âm thanh');
  });
}

// Quản lý Modal
if (ui['rules-toggle'] && ui['rules-dialog']) {
  ui['rules-toggle'].addEventListener('click', () => ui['rules-dialog'].showModal());
}
if (ui['close-rules'] && ui['rules-dialog']) {
  ui['close-rules'].addEventListener('click', () => ui['rules-dialog'].close());
}

if (ui['stats-toggle-btn'] && ui['stats-dialog']) {
  ui['stats-toggle-btn'].addEventListener('click', () => {
    // Render tỷ lệ các linh vật trong modal thống kê
    const statsContainer = ui['stats-symbols-bars'];
    if (statsContainer) {
      statsContainer.replaceChildren(...['nai', 'bau', 'ga', 'ca', 'cua', 'tom'].map(id => {
        const item = element('div', 'stat-item');
        const img = element('img');
        img.src = `/assets/arena/symbol-${id}.png`;
        img.alt = symbols.get(id)?.name || id;
        const val = element('div', 'stat-val', `${Math.floor(15 + Math.random() * 5)}%`);
        item.append(img, val);
        return item;
      }));
    }
    ui['stats-dialog'].showModal();
  });
}
if (ui['close-stats'] && ui['stats-dialog']) {
  ui['close-stats'].addEventListener('click', () => ui['stats-dialog'].close());
}

if (ui['settings-toggle'] && ui['settings-dialog']) {
  ui['settings-toggle'].addEventListener('click', () => {
    if (room && ui['invite-link']) {
      const link = new URL(location.href);
      link.searchParams.set('room', room.code);
      ui['invite-link'].value = link.href;
    }
    ui['settings-dialog'].showModal();
  });
}
if (ui['close-settings'] && ui['settings-dialog']) {
  ui['close-settings'].addEventListener('click', () => ui['settings-dialog'].close());
}

if (ui['copy-link']) {
  ui['copy-link'].addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(ui['invite-link'].value);
      ui['copy-status'].textContent = 'Đã sao chép liên kết phòng!';
    } catch {
      ui['copy-status'].textContent = 'Hãy nhấn giữ để sao chép link.';
    }
  });
}

// Quản trị phòng
if (ui['open-round']) ui['open-round'].addEventListener('click', () => { if (room) mutate('round:open', { gameId: room.gameId, roundNumber: room.roundNumber }); });
if (ui.shake) ui.shake.addEventListener('click', () => { if (room) mutate('round:shake', { roundId: room.roundId }); });
if (ui['pause-room']) ui['pause-room'].addEventListener('click', () => adminCommand('host:pause', { paused: !room.paused }));
if (ui['lock-room']) ui['lock-room'].addEventListener('click', () => adminCommand('host:lock', { locked: !room.locked }));
if (ui['cancel-round']) ui['cancel-round'].addEventListener('click', () => adminCommand('host:cancel', {}));
if (ui['apply-betting-duration']) ui['apply-betting-duration'].addEventListener('click', () => {
  const durationSeconds = Number(ui['betting-duration'].value);
  adminCommand('host:betting-duration', { durationSeconds }, `Đã đặt thời gian cược ${durationSeconds} giây từ ván kế tiếp.`);
});
if (ui['grant-coins']) ui['grant-coins'].addEventListener('click', () => {
  const input = ui['grant-amount'];
  adminCommand('host:grant', { playerId: ui['admin-player'].value, amount: input.valueAsNumber || 50000 });
});
if (ui['kick-player']) ui['kick-player'].addEventListener('click', () => adminCommand('host:kick', { playerId: ui['admin-player'].value }));
if (ui['transfer-host']) ui['transfer-host'].addEventListener('click', () => adminCommand('host:transfer', { playerId: ui['admin-player'].value }));
if (ui['set-result']) ui['set-result'].addEventListener('click', () => adminCommand('host:result', { dice: [1, 2, 3].map(i => ui[`demo-dice-${i}`].value) }));
if (ui['random-result']) ui['random-result'].addEventListener('click', () => adminCommand('host:result', { dice: null }));

if (ui['reset-room']) ui['reset-room'].addEventListener('click', () => ui['reset-dialog'].showModal());
if (ui['cancel-reset']) ui['cancel-reset'].addEventListener('click', () => ui['reset-dialog'].close());
if (ui['confirm-reset']) ui['confirm-reset'].addEventListener('click', () => {
  ui['reset-dialog'].close();
  if (room) mutate('room:reset', { gameId: room.gameId, roundNumber: room.roundNumber });
});

if (ui['leave-room']) {
  ui['leave-room'].addEventListener('click', async () => {
    if (!room || busy || !synced) return;
    try {
      await send('room:leave');
      clearRoom('Đã rời khỏi phòng.');
      if (ui['settings-dialog']) ui['settings-dialog'].close();
    } catch (e) {
      notice(e.message, true);
    }
  });
}

// Khởi động
async function initialize() {
  if (loadingConfig) return;
  loadingConfig = true;
  try {
    const res = await fetch('/api/config');
    config = await res.json();
    symbols = new Map(config.symbols.map(s => [s.id, s]));
    buildBoard();
    socket.connect();
  } catch (err) {
    notice('Chưa tải được cấu hình phòng.', true);
  } finally {
    loadingConfig = false;
  }
}

const invitation = new URLSearchParams(location.search).get('room')?.toUpperCase();
if (invitation && /^[A-Z0-9]{6}$/.test(invitation)) ui['room-code-input'].value = invitation;
if (savedSession?.name) ui['player-name'].value = savedSession.name;
initialize();
