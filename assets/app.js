/* Companion page: synced video groups, one per figure. The first video of a group (always the real clip) is the clock;
   the others follow it. Groups play only while on screen. */
(function () {
  "use strict";
  const D = window.DATA, FPS = 20;
  const $ = (s, r = document) => r.querySelector(s);
  const h = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") e.className = v; else if (k === "html") e.innerHTML = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c));
    return e;
  };
  const poster = (src) => src.replace(/_err\.mp4$/, ".mp4").replace(/\.mp4$/, ".jpg");
  const ENV = { abc: "Robot manipulation", egodex: "Human manipulation", driving: "Driving", re10k: "Indoor navigation" };

  /* ------------------------------------------------------------------ sync engine */
  class Sync {
    constructor(frames = 136, ctx = 40) { this.v = []; this.frames = frames; this.ctx = ctx; this.fns = []; this.visible = false; this.userPaused = false; this.rate = 1; this.raf = 0; }
    add(v) { v.muted = true; v.playsInline = true; v.loop = true; v.preload = "none"; v.setAttribute("muted", ""); this.v.push(v); return v; }
    on(fn) { this.fns.push(fn); }
    emit(t) { for (const f of this.fns) f(t, this); }
    load() { for (const v of this.v) if (!v.getAttribute("src") && v.dataset.src) { v.src = v.dataset.src; } }
    play() {
      this.load();
      for (const v of this.v) { v.playbackRate = this.rate; const p = v.play(); if (p) p.catch(() => {}); }
      this.loop();
    }
    pause() { for (const v of this.v) v.pause(); this.emit(this.v[0] ? this.v[0].currentTime : 0); }
    seek(t) { for (const v of this.v) { try { v.currentTime = t; } catch (_) {} } this.emit(t); }
    setRate(r) { this.rate = r; for (const v of this.v) v.playbackRate = r; }
    swap(v, src) {   // change one follower's source while keeping the clock
      const m = this.v[0]; v.dataset.src = src;
      if (!v.getAttribute("src")) return;
      v.src = src; v.addEventListener("loadeddata", () => { try { v.currentTime = m.currentTime; } catch (_) {} if (!m.paused) v.play().catch(() => {}); }, { once: true });
    }
    loop() {
      if (this.raf) return;
      const step = () => {
        this.raf = 0; const m = this.v[0]; if (!m) return;
        const t = m.currentTime;
        for (let i = 1; i < this.v.length; i++) {
          const v = this.v[i];
          if (v.readyState >= 2 && Math.abs(v.currentTime - t) > 0.09) { try { v.currentTime = t; } catch (_) {} }
          if (!m.paused && v.paused && v.readyState >= 2) v.play().catch(() => {});
        }
        this.emit(t);
        if (!m.paused && this.visible) this.raf = requestAnimationFrame(step);
      };
      this.raf = requestAnimationFrame(step);
    }
    destroy() { this.pause(); cancelAnimationFrame(this.raf); for (const v of this.v) { v.removeAttribute("src"); v.load(); } this.v = []; this.fns = []; }
  }

  // one observer for every group container: play when visible, pause when not
  const slots = new Map();
  const io = new IntersectionObserver((es) => {
    for (const e of es) {
      const s = slots.get(e.target); if (!s) continue;
      s.visible = e.isIntersecting; const g = s.sync; if (!g) continue;
      g.visible = s.visible;
      if (s.visible && !g.userPaused) g.play(); else g.pause();
    }
  }, { rootMargin: "120px 0px", threshold: 0.05 });
  function mount(container, sync) {
    let s = slots.get(container);
    if (!s) { s = { visible: false, sync: null }; slots.set(container, s); io.observe(container); }
    if (s.sync) s.sync.destroy();
    s.sync = sync; sync.visible = s.visible;
    if (s.visible) sync.play();
    return sync;
  }

  /* ------------------------------------------------------------------ building blocks */
  function video(src) { return h("video", { "data-src": src, poster: poster(src), muted: true, playsinline: true, loop: true, preload: "none", "aria-hidden": "true" }); }

  function phaseBadge(sync, real = false) {
    const b = h("span", { class: "phase" }, "context");
    sync.on((t) => {
      const f = Math.min(sync.frames - 1, Math.floor(t * FPS + 1e-3));
      if (f < sync.ctx) { b.className = "phase"; b.textContent = "context"; }
      else { b.className = real ? "phase" : "phase gen"; b.textContent = `${real ? "real" : "generated"} +${((f - sync.ctx + 1) / FPS).toFixed(1)} s`; }
    });
    return b;
  }

  function tile(sync, { src, label, cls = "", badges = [], missing = null, sub = null }) {
    if (missing) return h("div", { class: "tile missing" }, h("div", { class: "frame" }, missing), h("div", { class: "cap" }, h("span", { class: "name" }, label)));
    const v = sync.add(video(src));
    const fr = h("div", { class: "frame" }, v, phaseBadge(sync, /\breal\b/.test(cls)));
    fr.addEventListener("click", () => toggle(sync));
    const t = h("div", { class: "tile " + cls }, fr, h("div", { class: "cap" }, h("span", { class: "name" }, label), sub, ...badges));
    t._video = v;
    return t;
  }
  function badge(text, cls = "") { return h("span", { class: "badge " + cls }, text); }

  function wipe(sync, { base, over, lBase, lOver, start = 50, sweep = false, cBase = "" }) {
    const vb = sync.add(video(base)), vo = sync.add(video(over));
    vo.classList.add("over");
    const fr = h("div", { class: "frame wipe" }, vb, vo, h("div", { class: "handle" }),
      h("span", { class: "corner l2 " + cBase }, lBase), h("span", { class: "corner r2" }, lOver), phaseBadge(sync));
    const set = (p) => fr.style.setProperty("--x", Math.max(0, Math.min(100, p)) + "%");
    set(start);
    let drag = false, moved = false;
    const at = (e) => { const r = fr.getBoundingClientRect(); set(100 * (e.clientX - r.left) / r.width); };
    fr.addEventListener("pointerdown", (e) => { drag = true; moved = false; fr.setPointerCapture(e.pointerId); at(e); });
    fr.addEventListener("pointermove", (e) => { if (drag) { moved = true; at(e); } });
    fr.addEventListener("pointerup", () => { drag = false; });
    fr.addEventListener("keydown", (e) => {
      const cur = parseFloat(fr.style.getPropertyValue("--x")) || 50;
      if (e.key === "ArrowLeft") set(cur - 5); if (e.key === "ArrowRight") set(cur + 5);
    });
    fr.tabIndex = 0; fr.setAttribute("aria-label", `Comparison slider: ${lBase} versus ${lOver}`);
    if (sweep) {   // one-time reveal: the divider sweeps in from the right
      const ob = new IntersectionObserver(([e]) => {
        if (!e.isIntersecting) return; ob.disconnect();
        if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const t0 = performance.now(), dur = 1600;
        const an = (now) => { const k = Math.min(1, (now - t0) / dur), ease = 1 - Math.pow(1 - k, 3); set(96 - (96 - start) * ease); if (k < 1 && !drag) requestAnimationFrame(an); };
        set(96); requestAnimationFrame(an);
      }, { threshold: .4 });
      ob.observe(fr);
    }
    return fr;
  }

  function toggle(sync) { sync.userPaused = !sync.userPaused; if (sync.userPaused) sync.pause(); else sync.play(); }

  const ICON_PLAY = '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 16 16"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z"/></svg>';
  function transport(sync) {
    const btn = h("button", { class: "pp", "aria-label": "Play or pause", html: ICON_PAUSE });
    const per = sync.frames > 200 ? FPS : 1;                  // one tick per frame, or per second for long clips
    const ctxW = 100 * sync.ctx / sync.frames;
    const fc = h("i", { class: "t-fill-c" }), fg = h("i", { class: "t-fill-g", style: `left:${ctxW}%` }), head = h("div", { class: "head" });
    const scrub = h("div", { class: "scrub", role: "slider", "aria-label": "Seek", tabindex: "0" },
      h("div", { class: "ticks", style: `--tick:${100 * per / sync.frames}%` },
        h("i", { class: "t-ctx", style: `width:${ctxW}%` }), h("i", { class: "t-gen", style: `left:${ctxW}%` }), fc, fg), head);
    const lab = h("span", { class: "tlabel" });
    btn.onclick = () => toggle(sync);
    const dur = sync.frames / FPS;
    let seeking = false;
    const seekAt = (e) => { const r = scrub.getBoundingClientRect(); const k = Math.max(0, Math.min(.999, (e.clientX - r.left) / r.width)); sync.seek(k * dur); };
    scrub.addEventListener("pointerdown", (e) => { seeking = true; scrub.setPointerCapture(e.pointerId); sync.pause(); seekAt(e); });
    scrub.addEventListener("pointermove", (e) => { if (seeking) seekAt(e); });
    scrub.addEventListener("pointerup", () => { seeking = false; if (!sync.userPaused) sync.play(); });
    scrub.addEventListener("keydown", (e) => {
      const t = sync.v[0].currentTime;
      if (e.key === "ArrowRight") sync.seek(Math.min(dur - .05, t + 1 / FPS)); if (e.key === "ArrowLeft") sync.seek(Math.max(0, t - 1 / FPS));
      if (e.key === " ") { e.preventDefault(); toggle(sync); }
    });
    sync.on((t) => {
      const k = 100 * Math.min(1, t / dur);
      head.style.left = k + "%"; fc.style.width = Math.min(k, ctxW) + "%"; fg.style.width = Math.max(0, k - ctxW) + "%";
      const f = Math.min(sync.frames - 1, Math.floor(t * FPS + 1e-3));
      lab.textContent = f < sync.ctx ? `context frame ${f + 1} of ${sync.ctx}` : `generated ${((f - sync.ctx + 1) / FPS).toFixed(2)} s`;
      btn.innerHTML = sync.v[0].paused ? ICON_PLAY : ICON_PAUSE;
    });
    return h("div", { class: "transport" }, btn, scrub, lab);
  }

  function chips(root, items, cur, onpick) {
    root.innerHTML = "";
    items.forEach((it, i) => {
      const b = h("button", { "aria-pressed": String(i === cur) }, it.label, it.sub ? h("span", { class: "sub" }, it.sub) : null);
      b.onclick = () => { root.querySelectorAll("button").forEach((x, j) => x.setAttribute("aria-pressed", String(j === i))); onpick(i); };
      root.append(b);
    });
  }
  function metricBadges(it, { fvdBest, lat = true, fid = false, arr = false } = {}) {
    const out = [];
    if (it.fvd != null) out.push(badge(`FVD ${it.fvd.toFixed(it.fvd < 100 ? 1 : 0)}`, it.fvd === fvdBest ? "best" : ""));
    if (fid && it.fid != null) out.push(badge(`FID ${it.fid.toFixed(1)}`));
    if (arr && it.arr != null) out.push(badge(`ARR ${it.arr.toFixed(2)}`));
    if (lat && it.lat != null) out.push(badge(`${it.lat} ms`));
    return out;
  }
  const isOurs = (it) => /CADRE|AE compresses|τ =|tokens/.test(it.label);

  /* ------------------------------------------------------------------ hero: four environments, real vs generated */
  (function hero() {
    const root = $("#hero-reel");
    for (const e of D.envs) {
      const c = e.clips[0], holder = h("div", { class: "tile ours" }), sync = new Sync();
      // wipe() adds the base (real) first, so the real clip is the clock
      const fr = wipe(sync, { base: c.real, over: c.roll, lBase: "real", lOver: "generated", start: 50, sweep: true, cBase: "real" });
      holder.append(fr, h("div", { class: "cap" }, h("span", { class: "name" }, e.name), badge(`CADRE ${e.geo}`)));
      root.append(holder);
      mount(holder, sync);
    }
  })();

  /* ------------------------------------------------------------------ chunk demo */
  (function chunkDemo() {
    const LAT = { 1: 226, 2: 269, 4: 379, 8: 606 }, N = 24;
    const pick = $("#tau-pick"), la = $("#lane-act"), ll = $("#lane-lat"), ld = $("#lane-dec");
    let tau = 4, f = 0, timer = null;
    const acts = [], decs = [];
    for (let i = 0; i < N; i++) { const a = h("div", { class: "c act" }); la.append(a); acts.push(a); const d = h("div", { class: "c dec" }); ld.append(d); decs.push(d); }
    function layout() {
      ll.innerHTML = "";
      for (let i = 0; i < N; i += tau) ll.append(h("div", { class: "blk", style: `grid-column: span ${tau}` }, tau === 1 ? "" : `z${i / tau}`));
      const wait = tau * 50, gen = LAT[tau] - wait;
      $("#lat-wait").textContent = `${wait} ms`; $("#lat-gen").textContent = `${gen} ms`; $("#lat-tot").textContent = `${LAT[tau]} ms`;
      $("#bar-wait").style.width = `${100 * wait / 650}%`; $("#bar-gen").style.width = `${100 * gen / 650}%`;
      f = 0;
    }
    const COMP = 3;   // world model + decode, in frame ticks (~170 ms at 20 fps)
    function tick() {
      const blocks = ll.children;
      acts.forEach((a, i) => { a.classList.toggle("on", i <= f); a.classList.toggle("now", i === f); });
      for (let b = 0; b < blocks.length; b++) {
        const end = (b + 1) * tau - 1;
        blocks[b].className = "blk" + (f >= end + COMP ? " done" : f >= b * tau ? " wait" : "");
      }
      decs.forEach((d, i) => { const end = (Math.floor(i / tau) + 1) * tau - 1; d.classList.toggle("on", f >= end + COMP); });
      f = f + 1; if (f > N + COMP + 3) f = 0;
    }
    chips(pick, [1, 2, 4, 8].map((t) => ({ label: `τ = ${t}` })), 2, (i) => { tau = [1, 2, 4, 8][i]; layout(); tick(); });
    layout();
    const ob = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !timer) timer = setInterval(tick, 190);
      else if (!e.isIntersecting && timer) { clearInterval(timer); timer = null; }
    });
    ob.observe($("#chunk-demo"));
  })();

  /* ------------------------------------------------------------------ environments */
  (function envs() {
    const tabs = $("#env-tabs"), player = $("#env-player"), thumbs = $("#env-thumbs");
    let ei = 0, ci = 0;
    function show() {
      const e = D.envs[ei], c = e.clips[ci];
      player.innerHTML = "";
      const sync = new Sync();
      const real = tile(sync, { src: c.real, label: "Real", cls: "real" });
      const gen = tile(sync, { src: c.roll, label: "Generated", cls: "ours", badges: [badge(`CADRE ${c.geo || e.geo}, 2 steps`)] });
      player.append(h("div", { class: "grid g2" }, gen, real), transport(sync));
      mount(player, sync);
      thumbs.innerHTML = "";
      e.clips.forEach((cc, j) => {
        const b = h("button", { class: "thumb", "aria-pressed": String(j === ci), "aria-label": `Clip ${j + 1}` },
          h("img", { src: poster(cc.roll), alt: "", loading: "lazy" }), h("span", {}, j === 0 ? "paper figure" : `clip ${j + 1}`));
        b.onclick = () => { ci = j; show(); };
        thumbs.append(b);
      });
    }
    chips(tabs, D.envs.map((e) => ({ label: e.name })), 0, (i) => { ei = i; ci = 0; show(); });
    show();
  })();

  /* ------------------------------------------------------------------ decoder */
  (function decoder() {
    const tabs = $("#dec-tabs"), player = $("#dec-player");
    function show(i) {
      const g = D.decoder[i], [mira, one, two] = g.items;
      player.innerHTML = "";
      const sync = new Sync();
      const realT = tile(sync, { src: g.real, label: "Real", cls: "real" });
      const big = wipe(sync, { base: mira.src, over: two.src, lBase: "MIRA, regression", lOver: "CADRE, diffusion in 2 steps", start: 50 });
      const bigT = h("div", { class: "tile" }, big, h("div", { class: "cap" }, h("span", { class: "name" }, `${ENV[g.env]}, both at 2×32×32`),
        badge(`MIRA FVD ${mira.fvd.toFixed(0)}`, "worst"), badge(`CADRE FVD ${two.fvd.toFixed(0)}`, "best")));
      const row = h("div", { class: "grid g4", style: "margin-top:12px" }, realT,
        tile(sync, { src: mira.src, label: "MIRA, regression", badges: metricBadges(mira, { fid: true, lat: true }) }),
        tile(sync, { src: one.src, label: "CADRE, 1 step", cls: "ours", badges: metricBadges(one, { fid: true, lat: true }) }),
        tile(sync, { src: two.src, label: "CADRE, 2 steps", cls: "ours", badges: metricBadges(two, { fid: true, lat: true }) }));
      player.append(bigT, row, transport(sync));
      sync.v = [realT._video, ...sync.v.filter((v) => v !== realT._video)];
      mount(player, sync);
    }
    chips(tabs, D.decoder.map((g) => ({ label: g.tag, sub: ENV[g.env] })), 0, show);
    show(0);
  })();

  /* ------------------------------------------------------------------ baselines */
  (function baselines() {
    const tabs = $("#bl-tabs"), player = $("#bl-player");
    function show(i) {
      const g = D.baselines[i];
      player.innerHTML = "";
      const sync = new Sync();
      const best = Math.min(...g.items.filter((x) => x.fvd != null).map((x) => x.fvd));
      const tiles = [tile(sync, { src: g.real, label: "Real", cls: "real" })];
      for (const it of g.items) {
        tiles.push(it.missing
          ? tile(sync, { label: it.label, missing: g.env === "egodex" ? "not trained on EgoDex" : "no sample of this episode" })
          : tile(sync, { src: it.src, label: it.label.replace(", 2 steps", ""), cls: isOurs(it) ? "ours" : "", badges: metricBadges(it, { fvdBest: best }) }));
      }
      player.append(h("div", { class: "grid g4" }, tiles), transport(sync));
      mount(player, sync);
    }
    chips(tabs, D.baselines.map((g) => ({ label: g.tag })), 0, show);
    show(0);
  })();

  /* ------------------------------------------------------------------ counterfactual actions */
  (function actions() {
    const tabs = $("#cf-tabs"), player = $("#cf-player");
    const SUB = { gt: "the clip's own actions", hold: "zero deltas from frame 40", transplant: "replayed from a different episode",
      yaw_neg: "constant yaw, clip's own speed", yaw_pos: "constant yaw, clip's own speed" };
    function show(i) {
      const g = D.actions[i];
      player.innerHTML = "";
      const sync = new Sync();
      const realT = tile(sync, { src: g.real, label: "Real video", cls: "real", sub: h("small", {}, "context, then the recorded future") });
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "cf-svg"); svg.setAttribute("viewBox", "0 0 70 300"); svg.setAttribute("preserveAspectRatio", "none");
      for (const y of [50, 150, 250]) { const p = document.createElementNS(svg.namespaceURI, "path"); p.setAttribute("d", `M0 150 C 35 150, 35 ${y}, 70 ${y}`); p.setAttribute("vector-effect", "non-scaling-stroke"); svg.append(p); }
      const br = h("div", { class: "cf-branches" }, g.items.map((it) => {
        const t = tile(sync, { src: it.src, label: it.label, cls: it.kind === "gt" ? "ours" : "", sub: h("small", {}, SUB[it.kind] || "") });
        return t;
      }));
      sync.on((t) => svg.classList.toggle("live", t * FPS >= sync.ctx));
      player.append(h("div", { class: "cf-wrap" }, realT, svg, br), transport(sync));
      mount(player, sync);
    }
    const nth = {};
    chips(tabs, D.actions.map((g) => { nth[g.env] = (nth[g.env] || 0) + 1; return { label: g.name, sub: String(nth[g.env]) }; }), 0, show);
    show(0);
  })();

  /* ------------------------------------------------------------------ AE vs WM temporal compression */
  (function placement() {
    let tau = 2, ep = 0; const err = $("#pl-err"), player = $("#pl-player");
    const PAIR = { 0: [0, 1], 1: [2, 3], 2: [4, 5] };
    let cur = null;
    function show() {
      const g = D.placement[ep], ti = [2, 4, 8].indexOf(tau), [ae, wm] = PAIR[ti].map((k) => g.items[k]);
      player.innerHTML = "";
      const sync = new Sync();
      const realT = tile(sync, { src: g.real, label: "Real", cls: "real" });
      const aT = tile(sync, { src: err.checked ? ae.diff : ae.src, label: `Autoencoder packs ${tau} frames`, cls: "ours", badges: metricBadges(ae, { fid: true, arr: true, lat: false, fvdBest: Math.min(ae.fvd, wm.fvd) }) });
      const wT = tile(sync, { src: err.checked ? wm.diff : wm.src, label: `World model patches ${tau} frames`, badges: metricBadges(wm, { fid: true, arr: true, lat: false, fvdBest: Math.min(ae.fvd, wm.fvd) }) });
      player.append(h("div", { class: "grid g3" }, realT, aT, wT), transport(sync));
      cur = { sync, pairs: [[aT._video, ae], [wT._video, wm]] };
      mount(player, sync);
    }
    chips($("#pl-tau"), [2, 4, 8].map((t) => ({ label: `τ = ${t}` })), 0, (i) => { tau = [2, 4, 8][i]; show(); });
    chips($("#pl-ep"), D.placement.map((g) => ({ label: g.tag })), 0, (i) => { ep = i; show(); });
    err.onchange = () => { for (const [v, it] of cur.pairs) cur.sync.swap(v, err.checked ? it.diff : it.src); };
    show();
  })();

  /* ------------------------------------------------------------------ tau sweep with frame-change plot */
  (function tauSweep() {
    const tabs = $("#tau-tabs"), player = $("#tau-player");
    const COL = { 1: "#9aa6e8", 2: "#5d71e6", 4: "#2338c4", 8: "#d0452f" };
    function show(i) {
      const g = D.tau[i];
      player.innerHTML = "";
      const sync = new Sync();
      const taus = g.items.map((it) => +it.label.match(/τ = (\d)/)[1]);
      const best = Math.min(...g.items.map((x) => x.fvd));
      const realT = tile(sync, { src: g.real, label: "Real", cls: "real" });
      const tiles = g.items.map((it, k) => {
        const t = tile(sync, { src: it.src, label: it.label.split(", ")[0], cls: "ours", sub: badge(it.label.split(", ")[1]), badges: metricBadges(it, { fvdBest: best }) });
        const nm = t.querySelector(".name"); nm.style.color = "var(--ink)"; nm.style.boxShadow = `inset 4px 0 0 ${COL[taus[k]]}`; nm.style.paddingLeft = "10px";
        t.addEventListener("mouseenter", () => { hover = taus[k]; draw(); });
        return t;
      });
      const cols = g.items.length + 1 <= 4 ? "g4" : "g3";
      const cv = h("canvas", { role: "img", "aria-label": "Mean absolute change between consecutive generated frames, per temporal compression" });
      const legend = h("div", { class: "legend" },
        g.items.map((it, k) => h("span", { onmouseenter: () => { hover = taus[k]; draw(); } }, h("i", { style: `background:${COL[taus[k]]}` }), `τ = ${taus[k]}`)),
        h("span", {}, h("i", { style: "background:var(--real);height:2px" }), "Real video"),
        h("span", { style: "color:var(--ink-3)" }, "Ticks: chunk boundaries of the highlighted τ"));
      const chart = h("div", { class: "card chart" }, h("div", { class: "ch-t" }, "Change between consecutive frames over the 96 generated frames"), cv, legend);
      player.append(h("div", { class: "grid " + cols }, realT, tiles), transport(sync), chart);
      let hover = Math.max(...taus), tnow = 0;
      const series = g.items.map((it) => it.d.slice(1)), real = g.d_real.slice(1);
      const ymax = Math.max(...series.flat(), ...real) * 1.08;
      function draw() {
        const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
        if (!W) return;
        cv.width = W * dpr; cv.height = H * dpr;
        const c = cv.getContext("2d"); c.scale(dpr, dpr); c.clearRect(0, 0, W, H);
        const L = 34, R = 8, T = 8, B = 20, n = real.length;
        const X = (j) => L + (W - L - R) * (j) / (n - 1), Y = (v) => T + (H - T - B) * (1 - v / ymax);
        const css = getComputedStyle(document.documentElement);
        c.font = "12px Archivo, sans-serif"; c.fillStyle = css.getPropertyValue("--ink-3");
        c.strokeStyle = css.getPropertyValue("--rule"); c.lineWidth = 1;
        c.beginPath(); c.moveTo(L, H - B); c.lineTo(W - R, H - B); c.stroke();
        for (const s of [0, 1.2, 2.4, 3.6, 4.8]) { const j = s * FPS - 1; c.fillText(`${s}s`, Math.min(W - R - 18, X(Math.max(0, j)) - 6), H - 5); }
        c.save(); c.setLineDash([2, 3]); c.strokeStyle = COL[hover]; c.globalAlpha = .55;
        for (let j = hover - 1; j < n; j += hover) { c.beginPath(); c.moveTo(X(j), T); c.lineTo(X(j), H - B); c.stroke(); }
        c.restore();
        const line = (arr, col, w, a = 1, dash = null) => {
          c.save(); c.globalAlpha = a; c.strokeStyle = col; c.lineWidth = w; if (dash) c.setLineDash(dash);
          c.beginPath(); arr.forEach((v, j) => (j ? c.lineTo(X(j), Y(v)) : c.moveTo(X(j), Y(v)))); c.stroke(); c.restore();
        };
        line(real, css.getPropertyValue("--real"), 1.5, .9, [4, 3]);
        series.forEach((s, k) => line(s, COL[taus[k]], taus[k] === hover ? 2.2 : 1.2, taus[k] === hover ? 1 : .35));
        const gj = tnow * FPS - sync.ctx;   // cursor over generated frames
        if (gj >= 0) { c.strokeStyle = css.getPropertyValue("--ink"); c.lineWidth = 1; c.beginPath(); c.moveTo(X(Math.min(n - 1, gj)), T); c.lineTo(X(Math.min(n - 1, gj)), H - B); c.stroke(); }
        c.fillText("Δ", 6, T + 10);
      }
      let last = -1;
      sync.on((t) => { tnow = t; const f = Math.floor(t * FPS); if (f !== last) { last = f; draw(); } });
      new ResizeObserver(draw).observe(cv);
      mount(player, sync);
      draw();
    }
    chips(tabs, D.tau.map((g) => ({ label: g.tag })), 0, show);
    show(0);
  })();

  /* ------------------------------------------------------------------ spatial tokens */
  (function spatial() {
    let pair = 0, ep = 0; const err = $("#sp-err"), player = $("#sp-player");
    let cur = null;
    function show() {
      const g = D.spatial[ep], [fine, coarse] = [g.items[pair * 2], g.items[pair * 2 + 1]];
      player.innerHTML = "";
      const sync = new Sync();
      const realT = tile(sync, { src: g.real, label: "Real", cls: "real" });
      const best = Math.min(fine.fvd, coarse.fvd);
      const fT = tile(sync, { src: err.checked ? fine.diff : fine.src, label: fine.label, cls: "ours", badges: metricBadges(fine, { fid: true, arr: true, lat: false, fvdBest: best }) });
      const cT = tile(sync, { src: err.checked ? coarse.diff : coarse.src, label: coarse.label, badges: metricBadges(coarse, { fid: true, arr: true, lat: false, fvdBest: best }) });
      player.append(h("div", { class: "grid g3" }, realT, fT, cT), transport(sync),
        h("p", { class: "note" }, "One-step decode. The error map is |generated − real|, amplified 3×. Bright regions mark where the rollout departs from the recorded future."));
      cur = { sync, pairs: [[fT._video, fine], [cT._video, coarse]] };
      mount(player, sync);
    }
    chips($("#sp-pair"), [{ label: "τ = 4, s = 16 or 24" }, { label: "τ = 2, s = 16 or 32" }], 0, (i) => { pair = i; show(); });
    chips($("#sp-ep"), D.spatial.map((g) => ({ label: g.tag })), 0, (i) => { ep = i; show(); });
    err.onchange = () => { for (const [v, it] of cur.pairs) cur.sync.swap(v, err.checked ? it.diff : it.src); };
    show();
  })();

  /* ------------------------------------------------------------------ long rollouts */
  (function long() {
    let ep = 0, rate = 2; const player = $("#lg-player");
    function show() {
      const g = D.long[ep];
      player.innerHTML = "";
      const sync = new Sync(1320, 40); sync.rate = rate;
      const best = Math.min(...g.items.map((x) => x.fvd1280));
      const tiles = [tile(sync, { src: g.real, label: "Real", cls: "real" })].concat(g.items.map((it) =>
        tile(sync, { src: it.src, label: it.label, cls: /CADRE/.test(it.label) ? "ours" : "", badges: [badge(`FVD ${it.fvd1280} at 64 s`, it.fvd1280 === best ? "best" : "")] })));
      player.append(h("div", { class: "grid g3" }, tiles), transport(sync));
      mount(player, sync);
    }
    chips($("#lg-ep"), D.long.map((g) => ({ label: g.tag })), 0, (i) => { ep = i; show(); });
    chips($("#lg-speed"), [1, 2, 4].map((r) => ({ label: `${r}×` })), 1, (i) => { rate = [1, 2, 4][i]; const s = slots.get(player); if (s && s.sync) s.sync.setRate(rate); });
    show();
  })();

  /* ------------------------------------------------------------------ rail */
  const links = [...document.querySelectorAll(".rail a[href^='#']")];
  const secs = links.map((a) => document.querySelector(a.getAttribute("href"))).filter(Boolean);
  const railIO = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) links.forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#" + e.target.id && e.target.id !== "top"));
  }, { rootMargin: "-40% 0px -55% 0px" });
  secs.forEach((s) => railIO.observe(s));
})();
