// Soft particles, the honey jar (quota) and mini clones (subagents). Clones are the real art
// scaled down; particles stay small, round and pastel so the painted pose keeps the spotlight.
HAGEMI.createFx = function createFx(backCanvas, frontCanvas) {
  const { clamp, rand, lerp } = HAGEMI.util;
  const { STAGE } = HAGEMI;
  const back = backCanvas.getContext('2d'), front = frontCanvas.getContext('2d');
  const OUTLINE = '#2f2a6e';
  let particles = [];

  const star = (ctx, x, y, r, inner = 0.3) => {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4 - Math.PI / 2, d = i % 2 ? r * inner : r;
      ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * d, y + Math.sin(a) * d);
    }
    ctx.closePath();
  };
  const heart = (ctx, x, y, r) => {
    ctx.beginPath();
    ctx.moveTo(x, y + r * 0.95);
    ctx.bezierCurveTo(x - r * 1.5, y - r * 0.1, x - r * 0.75, y - r * 1.1, x, y - r * 0.35);
    ctx.bezierCurveTo(x + r * 0.75, y - r * 1.1, x + r * 1.5, y - r * 0.1, x, y + r * 0.95);
    ctx.closePath();
  };

  const KINDS = {
    star(ctx, p) {
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, p.size);
      glow.addColorStop(0, '#ffffff');
      glow.addColorStop(0.45, p.color);
      glow.addColorStop(1, p.color);
      star(ctx, 0, 0, p.size);
      ctx.fillStyle = glow;
      ctx.fill();
    },
    heart(ctx, p) {
      heart(ctx, 0, 0, p.size);
      const fill = ctx.createLinearGradient(0, -p.size, 0, p.size);
      fill.addColorStop(0, '#ffb3cb');
      fill.addColorStop(1, p.color);
      ctx.fillStyle = fill;
      ctx.fill();
    },
    text(ctx, p) {
      ctx.font = `700 ${p.size}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#ffffffd0';
      ctx.strokeText(p.text, 0, 0);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, 0, 0);
    },
    confetti(ctx, p) {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.roundRect(-p.size / 2, -p.size / 4, p.size, p.size / 2, p.size / 6);
      ctx.fill();
    },
    drop(ctx, p) {
      const fill = ctx.createLinearGradient(0, -p.size, 0, p.size);
      fill.addColorStop(0, '#ffffffc0');
      fill.addColorStop(0.5, p.color);
      fill.addColorStop(1, p.color);
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(0, -p.size);
      ctx.quadraticCurveTo(p.size, p.size * 0.4, 0, p.size);
      ctx.quadraticCurveTo(-p.size, p.size * 0.4, 0, -p.size);
      ctx.fill();
    },
    puff(ctx, p) {
      const fill = ctx.createRadialGradient(0, 0, 0, 0, 0, p.size);
      fill.addColorStop(0, p.color);
      fill.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(0, 0, p.size, 0, Math.PI * 2);
      ctx.fill();
    },
  };
  const PALETTE = ['#b79cff', '#8fd8ff', '#ffb3d9', '#ffe08a', '#d4c4ff', '#a8f0e4'];

  function emit(kind, x, y, options = {}) {
    if (particles.length > 160) return;
    particles.push({
      kind, x, y,
      vx: options.vx ?? 0, vy: options.vy ?? 0, ax: options.ax ?? 0, ay: options.ay ?? 0,
      life: 0, ttl: options.ttl ?? 1.4,
      size: options.size ?? 10, spin: options.spin ?? 0, angle: options.angle ?? 0,
      color: options.color ?? PALETTE[(Math.random() * PALETTE.length) | 0],
      text: options.text, drag: options.drag ?? 0, front: options.front !== false, wobble: options.wobble ?? 0, phase: Math.random() * 6.28,
    });
  }

  const BURSTS = {
    confetti(x, y, n = 36) {
      for (let i = 0; i < n; i++) emit('confetti', x, y - 120, { vx: rand(-260, 260), vy: rand(-380, -90), ay: 300, ttl: rand(1.1, 2.1), size: rand(10, 18), spin: rand(-9, 9), drag: 0.7 });
      for (let i = 0; i < 10; i++) emit('star', x, y - 120, { vx: rand(-210, 210), vy: rand(-290, -60), ay: 130, ttl: rand(0.9, 1.5), size: rand(9, 17), spin: rand(-5, 5), drag: 0.9 });
    },
    sparkles(x, y, n = 12) {
      for (let i = 0; i < n; i++) emit('star', x + rand(-190, 190), y + rand(-300, 120), { vy: rand(-46, -14), ttl: rand(0.7, 1.4), size: rand(7, 15), spin: rand(-3, 3) });
    },
    hearts(x, y, n = 6) {
      for (let i = 0; i < n; i++) emit('heart', x + rand(-110, 110), y - 230 + rand(-30, 30), { vy: rand(-92, -46), vx: rand(-22, 22), ttl: rand(1.1, 1.9), size: rand(10, 16), color: '#fb7199', wobble: 26 });
    },
    sweat(x, y, n = 6) {
      for (let i = 0; i < n; i++) emit('drop', x + 90, y - 250, { vx: rand(40, 170), vy: rand(-150, -30), ay: 480, ttl: 0.75, size: rand(5, 9), color: '#8dd0f7' });
    },
    steam(x, y, n = 12) {
      for (const side of [-1, 1]) for (let i = 0; i < n / 2; i++) emit('puff', x + side * 130, y - 260, { vx: side * rand(40, 130), vy: rand(-100, -40), ttl: rand(0.5, 1), size: rand(12, 24), color: 'rgba(255,255,255,0.85)', drag: 1.4 });
    },
    dust(x, y, n = 10) {
      for (let i = 0; i < n; i++) emit('puff', x + rand(-110, 110), y + 230, { vx: rand(-80, 80), vy: rand(-30, -5), ttl: rand(0.4, 0.8), size: rand(9, 18), color: 'rgba(190,180,230,0.6)', drag: 1.6 });
    },
    honey(x, y, n = 18) {
      for (let i = 0; i < n; i++) emit('drop', x + rand(-170, 170), y - 330, { vy: rand(60, 220), ay: 360, ttl: rand(0.8, 1.3), size: rand(7, 12), color: i % 3 ? '#fbbf24' : '#fde68a', front: i % 2 === 0 });
    },
    notes(x, y, n = 4) {
      for (let i = 0; i < n; i++) emit('text', x + rand(-130, 130), y - 250, { text: Math.random() < 0.5 ? '♪' : '♫', size: rand(24, 32), vy: rand(-70, -30), wobble: 24, ttl: rand(1.1, 1.8), color: '#8b6bf0' });
    },
  };

  function stepParticles(dt, t) {
    const alive = [];
    for (const p of particles) {
      p.life += dt;
      if (p.life >= p.ttl) continue;
      p.vx += p.ax * dt; p.vy += p.ay * dt;
      if (p.drag) { p.vx *= 1 - p.drag * dt; p.vy *= 1 - p.drag * dt; }
      p.x += p.vx * dt + (p.wobble ? Math.cos(t * 3 + p.phase) * p.wobble * dt : 0);
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
      alive.push(p);
    }
    particles = alive;
  }
  function drawParticles(ctx, frontLayer) {
    for (const p of particles) {
      if (p.front !== frontLayer) continue;
      const fade = clamp((p.ttl - p.life) / (p.ttl * 0.3), 0, 1), grow = clamp(p.life / 0.12, 0, 1);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.scale(grow, grow);
      ctx.globalAlpha = fade;
      KINDS[p.kind](ctx, p);
      ctx.restore();
    }
  }

  // ---- Honey jar: quota is honey (哈基米 = honey water) -------------------------------------
  const jar = { show: 0, target: 0, level: 1, label: '' };
  function drawJar(ctx, dt, t) {
    jar.show = lerp(jar.show, jar.target, 1 - Math.exp(-dt * 7));
    if (jar.show < 0.01) return;
    const level = jar.level;
    ctx.save();
    ctx.translate(STAGE.cx - 262 + Math.sin(t * 1.1) * 5, 190 + Math.sin(t * 1.7) * 8);
    ctx.rotate(Math.sin(t * 0.9) * 0.05);
    const pop = jar.show * (1 + 0.14 * Math.sin(jar.show * Math.PI));
    ctx.scale(pop * 1.28, pop * 1.28);
    ctx.globalAlpha = clamp(jar.show * 1.4, 0, 1);
    const glass = () => { ctx.beginPath(); ctx.roundRect(-36, -34, 72, 78, 20); };
    glass();
    const shine = ctx.createLinearGradient(-36, 0, 36, 0);
    shine.addColorStop(0, 'rgba(232, 226, 255, 0.72)');
    shine.addColorStop(0.5, 'rgba(255, 255, 255, 0.34)');
    shine.addColorStop(1, 'rgba(206, 194, 250, 0.7)');
    ctx.fillStyle = shine;
    ctx.fill();
    ctx.save();
    glass();
    ctx.clip();
    const top = 44 - level * 76;
    const honey = ctx.createLinearGradient(0, top, 0, 46);
    const colors = level < 0.1 ? ['#ffb37a', '#ea6a2a'] : level < 0.25 ? ['#ffcf6e', '#ee8f22'] : ['#ffe58f', '#f4a81c'];
    honey.addColorStop(0, colors[0]);
    honey.addColorStop(1, colors[1]);
    ctx.fillStyle = honey;
    ctx.beginPath();
    ctx.moveTo(-40, top);
    for (let x = -40; x <= 40; x += 4) ctx.lineTo(x, top + Math.sin(x * 0.2 + t * 3.6) * 2);
    ctx.lineTo(40, 48);
    ctx.lineTo(-40, 48);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    glass();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3.2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.82)';
    ctx.lineWidth = 3.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-24, -18);
    ctx.quadraticCurveTo(-27, -4, -24, 12);
    ctx.stroke();
    ctx.beginPath();
    ctx.roundRect(-31, -47, 62, 16, 6);
    const lid = ctx.createLinearGradient(0, -47, 0, -31);
    lid.addColorStop(0, '#c7b4ff');
    lid.addColorStop(1, '#7d67e0');
    ctx.fillStyle = lid;
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3;
    ctx.stroke();
    star(ctx, 0, -39, 6.5, 0.32);
    ctx.fillStyle = '#fff6d6';
    ctx.fill();
    if (jar.label) {
      ctx.font = '700 19px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#ffffffe0';
      ctx.strokeText(jar.label, 0, 16);
      ctx.fillStyle = OUTLINE;
      ctx.fillText(jar.label, 0, 16);
    }
    ctx.restore();
  }

  // ---- Mini clones: one tiny Hagemi per running subagent ----------------------------------
  let clones = [], cloneImage = null;
  function drawClones(ctx, dt, t, frontLayer) {
    if (!cloneImage) return;
    for (const clone of clones) {
      clone.show = lerp(clone.show, clone.target, 1 - Math.exp(-dt * 6));
      const angle = t * clone.speed + clone.phase;
      const depth = Math.sin(angle);
      if ((depth > 0) !== frontLayer) continue;
      const x = STAGE.cx + Math.cos(angle) * 320, y = 370 + depth * 70 + Math.sin(t * 3 + clone.phase) * 12;
      const height = (118 + depth * 20) * clone.show;
      if (height < 3) continue;
      const width = height * (cloneImage.width / cloneImage.height);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.sin(t * 2 + clone.phase) * 0.14);
      ctx.globalAlpha = clamp(clone.show * 1.4, 0, 1);
      ctx.drawImage(cloneImage, -width / 2, -height / 2, width, height);
      ctx.restore();
    }
    clones = clones.filter(clone => clone.target || clone.show > 0.02);
  }

  let zTimer = 0;
  return {
    burst(name, x, y, ...rest) { if (BURSTS[name]) BURSTS[name](x, y, ...rest); },
    setJar(value) {
      jar.target = value ? 1 : 0;
      if (value) { jar.level = clamp(value.level, 0, 1); jar.label = value.label || ''; }
    },
    setCloneImage(bitmap) { cloneImage = bitmap; },
    setClones(count) {
      while (clones.length < count) clones.push({ show: 0, target: 1, phase: Math.random() * 6.28, speed: rand(0.45, 0.75) * (Math.random() < 0.5 ? -1 : 1) });
      clones.forEach((clone, index) => { clone.target = index < count ? 1 : 0; });
    },
    resize(width, height) {
      for (const canvas of [backCanvas, frontCanvas]) if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    },
    draw(dt, t, k, marginPx, pose) {
      stepParticles(dt, t);
      if (pose.sleeping) {
        zTimer -= dt;
        if (zTimer <= 0) {
          zTimer = 1.25;
          emit('text', STAGE.cx + 130, 150, { text: 'z', size: rand(26, 40), vy: -34, vx: 22, wobble: 16, ttl: 2.2, color: '#7f70e8' });
        }
      }
      for (const [ctx, isFront] of [[back, false], [front, true]]) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.setTransform(k, 0, 0, k, marginPx + pose.shiftX * k, marginPx + (pose.bob * 0.5 + pose.shiftY) * k);
        drawClones(ctx, dt, t, isFront);
        drawParticles(ctx, isFront);
        if (isFront) drawJar(ctx, dt, t);
      }
    },
    clear() { particles = []; clones = []; },
  };
};
