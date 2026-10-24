/**
 * The slime trim, drips and corner pumpkins of the nknnull.sbs Halloween bundle (its HalloweenEdgeDecor), on
 * any box of this site. The bundle drew them once for the whole page box; here every box that matches a
 * selector gets its own canvas, laid inside the box (and `above` pixels over its top edge, for pumpkins to
 * stand in), so the slime scrolls with the box.
 *
 *   const edges = new HalloweenSlimeEdges();   // starts at once, and picks up boxes that show up later
 *   edges.destroy();
 */
import { TAU, rnd, clamp, blit, pumpkinSprite } from "./halloween-fx";

const EDGE_TARGETS = [
  // The banner on the home page: slime with a pumpkin at each end, standing on it.
  { selector: ".homepage-banner-carousel", above: 70, pumpkins: true, maxScale: 1.25 },
  // The action cards under it: slime only, smaller.
  { selector: ".quick-grid a", above: 0, pumpkins: false, maxScale: 0.8 }
];

export class HalloweenSlimeEdges {
  constructor(targets = EDGE_TARGETS) {
    this.targets = targets;
    this.edges = new Map();
    this.clk = 0;
    this.last = performance.now();
    this.reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.loop = this.loop.bind(this);
    this.scan = this.scan.bind(this);
    this.onVisibilityChange = this.onVisibilityChange.bind(this);
    this.scan();
    // The page renders its boxes whenever it likes, so look for new ones (and forget gone ones) now and then.
    this.timer = window.setInterval(this.scan, 1000);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.rafId = requestAnimationFrame(this.loop);
  }

  scan() {
    for (const [el, edge] of [...this.edges]) {
      if (!el.isConnected) this.removeEdge(el, edge);
    }
    for (const target of this.targets) {
      document.querySelectorAll(target.selector).forEach((el) => {
        if (!this.edges.has(el)) this.addEdge(el, target);
      });
    }
  }

  addEdge(el, target) {
    const canvas = document.createElement("canvas");
    canvas.className = "halloween-edge-canvas";
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText = `position:absolute;left:0;top:-${target.above}px;width:100%;pointer-events:none;z-index:6;`;
    el.appendChild(canvas);
    const edge = { el, canvas, ctx: canvas.getContext("2d"), above: target.above, pumpkins: target.pumpkins, maxScale: target.maxScale, drips: [], w: 0, h: 0, observer: null };
    edge.observer = new ResizeObserver(() => this.measure(edge));
    edge.observer.observe(el);
    this.edges.set(el, edge);
    this.measure(edge);
  }

  removeEdge(el, edge) {
    if (edge.observer) edge.observer.disconnect();
    if (edge.canvas.parentNode) edge.canvas.parentNode.removeChild(edge.canvas);
    this.edges.delete(el);
  }

  measure(edge) {
    const w = edge.el.clientWidth;
    const h = edge.above + edge.el.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!w || (w === edge.w && h === edge.h && dpr === edge.dpr)) return;
    edge.w = w;
    edge.h = h;
    edge.dpr = dpr;
    edge.canvas.width = Math.round(w * dpr);
    edge.canvas.height = Math.round(h * dpr);
    edge.canvas.style.height = `${h}px`;
    edge.ds = clamp(w / 380, 0.6, edge.maxScale);
    // Where the slime hangs from, and where a drop lands: the bottom of the box.
    edge.n = edge.above ? edge.above + 1 : 4;
    edge.ground = h - 2;
    const count = Math.round(6 * clamp(w / 370, 0.75, 1.6));
    while (edge.drips.length < count) edge.drips.push(this.spawnDrip(edge));
    edge.drips.length = count;
  }

  spawnDrip(edge) {
    const ds = edge.ds || 1;
    return {
      x: rnd(16, (edge.w || 300) - 16),
      len: 0,
      max: rnd(10, 40) * ds,
      sp: rnd(0.12, 0.3),
      w: rnd(3.5, 6.5) * ds,
      st: "grow",
      dy: 0,
      vy: 0,
      t: 0
    };
  }

  updateDrip(edge, p, dt, timeStep, speedFactor) {
    if (p.st === "grow") {
      p.len += p.sp * timeStep;
      if (p.len >= p.max) {
        p.st = "drop";
        p.dy = edge.n + p.len;
        p.vy = 0.4;
        p.len = 0.45 * p.max;
      }
    } else if (p.st === "drop") {
      p.vy += 0.14 * timeStep;
      p.dy += p.vy * timeStep;
      p.len = Math.max(0, p.len - 0.05 * timeStep);
      if (p.dy > edge.ground) {
        p.st = "splat";
        p.t = 0;
      }
    } else {
      p.t += dt * Math.max(speedFactor, 0.4) * 1.6;
      if (p.t > 1) Object.assign(p, this.spawnDrip(edge));
    }
  }

  drawTrim(edge) {
    const ctx = edge.ctx;
    const t = edge.ds;
    const n = edge.n;
    const r = 10;
    const o = edge.w - 10;
    const c = Math.max(4, Math.round((o - r) / 18));

    ctx.globalAlpha = 1;
    ctx.fillStyle = "#72e23c";
    ctx.shadowColor = "rgba(120,255,60,.6)";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(r, n - 3 * t);
    ctx.lineTo(o, n - 3 * t);
    for (let i = c - 1; i >= 0; i--) {
      const l = r + ((o - r) * (i + 1)) / c;
      const f = r + ((o - r) * i) / c;
      ctx.quadraticCurveTo((l + f) / 2, n + (5 + 2 * Math.sin(1.7 * i + 0.0012 * this.clk)) * t, f, n + 1.5 * t);
    }
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = "rgba(230,255,200,.65)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(14, n - 2 * t);
    ctx.lineTo(o - 4, n - 2 * t);
    ctx.stroke();
  }

  drawDrip(edge, p) {
    const ctx = edge.ctx;
    const t = edge.n;
    const n = p.w;
    const slimeColor = "#72e23c";

    ctx.globalAlpha = 1;
    ctx.fillStyle = slimeColor;

    if (p.len > 0) {
      ctx.beginPath();
      ctx.moveTo(p.x - n / 2, t);
      ctx.quadraticCurveTo(p.x - 0.3 * n, t + 0.6 * p.len, p.x - 0.45 * n, t + p.len);
      ctx.arc(p.x, t + p.len, 0.45 * n, Math.PI, 0, true);
      ctx.quadraticCurveTo(p.x + 0.3 * n, t + 0.6 * p.len, p.x + n / 2, t);
      ctx.fill();

      ctx.fillStyle = "rgba(235,255,210,.8)";
      ctx.beginPath();
      ctx.ellipse(p.x - 0.15 * n, t + p.len - 0.1 * n, 0.12 * n, 0.18 * n, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = slimeColor;
    }

    if (p.st === "drop") {
      ctx.beginPath();
      ctx.ellipse(p.x, p.dy, 0.38 * n, 0.55 * n, 0, 0, TAU);
      ctx.fill();
    }

    if (p.st === "splat") {
      ctx.globalAlpha = 1 - p.t;
      ctx.beginPath();
      ctx.ellipse(p.x, edge.ground - 1, n * (1 + 2 * p.t), 0.3 * n, 0, 0, TAU);
      ctx.fill();
    }
  }

  drawCornerPumpkins(edge) {
    const ctx = edge.ctx;
    const t = edge.ds;
    const flicker = 0.85 + 0.15 * Math.sin(0.011 * this.clk) * Math.sin(0.017 * this.clk);
    const extra = edge.above;
    const o = 24 * t;
    const c = extra - 9 * t;
    const f = edge.w - 30 * t;
    const d = extra - 11 * t;

    blit(ctx, pumpkinSprite(true), o, c, 0.95 * t, -0.06, flicker);
    blit(ctx, pumpkinSprite(true), f, d, 1.1 * t, 0.05, 1);
    blit(ctx, pumpkinSprite(false), f - 32 * t, d + 6 * t, 0.7 * t, -0.1, 1);
  }

  loop(timestamp) {
    const dt = Math.min(0.05, (timestamp - this.last) / 1000);
    this.last = timestamp;
    const speedFactor = this.reduced ? 0.3 : 1;
    const timeStep = 60 * dt * speedFactor;
    this.clk += 1000 * dt * speedFactor;

    for (const edge of this.edges.values()) {
      if (!edge.w) continue;
      // Boxes scrolled out of sight are not drawn.
      const rect = edge.el.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top - edge.above > window.innerHeight) continue;

      const ctx = edge.ctx;
      ctx.setTransform(edge.dpr, 0, 0, edge.dpr, 0, 0);
      ctx.clearRect(0, 0, edge.w, edge.h);
      this.drawTrim(edge);
      for (const p of edge.drips) {
        this.updateDrip(edge, p, dt, timeStep, speedFactor);
        this.drawDrip(edge, p);
      }
      ctx.globalAlpha = 1;
      if (edge.pumpkins) this.drawCornerPumpkins(edge);
    }
    this.rafId = requestAnimationFrame(this.loop);
  }

  onVisibilityChange() {
    if (document.hidden) {
      if (this.rafId) cancelAnimationFrame(this.rafId);
      this.rafId = null;
    } else if (!this.rafId) {
      this.last = performance.now();
      this.rafId = requestAnimationFrame(this.loop);
    }
  }

  destroy() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    window.clearInterval(this.timer);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    for (const [el, edge] of [...this.edges]) this.removeEdge(el, edge);
  }
}
