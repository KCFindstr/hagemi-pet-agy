// Soft particles, her dish of dried fish (quota) and mini clones (subagents). Clones are the real art
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

  // One 小鱼干: curled from drying, silver back, warm belly, inked like the rest of her world.
  function fish(ctx, x, y, length, angle, flip) {
    const k = length / 62;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(flip ? -k : k, k);
    const body = () => {
      ctx.beginPath();
      ctx.moveTo(-31, 2);
      ctx.bezierCurveTo(-25, -10, -6, -13, 10, -7);
      ctx.quadraticCurveTo(16, -4.5, 20, -2);
      ctx.quadraticCurveTo(26, -7, 33, -11);
      ctx.quadraticCurveTo(29, -1, 33, 8);
      ctx.quadraticCurveTo(25, 5, 20, 2);
      ctx.quadraticCurveTo(14, 6, 8, 7.5);
      ctx.bezierCurveTo(-8, 11.5, -24, 10, -31, 2);
      ctx.closePath();
    };
    body();
    const skin = ctx.createLinearGradient(0, -12, 0, 11);
    skin.addColorStop(0, '#7d86bd');
    skin.addColorStop(0.42, '#c9cee8');
    skin.addColorStop(0.72, '#f7e6bf');
    skin.addColorStop(1, '#e8b877');
    ctx.fillStyle = skin;
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.save();
    body();
    ctx.clip();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-14, -6);
    ctx.quadraticCurveTo(0, -9, 10, -4.5);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(47, 42, 110, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-16, -6);
    ctx.quadraticCurveTo(-12, 0, -15, 7);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(-22.5, -1, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.fillStyle = OUTLINE;
    ctx.beginPath();
    ctx.arc(-22.8, -0.8, 1.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // All that is left of the last one.
  function fishbone(ctx, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.08);
    ctx.lineCap = 'round';
    for (const [width, color] of [[4.4, OUTLINE], [2, '#f2eeff']]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(-16, 0);
      ctx.lineTo(17, 0);
      for (const rib of [-8, -1, 6]) { ctx.moveTo(rib + 2, -6); ctx.lineTo(rib - 1, 6); }
      ctx.moveTo(17, 0); ctx.lineTo(23, -5);
      ctx.moveTo(17, 0); ctx.lineTo(23, 5);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-24, 0);
    ctx.quadraticCurveTo(-20, -7, -14, -3);
    ctx.lineTo(-14, 3);
    ctx.quadraticCurveTo(-20, 7, -24, 0);
    ctx.closePath();
    ctx.fillStyle = '#f2eeff';
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  const KINDS = {
    fish(ctx, p) { fish(ctx, 0, 0, p.size, 0, p.flip); },
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
      text: options.text, flip: options.flip, drag: options.drag ?? 0, front: options.front !== false, wobble: options.wobble ?? 0, phase: Math.random() * 6.28,
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
    fish(x, y, n = 16) {
      for (let i = 0; i < n; i++) emit('fish', x + rand(-190, 190), y - 340 + rand(-40, 20), { vy: rand(40, 170), ay: 340, ttl: rand(0.9, 1.5), size: rand(44, 66), spin: rand(-4, 4), angle: rand(-1, 1), flip: i % 2 === 0, front: i % 2 === 0 });
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

  // ---- Her dish of dried fish: quota is 小鱼干, and the pile is the meter ---------------------
  const stash = { show: 0, target: 0, level: 1, label: '' };
  // Lowest row first: as quota drains, the top of the pile goes before the bottom.
  const PILE = [[-27, -8, 0.32, 0.9], [-6, -12, -0.2, 1], [17, -8, 0.14, 0.95], [32, -6, -0.46, 0.8], [-17, -21, -0.42, 0.95], [7, -24, 0.3, 1], [25, -19, -0.2, 0.88], [-5, -34, 0.5, 0.92], [13, -36, -0.36, 0.86]];
  function drawStash(ctx, dt, t) {
    stash.show = lerp(stash.show, stash.target, 1 - Math.exp(-dt * 7));
    if (stash.show < 0.01) return;
    ctx.save();
    ctx.translate(STAGE.cx - 268 + Math.sin(t * 1.1) * 5, 205 + Math.sin(t * 1.7) * 8);
    ctx.rotate(Math.sin(t * 0.9) * 0.04);
    const pop = stash.show * (1 + 0.14 * Math.sin(stash.show * Math.PI));
    ctx.scale(pop * 1.42, pop * 1.42);
    ctx.globalAlpha = clamp(stash.show * 1.4, 0, 1);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // Inside of the bowl.
    ctx.beginPath();
    ctx.ellipse(0, -2, 47, 13, 0, 0, Math.PI * 2);
    const inside = ctx.createLinearGradient(0, -15, 0, 11);
    inside.addColorStop(0, '#574a9c');
    inside.addColorStop(1, '#8a78d4');
    ctx.fillStyle = inside;
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2.6;
    ctx.stroke();
    const count = stash.level <= 0.001 ? 0 : Math.max(1, Math.ceil(stash.level * PILE.length));
    if (!count) fishbone(ctx, 2, -3);
    for (let i = count - 1; i >= 0; i--) {
      const [x, y, angle, size] = PILE[i];
      fish(ctx, x, y + Math.sin(t * 2 + i) * 0.5, 52 * size, angle, i % 2 === 0);
    }
    // Front wall of the bowl hides the bottom of the pile.
    ctx.beginPath();
    ctx.moveTo(-47, -2);
    ctx.bezierCurveTo(-44, 8, -44, 22, -30, 31);
    ctx.quadraticCurveTo(0, 37, 30, 31);
    ctx.bezierCurveTo(44, 22, 44, 8, 47, -2);
    ctx.bezierCurveTo(30, 16, -30, 16, -47, -2);
    ctx.closePath();
    const wall = ctx.createLinearGradient(0, -2, 0, 36);
    wall.addColorStop(0, '#fbf8ff');
    wall.addColorStop(0.55, '#d9cdfb');
    wall.addColorStop(1, '#a896ee');
    ctx.fillStyle = wall;
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2.6;
    ctx.stroke();
    // A soft shine and her star on the bowl.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(-36, 11);
    ctx.quadraticCurveTo(-30, 20, -21, 25);
    ctx.stroke();
    if (stash.label) {
      ctx.font = '700 15px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3.4;
      ctx.strokeStyle = '#ffffffd8';
      ctx.strokeText(stash.label, 2, 21);
      ctx.fillStyle = OUTLINE;
      ctx.fillText(stash.label, 2, 21);
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
    setStash(value) {
      stash.target = value ? 1 : 0;
      if (value) { stash.level = clamp(value.level, 0, 1); stash.label = value.label || ''; }
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
        if (isFront) drawStash(ctx, dt, t);
      }
    },
    clear() { particles = []; clones = []; },
  };
};
