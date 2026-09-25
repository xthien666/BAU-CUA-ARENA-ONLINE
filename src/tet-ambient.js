// ===================================================================
// TET AMBIENT SYSTEM: HOA ĐÀO/MAI RƠI, PHÁO HOA BẦU TRỜI & BỤI SÁNG
// ===================================================================

export function initTetAmbient(options = {}) {
  const container = document.getElementById('tet-ambient-layer');
  const canvas = document.getElementById('tet-ambient-canvas');
  if (!container || !canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let width = 0;
  let height = 0;
  let dpr = 1;
  let running = true;
  let lastTime = performance.now();
  let animationFrameId = null;

  // Kiểm tra prefers-reduced-motion
  const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = mediaQuery.matches;
  mediaQuery.addEventListener('change', e => {
    reducedMotion = e.matches;
    if (reducedMotion) {
      ctx.clearRect(0, 0, width, height);
    }
  });

  // Tự động tạm dừng khi ẩn tab để tiết kiệm CPU/GPU
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      running = false;
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    } else {
      running = true;
      lastTime = performance.now();
      loop();
    }
  });

  function resize() {
    const stage = document.getElementById('arcade-stage') || container;
    const rect = stage.getBoundingClientRect();
    width = Math.max(320, Math.round(rect.width));
    height = Math.max(180, Math.round(rect.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Khởi tạo kích thước theo stage
  resize();
  window.addEventListener('resize', resize, { passive: true });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize, { passive: true });
  const resizeObserver = new ResizeObserver(resize);
  const stageEl = document.getElementById('arcade-stage') || container;
  resizeObserver.observe(stageEl);

  // -------------------------------------------------------------
  // 1. HOA ĐÀO (HỒNG) VÀ HOA MAI (VÀNG) RƠI CHUYỂN ĐỘNG 3D TỰ NHIÊN
  // -------------------------------------------------------------
  const BLOSSOM_COUNT = 28;
  const blossoms = [];

  const BLOSSOM_PALETTES = [
    // Hoa đào (hồng phấn, hồng thắm)
    { type: 'dao', color: '#ff758f', inner: '#ff4d6d', highlight: '#ffb3c1', isFlower: true },
    { type: 'dao-petal', color: '#ff85a1', inner: '#ff758f', highlight: '#ffccd5', isFlower: false },
    { type: 'dao-petal-deep', color: '#e63946', inner: '#c1121f', highlight: '#ff758f', isFlower: false },
    // Hoa mai (vàng rực rỡ, cam vàng Tết)
    { type: 'mai', color: '#ffb703', inner: '#fb8500', highlight: '#ffe494', isFlower: true },
    { type: 'mai-petal', color: '#ffd166', inner: '#ffb703', highlight: '#fff0be', isFlower: false },
  ];

  function createBlossom(initialY = null) {
    const palette = BLOSSOM_PALETTES[Math.floor(Math.random() * BLOSSOM_PALETTES.length)];
    const size = palette.isFlower ? 10 + Math.random() * 8 : 7 + Math.random() * 6;
    return {
      palette,
      size,
      x: Math.random() * (width + 60) - 30,
      y: initialY !== null ? initialY : Math.random() * (height + 40) - 20,
      vx: (Math.random() - 0.3) * 0.7, // xu hướng gió nhẹ sang phải
      vy: 0.6 + Math.random() * 0.9,
      angle: Math.random() * Math.PI * 2,
      angularSpeed: (Math.random() - 0.5) * 0.04,
      flip: Math.random() * Math.PI * 2,
      flipSpeed: 0.02 + Math.random() * 0.03,
      swayOffset: Math.random() * Math.PI * 2,
      swaySpeed: 0.015 + Math.random() * 0.02,
      swayAmplitude: 0.6 + Math.random() * 0.8,
      opacity: 0.75 + Math.random() * 0.25,
    };
  }

  for (let i = 0; i < BLOSSOM_COUNT; i++) {
    blossoms.push(createBlossom(Math.random() * height));
  }

  function drawPetal(ctx, size, color, highlight) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-size * 0.6, -size * 0.4, -size * 0.5, -size * 1.1, 0, -size * 1.25);
    ctx.bezierCurveTo(size * 0.5, -size * 1.1, size * 0.6, -size * 0.4, 0, 0);
    ctx.fillStyle = color;
    ctx.fill();

    // Vệt sáng highlight trên cánh
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.2);
    ctx.quadraticCurveTo(-size * 0.15, -size * 0.7, 0, -size * 1.1);
    ctx.strokeStyle = highlight;
    ctx.lineWidth = size * 0.08;
    ctx.stroke();
  }

  function drawFlower(ctx, size, palette) {
    const petals = 5;
    for (let p = 0; p < petals; p++) {
      ctx.save();
      ctx.rotate((p * Math.PI * 2) / petals);
      drawPetal(ctx, size, palette.color, palette.highlight);
      ctx.restore();
    }
    // Nhuỵ hoa nhấp nháy vàng cam
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.26, 0, Math.PI * 2);
    ctx.fillStyle = palette.type.startsWith('mai') ? '#c1121f' : '#ffb703';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.12, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }

  // -------------------------------------------------------------
  // 2. PHÁO HOA BẦU TRỜI (SKY FIREWORKS KHÔNG CHE BÀN CƯỢC)
  // -------------------------------------------------------------
  const fireworks = [];
  const sparks = [];
  let nextFireworkTime = performance.now() + 600;

  const FIREWORK_COLORS = [
    ['#ff0055', '#ff5500', '#ffd700'], // Đỏ vàng Tết
    ['#ffd700', '#ffea00', '#ffffff'], // Hoàng Kim
    ['#00f0ff', '#7000ff', '#ff00ea'], // Lam - Tím rực rỡ
    ['#ff3366', '#ff9933', '#ffff66'], // Hồng cam tươi
    ['#33ff88', '#00e5ff', '#ffd700'], // Ngọc bích - Vàng
  ];

  function launchFirework() {
    // Khu vực bầu trời: đỉnh 5% - 32% chiều cao, tập trung ở 2 bên hoặc khu vực thoáng trên cùng
    const targetY = height * (0.07 + Math.random() * 0.25);
    // Ưu tiên hai bên góc trời (0-35% hoặc 65-100% chiều rộng) để trung tâm logo & bàn luôn thanh thoát
    const side = Math.random();
    let targetX;
    if (side < 0.42) {
      targetX = width * (0.05 + Math.random() * 0.32);
    } else if (side > 0.58) {
      targetX = width * (0.63 + Math.random() * 0.32);
    } else {
      targetX = width * (0.37 + Math.random() * 0.26);
    }

    const startX = targetX + (Math.random() - 0.5) * 60;
    const startY = height * 0.95;
    const colorScheme = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];

    fireworks.push({
      x: startX,
      y: startY,
      targetY,
      vx: (targetX - startX) / 38,
      vy: -Math.sqrt(2 * 0.18 * (startY - targetY)), // Vận tốc ném đứng đạt đỉnh tại targetY
      color: colorScheme[0],
      colors: colorScheme,
      trail: [],
    });
  }

  function explodeFirework(fw) {
    const sparkCount = 34 + Math.floor(Math.random() * 14);
    const baseColor = fw.colors;

    // Hiệu ứng chớp sáng nền trời (sky ambient flash)
    ambientFlashes.push({
      x: fw.x,
      y: fw.y,
      radius: Math.min(width, height) * 0.35,
      color: fw.colors[0],
      alpha: 0.16,
    });

    for (let i = 0; i < sparkCount; i++) {
      const angle = (i * Math.PI * 2) / sparkCount + (Math.random() - 0.5) * 0.3;
      const speed = 1.4 + Math.random() * 2.8;
      const col = baseColor[Math.floor(Math.random() * baseColor.length)];
      sparks.push({
        x: fw.x,
        y: fw.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        alpha: 1,
        decay: 0.012 + Math.random() * 0.016,
        color: col,
        size: 1.5 + Math.random() * 1.5,
        twinkle: Math.random() > 0.5,
      });
    }
  }

  const ambientFlashes = [];

  // -------------------------------------------------------------
  // 3. BỤI SÁNG VÀNG LẤP LÁNH (GOLDEN SPARKLES / EMBERS)
  // -------------------------------------------------------------
  const SPARKLE_COUNT = 18;
  const goldenSparkles = [];

  function createSparkle() {
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.25,
      vy: -0.15 - Math.random() * 0.3, // lơ lửng bay lên nhẹ
      size: 1 + Math.random() * 2.2,
      baseAlpha: 0.3 + Math.random() * 0.5,
      phase: Math.random() * Math.PI * 2,
      pulseSpeed: 0.025 + Math.random() * 0.035,
      glowRadius: 4 + Math.random() * 7,
    };
  }

  for (let i = 0; i < SPARKLE_COUNT; i++) {
    goldenSparkles.push(createSparkle());
  }

  // -------------------------------------------------------------
  // VÒNG LẶP CHÍNH (RENDER LOOP 60FPS)
  // -------------------------------------------------------------
  function loop() {
    if (!running) return;
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    if (reducedMotion) {
      animationFrameId = requestAnimationFrame(loop);
      return;
    }

    ctx.clearRect(0, 0, width, height);

    // 1. Ánh chớp sáng nền trời từ pháo hoa
    for (let i = ambientFlashes.length - 1; i >= 0; i--) {
      const flash = ambientFlashes[i];
      flash.alpha -= dt * 0.45;
      if (flash.alpha <= 0) {
        ambientFlashes.splice(i, 1);
        continue;
      }
      ctx.save();
      const grad = ctx.createRadialGradient(flash.x, flash.y, 0, flash.x, flash.y, flash.radius);
      grad.addColorStop(0, flash.color);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.globalAlpha = flash.alpha;
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(flash.x, flash.y, flash.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 2. Pháo hoa bay lên
    if (now >= nextFireworkTime) {
      launchFirework();
      nextFireworkTime = now + 1600 + Math.random() * 1800; // Cách mỗi 1.6s - 3.4s nổ một phát
    }

    for (let i = fireworks.length - 1; i >= 0; i--) {
      const fw = fireworks[i];
      fw.x += fw.vx;
      fw.y += fw.vy;
      fw.vy += 0.18; // trọng lực làm chậm khi lên tới đỉnh

      fw.trail.push({ x: fw.x, y: fw.y, alpha: 0.8 });
      if (fw.trail.length > 5) fw.trail.shift();

      // Vẽ vệt bay
      ctx.save();
      ctx.strokeStyle = fw.color;
      ctx.lineWidth = 2;
      for (const t of fw.trail) {
        t.alpha -= 0.12;
        ctx.globalAlpha = Math.max(0, t.alpha);
        ctx.beginPath();
        ctx.arc(t.x, t.y, 1.2, 0, Math.PI * 2);
        ctx.fillStyle = '#ffe685';
        ctx.fill();
      }
      ctx.restore();

      // Khi chạm đỉnh hoặc gần target
      if (fw.vy >= -0.2 || fw.y <= fw.targetY) {
        explodeFirework(fw);
        fireworks.splice(i, 1);
      }
    }

    // 3. Các tia pháo hoa rơi rực rỡ
    for (let i = sparks.length - 1; i >= 0; i--) {
      const sp = sparks[i];
      sp.x += sp.vx;
      sp.y += sp.vy;
      sp.vy += 0.055;
      sp.vx *= 0.98;
      sp.vy *= 0.98;
      sp.alpha -= sp.decay;

      if (sp.alpha <= 0) {
        sparks.splice(i, 1);
        continue;
      }

      ctx.save();
      let displayAlpha = sp.alpha;
      if (sp.twinkle) {
        displayAlpha *= (0.7 + Math.sin(now * 0.02 + i) * 0.3);
      }
      ctx.globalAlpha = Math.max(0, Math.min(1, displayAlpha));
      ctx.fillStyle = sp.color;
      ctx.shadowColor = sp.color;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 4. Bụi sáng vàng may mắn (Golden Sparkles)
    ctx.save();
    for (let i = 0; i < goldenSparkles.length; i++) {
      const sp = goldenSparkles[i];
      sp.x += sp.vx;
      sp.y += sp.vy;
      sp.phase += sp.pulseSpeed;

      if (sp.y < -10) sp.y = height + 10;
      if (sp.x < -10) sp.x = width + 10;
      if (sp.x > width + 10) sp.x = -10;

      const alpha = sp.baseAlpha * (0.6 + Math.sin(sp.phase) * 0.4);
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

      // Glow xung quanh hạt
      const grad = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, sp.glowRadius);
      grad.addColorStop(0, 'rgba(255, 220, 100, 0.9)');
      grad.addColorStop(0.4, 'rgba(255, 185, 40, 0.35)');
      grad.addColorStop(1, 'rgba(255, 150, 0, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sp.glowRadius, 0, Math.PI * 2);
      ctx.fill();

      // Tâm sáng chói
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sp.size * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 5. Cánh hoa đào & hoa mai rơi chao nghiêng 3D
    for (let i = 0; i < blossoms.length; i++) {
      const b = blossoms[i];
      b.swayOffset += b.swaySpeed;
      b.angle += b.angularSpeed;
      b.flip += b.flipSpeed;

      const sway = Math.sin(b.swayOffset) * b.swayAmplitude;
      b.x += b.vx + sway;
      b.y += b.vy;

      // Khi hoa rơi hết đáy hoặc bay khỏi màn hình -> tái sinh ở trên
      if (b.y > height + 25 || b.x < -40 || b.x > width + 40) {
        blossoms[i] = createBlossom(-20);
        continue;
      }

      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.angle);

      // Hiệu ứng xoay lật 3D theo trục Y bằng cos
      const flipScale = Math.cos(b.flip);
      ctx.scale(1, Math.abs(flipScale) < 0.1 ? 0.1 : flipScale);
      ctx.globalAlpha = b.opacity;

      if (b.palette.isFlower) {
        drawFlower(ctx, b.size, b.palette);
      } else {
        drawPetal(ctx, b.size, b.palette.color, b.palette.highlight);
      }

      ctx.restore();
    }

    animationFrameId = requestAnimationFrame(loop);
  }

  loop();

  return {
    destroy() {
      running = false;
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', resize);
      resizeObserver.disconnect();
    },
  };
}
