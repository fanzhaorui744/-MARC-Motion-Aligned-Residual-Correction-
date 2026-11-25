/* MARC Interactive Trajectory Observatory (Pure 2D + Comet Tail + Room & Rings) */
(() => {
  const GT_COLOR = '#0A0E17';
  const DATASET_FILES = {
    officeio: 'data/traj_officeio.json',
    ronin: 'data/traj_ronin.json',
    suiteinpp: 'data/traj_suiteinpp.json',
  };

  const state = {
    datasetKey: 'officeio',
    cache: {},
    benchData: null,
    activeBenchTab: 'officeio',
    seqIndex: 0,
    seq: null,
    showGT: true,
    activeMethods: new Set(['marc']),
    methodProgress: {},
    mode: 'overlay', // 'overlay' | 'split' | 'heatmap'
    cometTail: true,
    showTethers: true,
    showRoom: true,
    followCam: false,
    playing: true,
    speed: 1,
    progress: 0,
    lastTs: null,
    cam: { cx: 0, cy: 0, span: 20 },
    drag: { active: false, x: 0, y: 0, cx: 0, cy: 0 },
  };

  const el = {
    seqBar: document.getElementById('seqBar'),
    methodPills: document.getElementById('methodPills'),
    activeSeqTitle: document.getElementById('activeSeqTitle'),
    activeSeqSub: document.getElementById('activeSeqSub'),
    legendInline: document.getElementById('legendInline'),
    canvasWrap: document.getElementById('canvasWrap'),
    trajCanvas: document.getElementById('trajCanvas'),
    errCanvas: document.getElementById('errChartCanvas'),
    heatmapColorbar: document.getElementById('heatmapColorbar'),
    heatmapMaxLabel: document.getElementById('heatmapMaxLabel'),
    toggleComet: document.getElementById('toggleComet'),
    playPauseBtn: document.getElementById('playPauseBtn'),
    restartBtn: document.getElementById('restartBtn'),
    timeSlider: document.getElementById('timeSlider'),
    timeClock: document.getElementById('timeClock'),
    hudDist: document.getElementById('hudDist'),
    liveLeaderboard: document.getElementById('liveLeaderboard'),
    benchPanel: document.getElementById('benchPanel'),
    driftGrid: document.getElementById('driftGrid'),
    datasetGrid: document.getElementById('datasetGrid'),
    themeToggle: document.getElementById('themeToggle'),
  };

  function fmtTime(sec) {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  }

  function computeBounds(seq) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const addPts = (xs, ys) => {
      for (let i = 0; i < xs.length; i++) {
        const x = xs[i], y = ys[i];
        if (x !== null && y !== null && Number.isFinite(x) && Number.isFinite(y)) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    };
    addPts(seq.gt.x, seq.gt.y);
    for (const m of seq.methods) {
      addPts(m.x, m.y);
    }
    const cx = 0.5 * (minX + maxX);
    const cy = 0.5 * (minY + maxY);
    const span = Math.max(maxX - minX, maxY - minY, 6) * 1.18;
    return { cx, cy, span };
  }

  function resetCamera() {
    if (!state.seq) return;
    state.cam = computeBounds(state.seq);
  }

  async function loadDataset(key) {
    state.datasetKey = key;
    document.querySelectorAll('.ds-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.dataset === key);
    });
    if (!state.cache[key]) {
      const resp = await fetch(DATASET_FILES[key]);
      state.cache[key] = (await resp.json()).sequences;
    }
    // Auto-enable Comet Tail on OFFICEIO (long confined indoor walks); full path on RoNIN & Suite-IN++
    state.cometTail = key === 'officeio';
    el.toggleComet.classList.toggle('active', state.cometTail);
    state.seqIndex = 0;
    renderSequenceBar();
    selectSequence(0);
  }

  function renderSequenceBar() {
    const list = state.cache[state.datasetKey] || [];
    el.seqBar.innerHTML = '';
    list.forEach((seq, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `seq-pill${idx === state.seqIndex ? ' active' : ''}`;
      const shortTitle = seq.title.replace(' · ', ' ');
      btn.innerHTML = `<span>${shortTitle}</span><span class="pill-gain">${seq.headline_gain_pct.toFixed(0)}%</span>`;
      btn.addEventListener('click', () => selectSequence(idx));
      el.seqBar.appendChild(btn);
    });
  }

  function selectSequence(idx) {
    const list = state.cache[state.datasetKey] || [];
    if (!list[idx]) return;
    state.seqIndex = idx;
    state.seq = list[idx];

    state.showGT = true;
    state.activeMethods = new Set(state.seq.methods.map((m) => m.id));
    state.methodProgress = {};
    for (const m of state.seq.methods) {
      state.methodProgress[m.id] = 1.0;
    }

    state.progress = 0.0;
    state.playing = true;
    state.lastTs = null;
    updatePlayButtons();
    resetCamera();

    const preNote = state.seq.pre_pct !== undefined ? ` · PRE ${state.seq.pre_pct.toFixed(2)}%` : '';
    el.activeSeqTitle.textContent = `${state.seq.dataset} · ${state.seq.title}`;
    el.activeSeqSub.textContent = `${state.seq.path_len_m.toFixed(0)} m · ${(state.seq.duration_s / 60).toFixed(1)} min${preNote}`;

    document.querySelectorAll('.seq-pill').forEach((b, i) => b.classList.toggle('active', i === idx));
    renderMethodPills();
  }

  function renderMethodPills() {
    const seq = state.seq;
    if (!seq) return;
    el.methodPills.innerHTML = '';

    const gtBtn = document.createElement('button');
    gtBtn.type = 'button';
    gtBtn.className = `method-btn${state.showGT ? ' active' : ''}`;
    gtBtn.style.setProperty('--m-color', GT_COLOR);
    gtBtn.innerHTML = `
      <span class="method-swatch" style="background:${GT_COLOR}"></span>
      <span>Ground Truth</span>
    `;
    gtBtn.addEventListener('click', () => {
      state.showGT = !state.showGT;
      renderMethodPills();
    });
    el.methodPills.appendChild(gtBtn);

    seq.methods.forEach((m) => {
      const isOn = state.activeMethods.has(m.id);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `method-btn${isOn ? ' active' : ''}${m.is_ours ? ' is-ours' : ''}`;
      btn.style.setProperty('--m-color', m.color);
      btn.innerHTML = `
        <span class="method-swatch" style="background:${m.color}"></span>
        <span>${m.label}</span>
        <span class="method-ate">${m.ate_m.toFixed(2)}m</span>
      `;
      btn.addEventListener('click', () => {
        if (state.activeMethods.has(m.id)) {
          state.activeMethods.delete(m.id);
        } else {
          state.activeMethods.add(m.id);
          state.methodProgress[m.id] = state.progress > 0.05 ? 0.02 : 1.0;
        }
        renderMethodPills();
      });
      el.methodPills.appendChild(btn);
    });
  }

  function updatePlayButtons() {
    const playSvg = el.playPauseBtn.querySelector('.ic-play');
    const pauseSvg = el.playPauseBtn.querySelector('.ic-pause');
    playSvg.hidden = state.playing;
    pauseSvg.hidden = !state.playing;
  }

  function errorColor(errM, maxErr) {
    const t = Math.min(1, Math.max(0, errM / Math.max(1, maxErr)));
    let r, g, b;
    if (t < 0.5) {
      const k = t * 2;
      r = Math.round(0 + k * 245);
      g = Math.round(168 + k * (158 - 168));
      b = Math.round(132 + k * (11 - 132));
    } else {
      const k = (t - 0.5) * 2;
      r = Math.round(245 + k * (225 - 245));
      g = Math.round(158 + k * (29 - 158));
      b = Math.round(11 + k * (72 - 11));
    }
    return `rgb(${r},${g},${b})`;
  }

  function getViewportProjector(w, h, cam) {
    const scale = Math.min(w, h) / cam.span;
    return {
      scale,
      toPx: (wx, wy) => [
        w * 0.5 + (wx - cam.cx) * scale,
        h * 0.5 - (wy - cam.cy) * scale,
      ],
    };
  }

  function drawGridAndScale(ctx, x0, y0, w, h, cam) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, w, h);
    ctx.clip();

    ctx.fillStyle = '#FAFBFD';
    ctx.fillRect(x0, y0, w, h);

    const scale = Math.min(w, h) / cam.span;
    const rawStep = 90 / scale;
    const mag = Math.pow(10, Math.floor(Math.log10(Math.max(1e-3, rawStep))));
    const norm = rawStep / mag;
    const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;

    const minWx = cam.cx - (w * 0.5) / scale;
    const maxWx = cam.cx + (w * 0.5) / scale;
    const minWy = cam.cy - (h * 0.5) / scale;
    const maxWy = cam.cy + (h * 0.5) / scale;

    ctx.strokeStyle = '#E6ECF5';
    ctx.lineWidth = 1;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = '#94A3B8';

    const gx0 = Math.floor(minWx / step) * step;
    for (let gx = gx0; gx <= maxWx; gx += step) {
      const px = x0 + w * 0.5 + (gx - cam.cx) * scale;
      ctx.beginPath();
      ctx.moveTo(px, y0);
      ctx.lineTo(px, y0 + h);
      ctx.stroke();
      if (px > x0 + 26 && px < x0 + w - 26) {
        ctx.fillText(`${Math.round(gx * 10) / 10}m`, px + 3, y0 + h - 8);
      }
    }

    const gy0 = Math.floor(minWy / step) * step;
    for (let gy = gy0; gy <= maxWy; gy += step) {
      const py = y0 + h * 0.5 - (gy - cam.cy) * scale;
      ctx.beginPath();
      ctx.moveTo(x0, py);
      ctx.lineTo(x0 + w, py);
      ctx.stroke();
      if (py > y0 + 18 && py < y0 + h - 22) {
        ctx.fillText(`${Math.round(gy * 10) / 10}m`, x0 + 6, py - 4);
      }
    }

    const barPx = step * scale;
    if (barPx >= 30 && barPx <= 160) {
      const bx = x0 + 16;
      const by = y0 + h - 28;
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx, by - 4);
      ctx.lineTo(bx, by);
      ctx.lineTo(bx + barPx, by);
      ctx.lineTo(bx + barPx, by - 4);
      ctx.stroke();
      ctx.fillStyle = '#334155';
      ctx.font = '600 10.5px "JetBrains Mono", monospace';
      ctx.fillText(`${Math.round(step * 10) / 10} m`, bx + 4, by - 6);
    }

    ctx.restore();
  }

  function drawRoomAndRings2D(ctx, x0, y0, proj, seq) {
    if (!state.showRoom || !seq.room_bbox) return;
    const [rx0, rx1, ry0, ry1] = seq.room_bbox;
    const rcx = 0.5 * (rx0 + rx1);
    const rcy = 0.5 * (ry0 + ry1);
    const [p0x, p0y] = proj.toPx(rx0, ry1);
    const [p1x, p1y] = proj.toPx(rx1, ry0);

    ctx.save();
    const [cx, cy] = proj.toPx(rcx, rcy);
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.font = '600 9.5px "JetBrains Mono", monospace';
    for (const rad of [2, 5, 10, 20]) {
      const rPx = rad * proj.scale;
      if (rPx < 14 || rPx > 520) continue;
      ctx.strokeStyle = rad === 2 ? 'rgba(0, 168, 132, 0.45)' : 'rgba(148, 163, 184, 0.36)';
      ctx.beginPath();
      ctx.arc(x0 + cx, y0 + cy, rPx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = rad === 2 ? '#008B7A' : '#64748B';
      ctx.fillText(`${rad}m`, x0 + cx + rPx * 0.707 + 3, y0 + cy - rPx * 0.707 - 2);
    }

    ctx.setLineDash([5, 3]);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.04)';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.4;
    ctx.fillRect(x0 + p0x, y0 + p0y, p1x - p0x, p1y - p0y);
    ctx.strokeRect(x0 + p0x, y0 + p0y, p1x - p0x, p1y - p0y);

    ctx.setLineDash([]);
    const lbl = `True Room (${(rx1 - rx0).toFixed(1)}m×${(ry1 - ry0).toFixed(1)}m)`;
    ctx.font = '700 9.5px "JetBrains Mono", monospace';
    const tw = ctx.measureText(lbl).width + 8;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.fillRect(x0 + p0x - 2, y0 + p0y - 18, tw, 15);
    ctx.fillStyle = '#334155';
    ctx.fillText(lbl, x0 + p0x + 2, y0 + p0y - 7);
    ctx.restore();
  }

  function drawPolylineRange(ctx, x0, y0, proj, xs, ys, seg, startIdx, endIdx, color, width, alpha, dash = []) {
    if (endIdx <= startIdx || endIdx < 1) return null;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash(dash);

    let lastValid = null;
    let started = false;
    ctx.beginPath();
    for (let i = Math.max(0, startIdx); i <= endIdx; i++) {
      const vx = xs[i], vy = ys[i];
      const ok = vx !== null && vy !== null && Number.isFinite(vx) && Number.isFinite(vy);
      const sameSeg = i === Math.max(0, startIdx) || seg[i] === seg[i - 1];
      if (!ok) {
        started = false;
        continue;
      }
      const [px, py] = proj.toPx(vx, vy);
      const sx = x0 + px, sy = y0 + py;
      if (!started || !sameSeg) {
        ctx.moveTo(sx, sy);
        started = true;
      } else {
        ctx.lineTo(sx, sy);
      }
      lastValid = { x: sx, y: sy, wx: vx, wy: vy };
    }
    ctx.stroke();
    ctx.restore();
    return lastValid;
  }

  // Draws either full trail or faint history + luminous tapered Comet Tail
  function drawTrajectory(ctx, x0, y0, proj, xs, ys, seq, endIdx, color, baseWidth, baseAlpha, isHighlight) {
    if (endIdx < 1) return null;
    if (!state.cometTail) {
      return drawPolylineRange(ctx, x0, y0, proj, xs, ys, seq.seg, 0, endIdx, color, baseWidth, baseAlpha);
    }

    const tailWindowSec = seq.duration_s > 600 ? 90 : 35;
    const cutoffT = Math.max(0, seq.t[endIdx] - tailWindowSec);
    let tailStart = 0;
    while (tailStart < endIdx && seq.t[tailStart] < cutoffT) tailStart++;

    // 1. Subtle ghost history (0 -> tailStart)
    if (tailStart > 0) {
      drawPolylineRange(
        ctx, x0, y0, proj, xs, ys, seq.seg, 0, tailStart,
        color, Math.max(1.0, baseWidth * 0.55), isHighlight ? 0.16 : 0.12
      );
    }

    // 2. Luminous tapered comet tail (tailStart -> endIdx) in gradient slices
    const len = endIdx - tailStart;
    if (len < 1) {
      return drawPolylineRange(ctx, x0, y0, proj, xs, ys, seq.seg, 0, endIdx, color, baseWidth, baseAlpha);
    }
    const slices = Math.min(16, len);
    let lastValid = null;
    for (let s = 0; s < slices; s++) {
      const aIdx = tailStart + Math.floor((s * len) / slices);
      const bIdx = s === slices - 1 ? endIdx : tailStart + Math.floor(((s + 1) * len) / slices);
      const frac = (s + 1) / slices;
      const a = 0.25 + frac * (baseAlpha - 0.25);
      const w = baseWidth * (0.6 + 0.55 * frac);
      const tip = drawPolylineRange(ctx, x0, y0, proj, xs, ys, seq.seg, aIdx, bIdx, color, w, a);
      if (tip) lastValid = tip;
    }
    return lastValid;
  }

  function drawTipMarker(ctx, pt, color, radius, ringColor = '#FFFFFF') {
    if (!pt) return;
    ctx.save();
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, radius + 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.22;
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = ringColor;
    ctx.stroke();
    ctx.restore();
  }

  function drawOriginBadge(ctx, x0, y0, proj) {
    const [px, py] = proj.toPx(0, 0);
    const sx = x0 + px, sy = y0 + py;
    ctx.save();
    ctx.beginPath();
    ctx.arc(sx, sy, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = GT_COLOR;
    ctx.stroke();
    ctx.font = '700 9.5px "JetBrains Mono", monospace';
    ctx.fillStyle = GT_COLOR;
    ctx.fillText('START', sx + 8, sy + 12);
    ctx.restore();
  }

  function drawTetherBadge(ctx, gtTip, tip, color, errM, frac = 0.58, yShift = 0) {
    const mx = gtTip.x + (tip.x - gtTip.x) * frac;
    const my = gtTip.y + (tip.y - gtTip.y) * frac + yShift;
    const label = `${errM.toFixed(1)}m`;
    ctx.save();
    ctx.font = '700 9.5px "JetBrains Mono", monospace';
    const tw = ctx.measureText(label).width + 8;
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.roundRect(mx - tw / 2, my - 8, tw, 16, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(label, mx, my + 3.5);
    ctx.restore();
  }

  function renderMainCanvas() {
    const canvas = el.trajCanvas;
    const rect = el.canvasWrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(300, Math.floor(rect.width));
    const H = Math.max(260, Math.floor(rect.height));
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
      canvas.width = W * dpr;
      canvas.height = H * dpr;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const seq = state.seq;
    if (!seq) return;

    const n = seq.t.length;
    const endIdx = Math.min(n - 1, Math.max(0, Math.floor(state.progress * (n - 1))));

    if (state.followCam && seq.gt.x[endIdx] !== null) {
      state.cam.cx += (seq.gt.x[endIdx] - state.cam.cx) * 0.14;
      state.cam.cy += (seq.gt.y[endIdx] - state.cam.cy) * 0.14;
    }

    el.heatmapColorbar.hidden = state.mode !== 'heatmap';

    if (state.mode === 'split') {
      const halfW = Math.floor(W / 2) - 1;
      const projL = getViewportProjector(halfW, H, state.cam);
      const projR = getViewportProjector(halfW, H, state.cam);
      const baseMethod =
        seq.methods.find((m) => !m.is_ours && state.activeMethods.has(m.id)) ||
        seq.methods.find((m) => !m.is_ours);
      const oursMethod = seq.methods.find((m) => m.is_ours);

      drawGridAndScale(ctx, 0, 0, halfW, H, state.cam);
      drawRoomAndRings2D(ctx, 0, 0, projL, seq);
      if (state.showGT && !state.cometTail) {
        drawPolylineRange(ctx, 0, 0, projL, seq.gt.x, seq.gt.y, seq.seg, 0, n - 1, '#CBD5E1', 1.1, 0.55, [4, 4]);
      }
      if (baseMethod) {
        const mEnd = Math.floor(endIdx * (state.methodProgress[baseMethod.id] ?? 1));
        const bTip = drawTrajectory(ctx, 0, 0, projL, baseMethod.x, baseMethod.y, seq, mEnd, baseMethod.color, 2.3, 0.92, false);
        const gTip = state.showGT ? drawTrajectory(ctx, 0, 0, projL, seq.gt.x, seq.gt.y, seq, endIdx, GT_COLOR, 2.3, 0.96, true) : null;
        if (state.showTethers && bTip && gTip) {
          ctx.save(); ctx.strokeStyle = baseMethod.color; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.moveTo(gTip.x, gTip.y); ctx.lineTo(bTip.x, bTip.y); ctx.stroke(); ctx.restore();
        }
        drawTipMarker(ctx, bTip, baseMethod.color, 5);
        drawTipMarker(ctx, gTip, GT_COLOR, 4.5);
      }
      drawOriginBadge(ctx, 0, 0, projL);
      drawViewportTitle(ctx, 12, 12, baseMethod ? `${baseMethod.label} (ATE ${baseMethod.ate_m.toFixed(2)} m)` : 'Baseline', baseMethod ? baseMethod.color : '#E11D48');

      ctx.fillStyle = '#CBD5E1';
      ctx.fillRect(halfW, 0, 2, H);

      const rx0 = halfW + 2;
      drawGridAndScale(ctx, rx0, 0, W - rx0, H, state.cam);
      drawRoomAndRings2D(ctx, rx0, 0, projR, seq);
      if (state.showGT && !state.cometTail) {
        drawPolylineRange(ctx, rx0, 0, projR, seq.gt.x, seq.gt.y, seq.seg, 0, n - 1, '#CBD5E1', 1.1, 0.55, [4, 4]);
      }
      if (oursMethod) {
        const mEnd = Math.floor(endIdx * (state.methodProgress[oursMethod.id] ?? 1));
        const oTip = drawTrajectory(ctx, rx0, 0, projR, oursMethod.x, oursMethod.y, seq, mEnd, oursMethod.color, 2.8, 0.98, true);
        const gTip = state.showGT ? drawTrajectory(ctx, rx0, 0, projR, seq.gt.x, seq.gt.y, seq, endIdx, GT_COLOR, 2.3, 0.96, true) : null;
        if (state.showTethers && oTip && gTip) {
          ctx.save(); ctx.strokeStyle = oursMethod.color; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.moveTo(gTip.x, gTip.y); ctx.lineTo(oTip.x, oTip.y); ctx.stroke(); ctx.restore();
        }
        drawTipMarker(ctx, oTip, oursMethod.color, 5.5);
        drawTipMarker(ctx, gTip, GT_COLOR, 4.5);
      }
      drawOriginBadge(ctx, rx0, 0, projR);
      drawViewportTitle(ctx, rx0 + 12, 12, oursMethod ? `${oursMethod.label} (ATE ${oursMethod.ate_m.toFixed(2)} m)` : 'MARC (Ours)', '#00A884');
      return;
    }

    drawGridAndScale(ctx, 0, 0, W, H, state.cam);
    const proj = getViewportProjector(W, H, state.cam);
    drawRoomAndRings2D(ctx, 0, 0, proj, seq);

    if (state.showGT && !state.cometTail) {
      drawPolylineRange(ctx, 0, 0, proj, seq.gt.x, seq.gt.y, seq.seg, 0, n - 1, '#CBD5E1', 1.1, 0.55, [4, 4]);
    }

    if (state.mode === 'heatmap') {
      const oursMethod = seq.methods.find((m) => m.is_ours) || seq.methods[0];
      let maxErr = 4.0;
      for (let i = 0; i < n; i++) {
        if (oursMethod.x[i] !== null) {
          const e = Math.hypot(oursMethod.x[i] - seq.gt.x[i], oursMethod.y[i] - seq.gt.y[i]);
          if (e > maxErr) maxErr = e;
        }
      }
      const cap = Math.ceil(Math.min(15, maxErr));
      el.heatmapMaxLabel.textContent = `${cap}+ m`;
      ctx.save();
      ctx.lineWidth = 3.0;
      ctx.lineCap = 'round';
      for (let i = 1; i <= endIdx; i++) {
        if (seq.seg[i] !== seq.seg[i - 1]) continue;
        const x1 = oursMethod.x[i - 1], y1 = oursMethod.y[i - 1], x2 = oursMethod.x[i], y2 = oursMethod.y[i];
        if (x1 === null || x2 === null) continue;
        const e = Math.hypot(x2 - seq.gt.x[i], y2 - seq.gt.y[i]);
        ctx.strokeStyle = errorColor(e, cap);
        const [p1x, p1y] = proj.toPx(x1, y1);
        const [p2x, p2y] = proj.toPx(x2, y2);
        ctx.beginPath(); ctx.moveTo(p1x, p1y); ctx.lineTo(p2x, p2y); ctx.stroke();
      }
      ctx.restore();
      const gTip = state.showGT ? drawTrajectory(ctx, 0, 0, proj, seq.gt.x, seq.gt.y, seq, endIdx, GT_COLOR, 2.2, 0.95, true) : null;
      drawTipMarker(ctx, gTip, GT_COLOR, 4.5);
      drawOriginBadge(ctx, 0, 0, proj);
      return;
    }

    // 2D Top-Down Map (Overlay)
    const activeList = seq.methods.filter((m) => state.activeMethods.has(m.id));
    const ordered = activeList.filter((m) => !m.is_ours).concat(activeList.filter((m) => m.is_ours));
    const tips = [];
    for (const m of ordered) {
      const mEnd = Math.floor(endIdx * (state.methodProgress[m.id] ?? 1));
      const tip = drawTrajectory(
        ctx, 0, 0, proj, m.x, m.y, seq, mEnd,
        m.color, m.is_ours ? 2.9 : 2.0, m.is_ours ? 0.98 : 0.86, m.is_ours
      );
      if (tip) {
        const errM = Math.hypot(tip.wx - seq.gt.x[mEnd], tip.wy - seq.gt.y[mEnd]);
        tips.push({ m, tip, errM });
      }
    }

    const gtTip = state.showGT ? drawTrajectory(ctx, 0, 0, proj, seq.gt.x, seq.gt.y, seq, endIdx, GT_COLOR, 2.4, 0.98, true) : null;

    if (state.showTethers && gtTip) {
      const worst = tips.filter((t) => !t.m.is_ours).sort((a, b) => b.errM - a.errM)[0];
      const oursT = tips.find((t) => t.m.is_ours);
      for (const { m, tip } of tips) {
        ctx.save();
        ctx.strokeStyle = m.color;
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1.3;
        ctx.globalAlpha = 0.85;
        ctx.beginPath(); ctx.moveTo(gtTip.x, gtTip.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
        ctx.restore();
      }
      if (oursT) drawTetherBadge(ctx, gtTip, oursT.tip, oursT.m.color, oursT.errM, 0.55, 11);
      if (worst) drawTetherBadge(ctx, gtTip, worst.tip, worst.m.color, worst.errM, 0.72, -10);
    }

    for (const { m, tip } of tips) drawTipMarker(ctx, tip, m.color, m.is_ours ? 5.5 : 4.3);
    drawTipMarker(ctx, gtTip, GT_COLOR, 4.8);
    drawOriginBadge(ctx, 0, 0, proj);
  }

  function drawViewportTitle(ctx, x, y, text, color) {
    ctx.save();
    ctx.font = '700 11.5px "Inter", sans-serif';
    const w = ctx.measureText(text).width + 18;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, y, w, 24, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#0F172A';
    ctx.fillText(text, x + 9, y + 16);
    ctx.restore();
  }

  function renderTelemetryAndErrorChart() {
    const seq = state.seq;
    if (!seq) return;
    const n = seq.t.length;
    const endIdx = Math.min(n - 1, Math.max(0, Math.floor(state.progress * (n - 1))));

    el.timeClock.textContent = `${fmtTime(seq.t[endIdx])} / ${fmtTime(seq.duration_s)}`;
    el.timeSlider.value = Math.round(state.progress * 1000);

    let dist = 0;
    for (let i = 1; i <= endIdx; i++) {
      if (seq.seg[i] === seq.seg[i - 1]) {
        dist += Math.hypot(seq.gt.x[i] - seq.gt.x[i - 1], seq.gt.y[i] - seq.gt.y[i - 1]);
      }
    }
    el.hudDist.textContent = `${dist.toFixed(0)} m / ${seq.path_len_m.toFixed(0)} m`;

    const rows = [];
    for (const m of seq.methods) {
      if (!state.activeMethods.has(m.id)) continue;
      const mEnd = Math.floor(endIdx * (state.methodProgress[m.id] ?? 1));
      let sumSq = 0, cnt = 0, instErr = null;
      for (let i = 0; i <= mEnd; i++) {
        const mx = m.x[i], my = m.y[i];
        if (mx !== null && my !== null) {
          const e = Math.hypot(mx - seq.gt.x[i], my - seq.gt.y[i]);
          sumSq += e * e;
          cnt++;
          instErr = e;
        }
      }
      const runAte = cnt > 0 ? Math.sqrt(sumSq / cnt) : null;
      rows.push({ m, instErr, runAte });
    }
    rows.sort((a, b) => a.m.ate_m - b.m.ate_m);
    el.liveLeaderboard.innerHTML = rows.map(({ m, instErr, runAte }) => `
      <div class="lb-row${m.is_ours ? ' is-ours' : ''}">
        <div class="lb-name">
          <span class="lb-dot" style="background:${m.color}"></span>
          <span>${m.label}</span>
        </div>
        <div class="lb-stat">now <strong>${instErr !== null ? instErr.toFixed(2) : '—'}m</strong></div>
        <div class="lb-stat">ATE <strong>${runAte !== null ? runAte.toFixed(2) : '—'}m</strong></div>
      </div>
    `).join('');

    const canvas = el.errCanvas;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(220, Math.floor(rect.width));
    const H = Math.max(140, Math.floor(rect.height));
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
      canvas.width = W * dpr;
      canvas.height = H * dpr;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const padL = 34, padR = 10, padT = 10, padB = 22;
    const pw = W - padL - padR;
    const ph = H - padT - padB;

    let maxErr = 4;
    const series = [];
    for (const m of seq.methods) {
      if (!state.activeMethods.has(m.id)) continue;
      const errs = new Array(n);
      for (let i = 0; i < n; i++) {
        if (m.x[i] === null || m.y[i] === null) {
          errs[i] = null;
        } else {
          const e = Math.hypot(m.x[i] - seq.gt.x[i], m.y[i] - seq.gt.y[i]);
          errs[i] = e;
          if (e > maxErr) maxErr = e;
        }
      }
      series.push({ m, errs });
    }
    maxErr = Math.ceil(maxErr * 1.1);

    ctx.strokeStyle = 'rgba(148,163,184,0.16)';
    ctx.lineWidth = 1;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = '#94A3B8';
    for (let g = 0; g <= 2; g++) {
      const val = (maxErr * g) / 2;
      const py = padT + ph - (g / 2) * ph;
      ctx.beginPath(); ctx.moveTo(padL, py); ctx.lineTo(padL + pw, py); ctx.stroke();
      ctx.fillText(`${val.toFixed(0)}m`, 2, py + 3);
    }

    for (const { m, errs } of series) {
      const mEnd = Math.floor(endIdx * (state.methodProgress[m.id] ?? 1));
      ctx.save();
      ctx.strokeStyle = m.color;
      ctx.lineWidth = m.is_ours ? 2.4 : 1.5;
      ctx.globalAlpha = m.is_ours ? 1 : 0.8;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i <= mEnd; i++) {
        if (errs[i] === null) { started = false; continue; }
        const px = padL + (i / Math.max(1, n - 1)) * pw;
        const py = padT + ph - (errs[i] / maxErr) * ph;
        if (!started) { ctx.moveTo(px, py); started = true; } else { ctx.lineTo(px, py); }
      }
      ctx.stroke();
      ctx.restore();
    }

    const cx = padL + state.progress * pw;
    ctx.strokeStyle = '#94A3B8';
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(cx, padT); ctx.lineTo(cx, padT + ph); ctx.stroke();
    ctx.setLineDash([]);
  }

  function tick(ts) {
    if (state.lastTs !== null) {
      const dt = Math.min(0.1, (ts - state.lastTs) / 1000);
      if (state.playing && state.seq) {
        const rate = (state.speed * 0.065) * dt;
        state.progress = Math.min(1, state.progress + rate);
        if (state.progress >= 1) {
          state.playing = false;
          updatePlayButtons();
        }
      }
      for (const id of Object.keys(state.methodProgress)) {
        if (state.methodProgress[id] < 1) {
          state.methodProgress[id] = Math.min(1, state.methodProgress[id] + dt * 0.85);
        }
      }
    }
    state.lastTs = ts;
    renderMainCanvas();
    renderTelemetryAndErrorChart();
    requestAnimationFrame(tick);
  }

  function renderBenchmarks() {
    const b = state.benchData;
    if (!b) return;
    const tab = state.activeBenchTab;
    document.querySelectorAll('.bench-tab').forEach((btn) => btn.classList.toggle('active', btn.dataset.bench === tab));

    if (tab === 'officeio') {
      const rows = b.officeio.summary_methods;
      const maxVal = 13.5;
      const svgW = 580, svgH = 265, padL = 44, padB = 46, padT = 20, padR = 16;
      const cw = svgW - padL - padR, ch = svgH - padT - padB;
      const gw = cw / rows.length;
      const bars = rows.map((r, i) => {
        const x0 = padL + i * gw + gw * 0.16;
        const bw = gw * 0.31;
        const h1 = (r.all8_ate / maxVal) * ch;
        const h2 = (r.long3_ate / maxVal) * ch;
        const c1 = r.is_ours ? '#00997A' : '#94A3B8';
        const c2 = r.is_ours ? '#059669' : '#64748B';
        return `
          <rect x="${x0}" y="${padT + ch - h1}" width="${bw}" height="${h1}" rx="4" fill="${c1}" />
          <text x="${x0 + bw / 2}" y="${padT + ch - h1 - 5}" text-anchor="middle" fill="currentColor" font-size="10.5" font-weight="700">${r.all8_ate.toFixed(2)}</text>
          <rect x="${x0 + bw + 4}" y="${padT + ch - h2}" width="${bw}" height="${h2}" rx="4" fill="${c2}" />
          <text x="${x0 + bw + 4 + bw / 2}" y="${padT + ch - h2 - 5}" text-anchor="middle" fill="currentColor" font-size="10.5" font-weight="700">${r.long3_ate.toFixed(2)}</text>
          <text x="${padL + (i + 0.5) * gw}" y="${svgH - 20}" text-anchor="middle" fill="currentColor" font-size="11" font-weight="${r.is_ours ? 700 : 500}">${r.method.replace(' Baseline', '')}</text>
        `;
      }).join('');

      el.benchPanel.innerHTML = `
        <div class="bench-split">
          <div class="chart-box">
            <div class="chart-title">OFFICEIO ATE (m) — All 8 Sessions vs. Long 3 (38–59 min)</div>
            <div class="chart-sub">Lower is better · Light bars: All 8 · Darker/Emerald bars: Long 3</div>
            <svg viewBox="0 0 ${svgW} ${svgH}" width="100%">
              <line x1="${padL}" y1="${padT + ch}" x2="${svgW - padR}" y2="${padT + ch}" stroke="currentColor" stroke-opacity="0.25" />
              ${bars}
            </svg>
          </div>
          <div class="chart-box">
            <div class="chart-title">Summary &amp; CoWear Paired-5</div>
            <div class="chart-sub">Verified multi-seed test means</div>
            <table class="data-table">
              <thead><tr><th>Method</th><th>All 8 ATE</th><th>Long 3</th><th>RTE-60s</th></tr></thead>
              <tbody>
                ${rows.map((r) => `<tr class="${r.is_ours ? 'row-ours' : ''}"><td>${r.method}</td><td class="mono">${r.all8_ate.toFixed(2)} m</td><td class="mono">${r.long3_ate.toFixed(2)} m</td><td class="mono">${r.rte60.toFixed(2)} m</td></tr>`).join('')}
                <tr><td>CoWear (Paired-5)</td><td class="mono">3.89 m</td><td class="mono">—</td><td class="mono">1.70 m</td></tr>
                <tr class="row-ours"><td>MARC (Paired-5)</td><td class="mono">3.12 m</td><td class="mono">—</td><td class="mono">0.61 m</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else if (tab === 'ronin') {
      const list = b.ronin.settings;
      const maxVal = 12.2;
      const svgW = 580, svgH = 265, padL = 42, padB = 48, padT = 22, padR = 12;
      const cw = svgW - padL - padR, ch = svgH - padT - padB;
      const gw = cw / list.length;
      const bars = list.map((s, i) => {
        const x0 = padL + i * gw + gw * 0.14;
        const bw = gw * 0.33;
        const h1 = (s.base_ate / maxVal) * ch;
        const h2 = (s.ours_ate / maxVal) * ch;
        const pct = ((s.ours_ate - s.base_ate) / s.base_ate * 100).toFixed(1);
        return `
          <rect x="${x0}" y="${padT + ch - h1}" width="${bw}" height="${h1}" rx="4" fill="#E11D48" fill-opacity="0.78" />
          <rect x="${x0 + bw + 3}" y="${padT + ch - h2}" width="${bw}" height="${h2}" rx="4" fill="#00997A" />
          <text x="${x0 + bw + 3 + bw / 2}" y="${padT + ch - h2 - 5}" text-anchor="middle" fill="#00997A" font-size="9.8" font-weight="700">${pct}%</text>
          <text x="${padL + (i + 0.5) * gw}" y="${svgH - 25}" text-anchor="middle" fill="currentColor" font-size="10">${s.backbone.replace('RoNIN-', '')}</text>
          <text x="${padL + (i + 0.5) * gw}" y="${svgH - 12}" text-anchor="middle" fill="#94A3B8" font-size="9.5">(${s.split})</text>
        `;
      }).join('');

      el.benchPanel.innerHTML = `
        <div class="bench-split">
          <div class="chart-box">
            <div class="chart-title">RoNIN Across 3 Architectures (Seen &amp; Unseen)</div>
            <div class="chart-sub">Coral: RoNIN Baseline · Teal: + MARC (Ours) · 32 test sequences per split</div>
            <svg viewBox="0 0 ${svgW} ${svgH}" width="100%">
              <line x1="${padL}" y1="${padT + ch}" x2="${svgW - padR}" y2="${padT + ch}" stroke="currentColor" stroke-opacity="0.25" />
              ${bars}
            </svg>
          </div>
          <div class="chart-box">
            <div class="chart-title">Cross-Backbone Breakdown</div>
            <div class="chart-sub">Absolute Trajectory Error (m)</div>
            <table class="data-table">
              <thead><tr><th>Backbone</th><th>Split</th><th>Baseline</th><th>MARC</th><th>Gain</th></tr></thead>
              <tbody>
                ${list.map((s) => {
                  const g = ((s.ours_ate - s.base_ate) / s.base_ate * 100).toFixed(1);
                  return `<tr><td>${s.backbone}</td><td>${s.split}</td><td class="mono">${s.base_ate.toFixed(2)} m</td><td class="mono" style="color:var(--cyan);font-weight:700">${s.ours_ate.toFixed(2)} m</td><td class="pill-pos">${g}%</td></tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else {
      const users = b.suiteinpp.unseen_users;
      const svgW = 580, svgH = 290, padL = 48, padR = 64, padT = 16, padB = 26;
      const cw = svgW - padL - padR, ch = svgH - padT - padB;
      const rh = ch / users.length;
      const maxD = 0.85;
      const bars = users.map((u, i) => {
        const d = u.base_ate - u.ours_ate;
        const bw = (d / maxD) * cw;
        const y = padT + i * rh + 3;
        return `
          <text x="${padL - 8}" y="${y + rh * 0.55}" text-anchor="end" fill="currentColor" font-size="10.5" font-weight="600">${u.user}</text>
          <rect x="${padL}" y="${y}" width="${bw}" height="${Math.max(8, rh - 7)}" rx="4" fill="#00997A" />
          <text x="${padL + bw + 6}" y="${y + rh * 0.55}" fill="#00997A" font-size="10" font-weight="700">-${d.toFixed(2)} m (${u.n_seq} seq)</text>
        `;
      }).join('');

      el.benchPanel.innerHTML = `
        <div class="bench-split">
          <div class="chart-box">
            <div class="chart-title">Suite-IN++ · 11 / 11 Unseen Users Improved (127 Sequences)</div>
            <div class="chart-sub">ATE reduction (m) over Suite-IN++ per completely unseen subject</div>
            <svg viewBox="0 0 ${svgW} ${svgH}" width="100%">
              ${bars}
            </svg>
          </div>
          <div class="chart-box">
            <div class="chart-title">Suite-IN++ Cohort Summary</div>
            <div class="chart-sub">Standard Test (45 seq) &amp; Unseen Users (127 seq)</div>
            <table class="data-table">
              <thead><tr><th>Cohort</th><th>Suite-IN++</th><th>+ MARC</th><th>Win Rate</th></tr></thead>
              <tbody>
                ${b.suiteinpp.cohorts.map((c) => `
                  <tr class="row-ours">
                    <td>${c.name}</td>
                    <td class="mono">${c.base_ate.toFixed(2)} m</td>
                    <td class="mono">${c.ours_ate.toFixed(2)} m</td>
                    <td class="pill-pos">${c.win_rate_pct.toFixed(1)}%</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }
  }

  function renderDriftCards() {
    const curves = state.benchData?.drift_curves;
    if (!curves) return;
    el.driftGrid.innerHTML = Object.values(curves).filter((c) => c.t_min && c.t_min.length > 1).map((c) => {
      const svgW = 540, svgH = 220, padL = 40, padR = 14, padT = 16, padB = 26;
      const cw = svgW - padL - padR, ch = svgH - padT - padB;
      const maxE = Math.ceil(Math.max(1, ...c.base_err_m, ...c.ours_err_m) * 1.1);
      const maxT = Math.max(1, c.t_min[c.t_min.length - 1]);
      const pt = (t, e) => `${(padL + (t / maxT) * cw).toFixed(1)},${(padT + ch - (e / maxE) * ch).toFixed(1)}`;
      const basePts = c.t_min.map((t, i) => pt(t, c.base_err_m[i])).join(' ');
      const oursPts = c.t_min.map((t, i) => pt(t, c.ours_err_m[i])).join(' ');
      const baseEnd = c.base_err_m[c.base_err_m.length - 1];
      const oursEnd = c.ours_err_m[c.ours_err_m.length - 1];
      return `
        <div class="drift-card">
          <div class="drift-head">
            <h3>${c.title}</h3>
            <span class="drift-badge">End Error: ${baseEnd.toFixed(1)} m → ${oursEnd.toFixed(1)} m</span>
          </div>
          <svg viewBox="0 0 ${svgW} ${svgH}" width="100%">
            <line x1="${padL}" y1="${padT + ch}" x2="${svgW - padR}" y2="${padT + ch}" stroke="currentColor" stroke-opacity="0.22" />
            <text x="4" y="${padT + 10}" fill="#94A3B8" font-size="10">${maxE}m</text>
            <text x="4" y="${padT + ch}" fill="#94A3B8" font-size="10">0m</text>
            <text x="${padL}" y="${svgH - 6}" fill="#94A3B8" font-size="10">0 min</text>
            <text x="${svgW - padR}" y="${svgH - 6}" text-anchor="end" fill="#94A3B8" font-size="10">${maxT.toFixed(0)} min</text>
            <polyline fill="none" stroke="#E11D48" stroke-width="1.9" points="${basePts}" />
            <polyline fill="none" stroke="#00997A" stroke-width="2.4" points="${oursPts}" />
          </svg>
        </div>
      `;
    }).join('');
  }

  function renderDatasets() {
    const ds = state.benchData?.datasets;
    if (!ds) return;
    el.datasetGrid.innerHTML = ds.map((d) => `
      <div class="ds-card">
        <span class="ds-tag">${d.tag}</span>
        <h3>${d.name}</h3>
        <div class="ds-meta">
          <span>Modalities: ${d.modalities}</span>
          <span>Scale: ${d.scale}</span>
          <span>Highlight: ${d.max_duration}</span>
        </div>
        <p>${d.description}</p>
      </div>
    `).join('');
  }

  function bindEvents() {
    document.querySelectorAll('.ds-tab').forEach((btn) => {
      btn.addEventListener('click', () => loadDataset(btn.dataset.dataset));
    });

    document.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.mode = btn.dataset.mode;
        document.querySelectorAll('.mode-btn').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });

    el.toggleComet.addEventListener('click', () => {
      state.cometTail = !state.cometTail;
      el.toggleComet.classList.toggle('active', state.cometTail);
    });

    document.getElementById('toggleTethers').addEventListener('click', (e) => {
      state.showTethers = !state.showTethers;
      e.currentTarget.classList.toggle('active', state.showTethers);
    });

    document.getElementById('toggleRoom').addEventListener('click', (e) => {
      state.showRoom = !state.showRoom;
      e.currentTarget.classList.toggle('active', state.showRoom);
    });

    document.getElementById('toggleFollow').addEventListener('click', (e) => {
      state.followCam = !state.followCam;
      e.currentTarget.classList.toggle('active', state.followCam);
    });

    document.getElementById('resetCamBtn').addEventListener('click', resetCamera);

    el.playPauseBtn.addEventListener('click', () => {
      if (state.progress >= 1) state.progress = 0;
      state.playing = !state.playing;
      updatePlayButtons();
    });

    el.restartBtn.addEventListener('click', () => {
      state.progress = 0;
      state.playing = true;
      updatePlayButtons();
    });

    document.querySelectorAll('.spd-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.speed = Number(btn.dataset.speed);
        document.querySelectorAll('.spd-btn').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });

    el.timeSlider.addEventListener('input', () => {
      state.progress = Number(el.timeSlider.value) / 1000;
    });

    document.getElementById('presetAllBtn').addEventListener('click', () => {
      if (!state.seq) return;
      state.showGT = true;
      state.activeMethods = new Set(state.seq.methods.map((m) => m.id));
      state.seq.methods.forEach((m) => { state.methodProgress[m.id] = 1; });
      state.progress = 0;
      state.playing = true;
      updatePlayButtons();
      renderMethodPills();
    });

    document.getElementById('presetGtOnlyBtn').addEventListener('click', () => {
      if (!state.seq) return;
      state.showGT = true;
      state.activeMethods = new Set();
      state.progress = 1;
      state.playing = false;
      updatePlayButtons();
      renderMethodPills();
    });

    document.getElementById('presetOursVsBestBtn').addEventListener('click', () => {
      if (!state.seq) return;
      const firstBase = state.seq.methods.find((m) => !m.is_ours);
      state.showGT = true;
      state.activeMethods = new Set(['marc', ...(firstBase ? [firstBase.id] : [])]);
      state.seq.methods.forEach((m) => { state.methodProgress[m.id] = 1; });
      state.progress = 0;
      state.playing = true;
      updatePlayButtons();
      renderMethodPills();
    });

    el.canvasWrap.addEventListener('mousedown', (e) => {
      state.drag = { active: true, x: e.clientX, y: e.clientY, cx: state.cam.cx, cy: state.cam.cy };
    });
    window.addEventListener('mousemove', (e) => {
      if (!state.drag.active) return;
      const rect = el.canvasWrap.getBoundingClientRect();
      const viewW = state.mode === 'split' ? rect.width * 0.5 : rect.width;
      const scale = Math.min(viewW, rect.height) / state.cam.span;
      state.cam.cx = state.drag.cx - (e.clientX - state.drag.x) / scale;
      state.cam.cy = state.drag.cy + (e.clientY - state.drag.y) / scale;
    });
    window.addEventListener('mouseup', () => { state.drag.active = false; });

    el.canvasWrap.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.12 : 0.89;
      state.cam.span = Math.min(500, Math.max(2, state.cam.span * factor));
    }, { passive: false });

    document.querySelectorAll('.bench-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.activeBenchTab = btn.dataset.bench;
        renderBenchmarks();
      });
    });

    el.themeToggle.addEventListener('click', () => {
      const html = document.documentElement;
      html.setAttribute('data-theme', html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });
  }

  async function init() {
    bindEvents();
    const benchResp = await fetch('data/benchmarks.json');
    state.benchData = await benchResp.json();
    renderBenchmarks();
    renderDriftCards();
    renderDatasets();
    await loadDataset('officeio');
    requestAnimationFrame(tick);
  }

  init();
})();
