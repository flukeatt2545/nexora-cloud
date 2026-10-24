/**
 * Halloween effects drawn on canvas, with no pictures to load: pumpkins and witch hats falling over the page,
 * a shockwave that knocks them upward where the page is clicked, lightning, and a glowing skeleton hand in
 * place of the mouse pointer. Brought over from the nknnull.sbs Halloween bundle (halloween.js); the slime
 * edge and corner pumpkins of that bundle are left out, the site draws those itself (halloween-slime.css).
 *
 *   const fx = new HalloweenEffect({ zIndex: 900 });   // starts at once
 *   fx.destroy();                                      // removes the canvases and every listener
 */
export const TAU = 2 * Math.PI;
export const rnd = (min, max) => min + Math.random() * (max - min);
export const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

// --- OFFSCREEN SPRITE CACHES ---
const spriteCache = {};

function getCachedSprite(key, width, height, drawFn) {
  if (spriteCache[key]) return spriteCache[key];
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(2 * (width + 16));
  canvas.height = Math.ceil(2 * (height + 16));
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);
  ctx.translate(8 + width / 2, 8 + height / 2);
  drawFn(ctx);
  canvas.dw = width + 16;
  canvas.dh = height + 16;
  spriteCache[key] = canvas;
  return canvas;
}

export function blit(ctx, sprite, x, y, scale, rot, alpha = 1) {
  const dw = sprite.dw * scale;
  const dh = sprite.dh * scale;
  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  if (rot) {
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.drawImage(sprite, -dw / 2, -dh / 2, dw, dh);
  } else {
    ctx.drawImage(sprite, x - dw / 2, y - dh / 2, dw, dh);
  }
  ctx.restore();
}

export function pumpkinSprite(hasFace) {
  return getCachedSprite('pump_' + (hasFace ? 1 : 0), 44, 44, function(t) {
    t.shadowColor = 'rgba(120,40,0,.35)';
    t.shadowBlur = 4;
    t.shadowOffsetY = 1.5;
    const lobes = [
      [-11, 1, 9, 13, '#df5f17'],
      [11, 1, 9, 13, '#df5f17'],
      [-5, 1, 9, 14, '#f2771e'],
      [5, 1, 9, 14, '#f2771e'],
      [0, 1, 8, 14.5, '#ff8d2c']
    ];
    for (let i = 0; i < lobes.length; i++) {
      const o = lobes[i];
      t.fillStyle = o[4];
      t.beginPath();
      t.ellipse(o[0], o[1], o[2], o[3], 0, 0, TAU);
      t.fill();
    }
    t.shadowColor = 'transparent';
    t.fillStyle = 'rgba(255,255,255,.2)';
    t.beginPath();
    t.ellipse(-5, -6, 2.5, 4, -0.3, 0, TAU);
    t.fill();

    // Green curved stem
    t.fillStyle = '#55762a';
    t.beginPath();
    t.moveTo(-2.2, -11);
    t.quadraticCurveTo(-1.5, -19, 4, -20.5);
    t.lineTo(5.2, -17.6);
    t.quadraticCurveTo(2, -16.5, 2, -11);
    t.closePath();
    t.fill();

    // Glowing carved face
    if (hasFace) {
      t.fillStyle = '#ffd65e';
      t.shadowColor = 'rgba(255,200,80,1)';
      t.shadowBlur = 6;
      t.beginPath();
      // Left eye
      t.moveTo(-9, 0); t.lineTo(-5.5, -6.5); t.lineTo(-2, 0); t.closePath();
      // Right eye
      t.moveTo(9, 0); t.lineTo(5.5, -6.5); t.lineTo(2, 0); t.closePath();
      // Jagged mouth
      t.moveTo(-10, 4);
      t.lineTo(-6.5, 6.5);
      t.lineTo(-4, 4.5);
      t.lineTo(-1.2, 7.5);
      t.lineTo(1.5, 4.5);
      t.lineTo(4.5, 7.5);
      t.lineTo(7, 4.5);
      t.lineTo(10, 4);
      t.quadraticCurveTo(0, 15, -10, 4);
      t.closePath();
      t.fill();
    }
  });
}

function hatSprite() {
  return getCachedSprite('hat', 40, 36, function(e) {
    e.shadowColor = 'rgba(0,0,0,.35)';
    e.shadowBlur = 3;
    e.shadowOffsetY = 1;
    // Hat brim
    e.fillStyle = '#2a1838';
    e.beginPath();
    e.ellipse(0, 10, 19, 5, 0, 0, TAU);
    e.fill();
    e.shadowColor = 'transparent';
    e.strokeStyle = '#6a4a8e';
    e.lineWidth = 1;
    e.stroke();

    // Cone
    const g = e.createLinearGradient(-9, 0, 9, 0);
    g.addColorStop(0, '#3d2456');
    g.addColorStop(1, '#1c0f28');
    e.fillStyle = g;
    e.beginPath();
    e.moveTo(-10, 9);
    e.quadraticCurveTo(-6, -4, -1, -11);
    e.quadraticCurveTo(4, -17, 12, -15);
    e.quadraticCurveTo(5, -12, 3, -5);
    e.lineTo(10, 9);
    e.closePath();
    e.fill();
    e.strokeStyle = 'rgba(150,110,200,.6)';
    e.lineWidth = 0.8;
    e.stroke();

    // Purple band
    e.fillStyle = '#7a3fe0';
    e.beginPath();
    e.moveTo(-9.4, 6);
    e.lineTo(9.4, 6);
    e.lineTo(10, 9.2);
    e.lineTo(-10, 9.2);
    e.closePath();
    e.fill();

    // Gold buckle
    e.fillStyle = '#ffcf3a';
    e.fillRect(-2.6, 5.6, 5.2, 4);
    e.fillStyle = '#7a3fe0';
    e.fillRect(-1.2, 6.6, 2.4, 2);

    // Star
    e.fillStyle = '#ffcf3a';
    e.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 1.2 : 2.8;
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      const sx = Math.cos(a) * r - 4;
      const sy = Math.sin(a) * r - 3;
      if (i === 0) e.moveTo(sx, sy); else e.lineTo(sx, sy);
    }
    e.closePath();
    e.fill();
  });
}

// --- SKELETON BONE HAND PROCEDURAL GENERATOR ---
function createBoneChain(out, startX, startY, startAngle, lengths, thicknesses, bendDeltas) {
  let x = startX, y = startY, angle = startAngle;
  for (let i = 0; i < lengths.length; i++) {
    if (i) {
      angle += Array.isArray(bendDeltas) ? bendDeltas[i] : bendDeltas;
    }
    const endX = x + Math.cos(angle) * lengths[i];
    const endY = y + Math.sin(angle) * lengths[i];
    out.push([x, y, endX, endY, thicknesses[i]]);
    x = endX + 1.5 * Math.cos(angle);
    y = endY + 1.5 * Math.sin(angle);
  }
  return out;
}

function drawBoneSegment(ctx, seg) {
  const [x1, y1, x2, y2, thickness] = seg;
  const d = 1.38 * thickness;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  if (ny < 0 || (ny === 0 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  const capRadius = 0.62 * d;
  const boneWidth = 0.8 * d;
  const darkOutline = '#1a0b2e';

  ctx.strokeStyle = darkOutline;
  ctx.fillStyle = darkOutline;
  ctx.lineWidth = boneWidth + 1.8;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x1, y1, capRadius + 0.9, 0, TAU);
  ctx.arc(x2, y2, capRadius + 0.9, 0, TAU);
  ctx.fill();

  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const grad = ctx.createLinearGradient(
    cx - nx * d * 0.6,
    cy - ny * d * 0.6,
    cx + nx * d * 0.6,
    cy + ny * d * 0.6
  );
  grad.addColorStop(0, '#fff9ff');
  grad.addColorStop(0.42, '#e7d8fb');
  grad.addColorStop(1, '#8a5bd4');

  ctx.strokeStyle = grad;
  ctx.lineWidth = boneWidth;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  const joints = [[x1, y1], [x2, y2]];
  for (let j = 0; j < joints.length; j++) {
    const [jx, jy] = joints[j];
    const rgrad = ctx.createRadialGradient(
      jx - 0.35 * capRadius,
      jy - 0.4 * capRadius,
      0.1 * capRadius,
      jx,
      jy,
      1.05 * capRadius
    );
    rgrad.addColorStop(0, '#fffaff');
    rgrad.addColorStop(0.55, '#dcc8f8');
    rgrad.addColorStop(1, '#8250cc');
    ctx.fillStyle = rgrad;
    ctx.beginPath();
    ctx.arc(jx, jy, capRadius, 0, TAU);
    ctx.fill();
  }

  ctx.strokeStyle = 'rgba(95,45,165,.4)';
  ctx.lineWidth = 0.7;
  const grooveOffset = 0.2 * d;
  const capTrim = (0.9 * capRadius) / len;
  ctx.beginPath();
  ctx.moveTo(x1 + dx * capTrim + nx * grooveOffset, y1 + dy * capTrim + ny * grooveOffset);
  ctx.lineTo(x2 - dx * capTrim + nx * grooveOffset, y2 - dy * capTrim + ny * grooveOffset);
  ctx.stroke();
}

function drawBoneHand(ctx, rot, grasp, idleTime) {
  const carpal = [
    [56, 30, 71, 45, 4.4],
    [53.5, 36, 67, 49.5, 3.8]
  ];
  const metacarpal = [
    [34, 14, 49, 25.5, 3],
    [36, 20, 49.5, 28.5, 2.9],
    [37, 26, 49.5, 32, 2.8],
    [37, 31.5, 48.5, 35.5, 2.7]
  ];

  const fingers = [];
  [[37, 31.5, 2.5], [37, 26, 2.7], [36, 20, 2.9]].forEach((f, i) => {
    const [startX, startY, thick] = f;
    const wave = 0.05 * Math.sin(0.004 * idleTime + 1.3 * i);
    createBoneChain(
      fingers,
      startX,
      startY,
      Math.PI - 0.15 + wave,
      [9.5 + 0.4 * i, 6.2, 5],
      [thick, 0.9 * thick, 0.82 * thick],
      [0, -1.25 - 0.25 * grasp, -1.35 - 0.2 * grasp]
    );
  });

  const indexFinger = createBoneChain(
    [],
    34,
    14,
    Math.PI + 0.2,
    [13, 9, 7.5],
    [3.3, 3, 2.7],
    [0, 0.75 * -grasp, 0.8 * -grasp]
  );

  const thumb = createBoneChain(
    [],
    44,
    37,
    Math.PI - 0.08 + 0.15 * grasp,
    [9, 8],
    [3.5, 3.1],
    [0, 0.18 + 0.3 * grasp]
  );

  const indexTip = createBoneChain([], 34, 14, Math.PI + 0.2, [13, 9, 7.5], [1, 1, 1], 0)[2];
  const pivotX = indexTip[2] - 2.2;
  const pivotY = indexTip[3];

  ctx.save();
  ctx.globalAlpha = 1;
  ctx.translate(24, 40);
  ctx.rotate(-0.06 + rot);
  const scale = 0.6 - 0.03 * grasp;
  ctx.scale(scale, scale);
  ctx.translate(-pivotX, -pivotY);

  // Glowing purple aura
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(175,120,255,.75)';
  ctx.shadowBlur = 14;
  ctx.strokeStyle = 'rgba(175,120,255,.35)';
  ctx.lineWidth = 9;
  ctx.beginPath();
  const allGlow = [].concat(carpal, metacarpal, indexFinger, fingers, thumb);
  for (let i = 0; i < allGlow.length; i++) {
    const s = allGlow[i];
    ctx.moveTo(s[0], s[1]);
    ctx.lineTo(s[2], s[3]);
  }
  ctx.stroke();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  // 3D Bone segments
  const middleKnuckles = [
    [51, 26.5, 52.5, 28, 3],
    [54.5, 29.5, 55, 31, 3],
    [51, 32, 52, 33.5, 3],
    [55, 34.5, 55.5, 35.5, 2.8]
  ];
  const allBones = [].concat(carpal, metacarpal, middleKnuckles, fingers, indexFinger, thumb);
  for (let i = 0; i < allBones.length; i++) {
    drawBoneSegment(ctx, allBones[i]);
  }
  ctx.restore();
}

// --- FULL SCREEN HALLOWEEN EFFECT ---
export class HalloweenEffect {
  constructor(options = {}) {
    this.options = Object.assign({
      zIndex: 1000,
      intensity: 1,
      speed: 1,
      lightning: true,
      lightningEvery: 10,
      pumpkins: true,
      witchHat: true,
      boneCursor: true
    }, options);

    this.active = false;
    this.init();
  }

  init() {
    // Create fx canvas
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'halloween-effect';
    this.canvas.style.cssText = `position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:${this.options.zIndex};`;
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this.parts = { pumpkins: [] };
    this.bolt = { t: rnd(2, 5), age: 9, lines: null };
    this.boom = { x: 0, y: 0, v: 0 };
    this.clk = 0;
    this.last = performance.now();
    this.reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.resize = this.resize.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onVisibilityChange = this.onVisibilityChange.bind(this);
    this.loop = this.loop.bind(this);

    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('pointerdown', this.onPointerDown, { passive: true });
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    if (this.options.boneCursor) {
      this.initCursor();
    }

    this.active = true;
    this.start();
  }

  initCursor() {
    this.cursorCanvas = document.createElement('canvas');
    this.cursorCanvas.className = 'halloween-cursor';
    this.cursorCanvas.style.cssText = 'position:fixed;left:0;top:0;display:none;width:120px;height:100px;pointer-events:none;will-change:transform;z-index:2147483000;';
    document.body.appendChild(this.cursorCanvas);
    this.cursorCtx = this.cursorCanvas.getContext('2d');

    this.cursorDpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cursorCanvas.width = 120 * this.cursorDpr;
    this.cursorCanvas.height = 100 * this.cursorDpr;

    this.cur = { x: 0, y: 0, lx: 0, on: false, down: false, holdUntil: 0, hover: false, g: 0, hv: 0, rot: 0, idle: 0 };

    this.onPointerMove = (e) => {
      if (this.cur && e.pointerType === 'mouse') {
        const t = this.cur;
        if (!t.on) {
          t.lx = e.clientX;
          document.documentElement.classList.add('halloween-bone-cursor');
        }
        t.on = true;
        t.x = e.clientX;
        t.y = e.clientY;
        t.hover = !!(e.target && e.target.closest && e.target.closest('a, button, [role="button"], input, select, textarea, label, summary, .btn, .cursor-pointer'));
      }
    };

    this.onPointerUp = () => {
      if (this.cur) this.cur.down = false;
    };

    this.onMouseLeave = () => {
      if (this.cur) {
        this.cur.on = false;
        this.cur.down = false;
        document.documentElement.classList.remove('halloween-bone-cursor');
      }
    };

    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    window.addEventListener('pointerup', this.onPointerUp, { passive: true });
    document.documentElement.addEventListener('mouseleave', this.onMouseLeave);
  }

  onPointerDown(e) {
    this.boom = { x: e.clientX, y: e.clientY, v: 1 };
    if (this.cur && e.pointerType === 'mouse') {
      this.cur.down = true;
      this.cur.holdUntil = performance.now() + 180;
    }
  }

  resize() {
    if (!this.canvas) return;
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.area = clamp((this.w * this.h) / 266400, 0.55, 2.4);
    this.ds = clamp(Math.min(this.w, 576) / 380, 0.6, 1.25);
    this.syncCounts();
  }

  syncCounts() {
    const targetCount = this.options.pumpkins ? Math.round(10 * 0.6 * this.area * this.options.intensity) : 0;
    const arr = this.parts.pumpkins;
    while (arr.length < targetCount) arr.push(this.spawnPumpkin(true));
    arr.length = targetCount;
  }

  spawnPumpkin(initial) {
    const vy = rnd(0.5, 1.05);
    return {
      x: rnd(10, this.w - 10),
      y: initial ? rnd(-40, this.h) : rnd(-140, -30),
      z: rnd(0.55, 1),
      vy: vy,
      bvy: vy,
      rot: rnd(0, TAU),
      spin: rnd(-0.03, 0.03),
      seed: rnd(0, 99),
      kind: this.options.witchHat && Math.random() < 0.31 ? 'hat' : 'pump'
    };
  }

  updatePumpkin(p, timeStep) {
    const t = this.boom;
    if (t.v > 0) {
      const dx = p.x - t.x;
      const dy = p.y - t.y;
      const dist = Math.hypot(dx, dy) || 1;
      if (dist < 220) {
        p.vy = -rnd(2.5, 4.5) * t.v;
        p.x += (dx / dist) * 4;
        p.spin = rnd(-0.15, 0.15);
      }
    }
    p.vy += (p.bvy - p.vy) * Math.min(1, 0.02 * timeStep);
    p.y += p.vy * p.z * timeStep;
    p.x += 0.35 * Math.sin(0.0012 * this.clk + p.seed) * timeStep;
    p.rot += p.spin * timeStep * 2;
    if (p.y > this.h + 40) {
      Object.assign(p, this.spawnPumpkin(false));
    }
  }

  drawPumpkin(p) {
    const ctx = this.ctx;
    if (p.kind === 'hat') {
      blit(ctx, hatSprite(), p.x, p.y, 0.656 * p.z * this.ds, p.rot, 1);
    } else {
      blit(ctx, pumpkinSprite(true), p.x, p.y, 0.576 * p.z * this.ds, p.rot, 1);
    }
  }

  drawCursor(dt) {
    const e = this.cur;
    const canvas = this.cursorCanvas;
    if (!e || !canvas) return;
    canvas.style.display = e.on ? 'block' : 'none';
    if (!e.on) return;

    const isDown = e.down || performance.now() < e.holdUntil;
    e.g += ((isDown ? 1 : 0) - e.g) * Math.min(1, 18 * dt);
    e.hv += ((e.hover ? 1 : 0) - e.hv) * Math.min(1, 12 * dt);
    e.idle += 1000 * dt;

    const deltaX = (e.x - e.lx) / Math.max(dt, 0.001);
    e.lx = e.x;
    const targetRot = this.reduced ? 0 : clamp(0.0005 * deltaX, -0.3, 0.3);
    e.rot += (targetRot - e.rot) * Math.min(1, 10 * dt);

    const grasp = Math.max(e.g, e.hv * (0.5 + 0.5 * Math.sin(0.009 * e.idle)) * 0.75);
    const ctx = this.cursorCtx;
    ctx.setTransform(this.cursorDpr, 0, 0, this.cursorDpr, 0, 0);
    ctx.clearRect(0, 0, 120, 100);
    drawBoneHand(ctx, e.rot, grasp, e.idle);
    canvas.style.transform = `translate3d(${e.x - 24}px, ${e.y - 40}px, 0)`;
  }

  flashLevel(age) {
    return age < 0.07 ? 1 : age < 0.15 ? 0.2 : age < 0.24 ? 0.85 : 0.6 * Math.max(0, 1 - (age - 0.24) / 0.55);
  }

  triggerLightning() {
    this.bolt.t = 0;
  }

  runLightning(dt, speedFactor) {
    const b = this.bolt;
    b.t -= dt * speedFactor;
    b.age += dt;
    if (b.t <= 0) {
      b.t = this.options.lightningEvery * rnd(0.6, 1.4);
      b.age = 0;
      const main = [];
      let curX = rnd(0.15, 0.85) * this.w;
      let curY = -5;
      const maxY = this.h * rnd(0.35, 0.6);
      main.push([curX, curY]);
      while (curY < maxY) {
        curY += rnd(10, 24);
        curX += rnd(-15, 15);
        main.push([curX, curY]);
      }
      const branch = [];
      const splitPoint = main[Math.floor(0.4 * main.length)];
      let bx = splitPoint[0], by = splitPoint[1];
      branch.push([bx, by]);
      for (let i = 0; i < 5; i++) {
        by += rnd(8, 18);
        bx += rnd(4, 16) * (Math.random() < 0.5 ? -1 : 1);
        branch.push([bx, by]);
      }
      b.lines = [main, branch];
    }
    if (b.age <= 0.8) {
      const ctx = this.ctx;
      const f = this.flashLevel(b.age);
      ctx.globalAlpha = 0.22 * f * 0.4;
      ctx.fillStyle = '#dfe4ff';
      ctx.fillRect(0, 0, this.w, this.h);
      if (b.lines) {
        ctx.save();
        ctx.globalAlpha = 0.25 * Math.min(1, 1.6 * f);
        ctx.strokeStyle = '#f4f6ff';
        ctx.shadowColor = '#b9c6ff';
        ctx.shadowBlur = 14;
        ctx.lineJoin = 'round';
        b.lines.forEach((line, idx) => {
          ctx.lineWidth = idx ? 1.4 : 2.6;
          ctx.beginPath();
          line.forEach((pt, pIdx) => {
            if (pIdx === 0) ctx.moveTo(pt[0], pt[1]);
            else ctx.lineTo(pt[0], pt[1]);
          });
          ctx.stroke();
        });
        ctx.restore();
      }
    }
  }

  loop(timestamp) {
    if (!this.ctx) return;
    const dt = Math.min(0.05, (timestamp - this.last) / 1000);
    this.last = timestamp;
    const speedFactor = this.options.speed * (this.reduced ? 0.3 : 1);
    const timeStep = 60 * dt * speedFactor;
    this.clk += 1000 * dt * speedFactor;

    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    if (this.options.pumpkins) {
      const arr = this.parts.pumpkins;
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i];
        this.updatePumpkin(p, timeStep);
        this.drawPumpkin(p);
      }
    }

    ctx.globalAlpha = 1;
    if (this.options.lightning && !this.reduced) {
      this.runLightning(dt, speedFactor);
    }

    this.drawCursor(dt);

    if (this.boom.v > 0) {
      this.boom.v = Math.max(0, this.boom.v - 2.4 * dt);
    }

    this.rafId = requestAnimationFrame(this.loop);
  }

  start() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.last = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  onVisibilityChange() {
    if (document.hidden) {
      if (this.rafId) cancelAnimationFrame(this.rafId);
      this.rafId = null;
    } else if (this.canvas) {
      this.start();
    }
  }

  destroy() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('pointerdown', this.onPointerDown);
    if (this.onPointerMove) {
      window.removeEventListener('pointermove', this.onPointerMove);
      window.removeEventListener('pointerup', this.onPointerUp);
      document.documentElement.removeEventListener('mouseleave', this.onMouseLeave);
    }
    document.documentElement.classList.remove('halloween-bone-cursor');
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    if (this.cursorCanvas && this.cursorCanvas.parentNode) this.cursorCanvas.parentNode.removeChild(this.cursorCanvas);
    this.ctx = null;
    this.canvas = null;
  }
}
