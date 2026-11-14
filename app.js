/* Masa Paneli — canlı, salt-okunur izleme. SANAL (paper) — gerçek para yok.
   Veri: GitHub 'data' dalındaki data.json (kutudaki yayıncı ~60 sn'de bir yazar).
   Canlı fiyat: DexScreener (Solana), OKX (spot; Binance verisi değil). Mumlar: GeckoTerminal / OKX. */
(() => {
"use strict";
const Core = window.MasaCore;
const REPO = "EmKaya42/masa-panel";
const API_URL = `https://api.github.com/repos/${REPO}/contents/data.json?ref=data`;
const RAW_URL = `https://raw.githubusercontent.com/${REPO}/data/data.json`;
const DATA_POLL = 80e3, DEX_POLL = 12e3, OKX_POLL = 10e3, SPARK_POLL = 90e3, STALE_S = 300;
const TZ = "Europe/Istanbul";
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

let D = null, dataSrc = "", rawUntil = 0, lastFetchOk = 0, fetchErr = "";
let loadingData = false;
const renderErrors = {};
const dex = {};            // mint -> {px, ch5, ch1, ch24, liq, pair, url, t}
const okx = {};            // base -> {px, open24, ch, vol, t}
const spark = {};          // base -> [close...]
let dexOk = 0, okxOk = 0, okxMode = "ws";

/* ---------- format ---------- */
const nf = (n, d = 2) => (n == null || isNaN(n)) ? "—" : Number(n).toLocaleString("tr-TR", {minimumFractionDigits: d, maximumFractionDigits: d});
const usd = (n, d = 2) => n == null ? "—" : (n < 0 ? "-$" : "$") + nf(Math.abs(n), d);
const sgnUsd = n => n == null ? "—" : (n > 0 ? "+" : n < 0 ? "−" : "") + "$" + nf(Math.abs(n));
const pct = (n, d = 2) => n == null || isNaN(n) ? "—" : (n > 0 ? "+" : n < 0 ? "−" : "") + "%" + nf(Math.abs(n), d);
const cls = n => n > 0 ? "up" : n < 0 ? "dn" : "";
function fpx(p) {
  if (p == null || isNaN(p)) return "—";
  p = Number(p); const a = Math.abs(p);
  if (a === 0) return "0";
  if (a >= 1000) return nf(p, 2);
  if (a >= 1) return nf(p, 4).replace(/0+$/, "").replace(/,$/, ",00");
  const dec = Math.min(12, Math.max(4, Math.ceil(-Math.log10(a)) + 3));
  return p.toLocaleString("tr-TR", {minimumFractionDigits: 2, maximumFractionDigits: dec});
}
const hm = ts => ts ? new Date(ts * 1000).toLocaleTimeString("tr-TR", {timeZone: TZ, hour: "2-digit", minute: "2-digit"}) : "—";
const dhm = ts => ts ? new Date(ts * 1000).toLocaleString("tr-TR", {timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"}) : "—";
function ago(s) {
  if (s == null || isNaN(s)) return "—";
  s = Math.max(0, Math.round(s));
  if (s < 60) return s + " sn önce";
  if (s < 3600) return Math.floor(s / 60) + " dk önce";
  if (s < 86400) return Math.floor(s / 3600) + " sa " + Math.floor(s % 3600 / 60) + " dk önce";
  return Math.floor(s / 86400) + " gün önce";
}
const dur = s => s < 60 ? Math.round(s) + " sn" : s < 3600 ? Math.round(s / 60) + " dk" : (s / 3600).toFixed(1).replace(".", ",") + " sa";
const now = () => Date.now() / 1000;

function setTxt(el, txt, dir) {
  if (typeof el === "string") el = $(el);
  if (!el || el.textContent === txt) return;
  el.textContent = txt;
  if (dir) { el.classList.remove("flash-up", "flash-dn"); void el.offsetWidth; el.classList.add(dir > 0 ? "flash-up" : "flash-dn"); }
}
function countTo(el, to, fmt) {
  const from = el._v ?? to; el._v = to;
  if (from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now(), T = 900;
  const step = t => { const k = Math.min(1, (t - t0) / T), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

/* ---------- fetch helpers ---------- */
async function getJSON(url, opt = {}, ms = 12000) {
  const c = new AbortController(); const id = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, {...opt, signal: c.signal}); if (!r.ok) { const e = new Error("HTTP " + r.status); e.status = r.status; e.r = r; throw e; } return [await r.json(), r]; }
  finally { clearTimeout(id); }
}

async function loadData() {
  if (loadingData) return;
  loadingData = true;
  try {
  let d = null;
  if (Date.now() > rawUntil) {
    try {
      const [j, r] = await getJSON(API_URL, {headers: {Accept: "application/vnd.github.raw+json"}, cache: "no-cache"});
      d = Core.validateSnapshot(j); dataSrc = "GitHub API";
      const rem = +r.headers.get("x-ratelimit-remaining"), reset = +r.headers.get("x-ratelimit-reset");
      if (!isNaN(rem) && rem < 4 && reset) rawUntil = reset * 1000;
    } catch (e) {
      fetchErr = e.message;
      if (e.status === 403 || e.status === 429) { const reset = +(e.r?.headers.get("x-ratelimit-reset")); rawUntil = reset ? reset * 1000 : Date.now() + 15 * 60e3; }
    }
  }
  if (!d) {
    try { const [j] = await getJSON(RAW_URL + "?t=" + Math.floor(Date.now() / 60e3), {cache: "no-cache"}); d = Core.validateSnapshot(j); dataSrc = "raw.githubusercontent (≤5 dk önbellek)"; }
    catch (e) { fetchErr = "Veri alınamadı (" + (e.status || "ağ") + ")"; }
  }
  if (d && (!D || d.gen >= D.gen)) { D = d; lastFetchOk = now(); fetchErr = ""; renderAll(); pollDex(); }
  else if (d && D && d.gen < D.gen) fetchErr = "Kaynak eski bir kayıt döndürdü; son geçerli veri korunuyor";
  tickStatus();
  } finally { loadingData = false; }
}

/* ---------- status ---------- */
function tickStatus() {
  if (sheet.kind && !sheet.fixed) {
    const current = Core.isFresh(sheet.quoteAt, now(), 60);
    $("#shPx").classList.toggle("quote-stale", !current);
    $("#shS").textContent = sheet.originalSub + " · " + (current ? "fiyat güncel" : sheet.quoteAt ? "son fiyat kaydı: " + dhm(sheet.quoteAt) : "güncel fiyat bekleniyor");
  }
  const b = $("#liveBtn"), t = $("#liveTxt"), bar = $("#staleBar");
  if (!D) { t.textContent = fetchErr || "bağlanıyor"; b.className = "live " + (fetchErr ? "bad" : "warn"); return; }
  const age = now() - D.gen;
  t.innerHTML = `<span class="lbl">son güncelleme </span>${ago(age)}`;
  b.className = "live" + (age > STALE_S * 3 ? " bad" : age > STALE_S ? " warn" : "");
  if (fetchErr || !Core.isFresh(D.gen, now(), STALE_S)) {
    bar.classList.remove("hide"); bar.classList.toggle("bad", age > STALE_S * 3);
    b.className = "live warn";
    bar.textContent = fetchErr ? fetchErr + ". Son geçerli kayıt: " + dhm(D.gen) : age < 0 ? "Kaynak saati ileride; veri zamanı doğrulanamadı." : "Masa kaydı " + dur(age) + " eski · " + dhm(D.gen) + " itibarıyla. Durumlar ve bakiyeler bu kayda aittir. Fiyat bağlantıları ayrı izlenir.";
  } else bar.classList.add("hide");
  window.MasaTerminal?.health(D, {dexOk,okxOk,dataSrc,lastFetchOk,fetchErr,renderErrors});
}

/* ---------- canvas ---------- */
function ctx2d(cv, h) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3), w = cv.clientWidth || cv.parentElement.clientWidth;
  h = h || +cv.getAttribute("height");
  cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + "px";
  const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); return [c, w, h];
}
function drawLine(cv, vals, opt = {}) {
  const [c, w, h] = ctx2d(cv, opt.h);
  if (!vals || vals.length < 2) return null;
  const pad = opt.pad ?? 6, lo = Math.min(...vals, ...(opt.ref != null ? [opt.ref] : [])), hi = Math.max(...vals, ...(opt.ref != null ? [opt.ref] : []));
  const rng = hi - lo || Math.abs(hi) * 0.01 || 1;
  const xs = opt.xs, X = xs ? (i => (xs[i] - xs[0]) / ((xs[xs.length - 1] - xs[0]) || 1) * (w - 6)) : (i => i / (vals.length - 1) * w), Y = v => pad + (1 - (v - lo) / rng) * (h - pad * 2);
  const col = opt.color || "#37f5a6";
  if (opt.ref != null) { c.strokeStyle = "rgba(255,255,255,.14)"; c.setLineDash([3, 4]); c.beginPath(); c.moveTo(0, Y(opt.ref)); c.lineTo(w, Y(opt.ref)); c.stroke(); c.setLineDash([]); }
  c.beginPath(); vals.forEach((v, i) => i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v)));
  c.lineWidth = opt.lw || 2; c.strokeStyle = col; c.lineJoin = "round"; c.shadowColor = col; c.shadowBlur = opt.glow ?? 10; c.stroke(); c.shadowBlur = 0;
  c.lineTo(w, h); c.lineTo(0, h); c.closePath();
  const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, col + "44"); g.addColorStop(1, col + "00"); c.fillStyle = g; c.fill();
  if (opt.dot) { const x = X(vals.length - 1), y = Y(vals[vals.length - 1]); c.fillStyle = col; c.beginPath(); c.arc(Math.min(x, w - 4), y, 3.5, 0, 7); c.fill(); }
  return {X, Y};
}

/* ---------- render: masa ---------- */
function renderMeme() {
  const m = D.meme; if (!m || m.error) return;
  const b = m.bal;
  countTo($("#eq"), b.eq, v => nf(v));
  const pe = $("#pnl"); pe.textContent = `${sgnUsd(b.pnl)} ${pct(b.pnl_pct)}`; pe.className = "num " + cls(b.pnl);
  $("#mult").textContent = nf(b.eq / b.start, 3) + "×"; $("#start").textContent = nf(b.start, 0);
  $("#cash").textContent = usd(b.cash);
  const td = $("#today"); td.textContent = pct(b.today_pct); td.className = "num " + cls(b.today_pct);
  $("#closed").textContent = `${b.closed} · ${b.open} açık`;
  $("#wr").textContent = b.closed ? "%" + nf(b.wins / b.closed * 100, 0) : "—";
  const st = $("#memeStatus"); st.textContent = m.status; st.className = "chip" + (m.status === "aktif" ? "" : m.status === "beklemede" ? " yel" : " red");
  const lim = Math.abs(m.set.halt || 5), used = Math.max(0, -(b.today_pct || 0));
  $("#haltBar").style.width = Math.min(100, used / lim * 100) + "%";
  $("#haltTxt").textContent = `bugün ${pct(b.today_pct)} / limit %${nf(-lim, 0)}` + (m.halt_reason ? " · DURDU" : "");
  const s = m.set;
  $("#rules").innerHTML = [["İşlem başı", `%${s.risk}`], ["Sert stop", `%${s.stop}`], ["İz süren", `+%${s.trail_on} → -%${s.trail}`], ["Günlük durdurma", `%${s.halt}`],
    ["1s pompa sınırı", `+%${s.pump1h}`], ["Min likidite", `$${nf(s.liq / 1000, 0)}k`], ["Maks açık", s.max_open], ["Kayma+ücret", `%${s.slip}/yön`], ["Kontrol", `${s.check_s} sn`]]
    .map(([k, v]) => `<span>${k}<b>${esc(v)}</b></span>`).join("");
  drawCurve();
  renderPositions();
  // pipeline
  const t = now();
  $("#pipe").innerHTML = m.pipe.map(a => {
    const age = a.ts ? t - a.ts : 1e9, c = age < 180 ? "act" : age < 900 ? "wait" : "";
    return `<div class="ag glass ${c}" title="${esc(a.last)}"><div class="ring">${esc(a.name[0])}</div><div class="n">${esc(a.name)}</div><div class="t">${a.ts ? ago(age).replace(" önce", "") : "—"}</div></div>`;
  }).join("") + `<div class="pipe-last">${esc(m.pipe[0]?.last || "")}</div>`;
  $("#pipeTs").textContent = m.last_log_ts ? "son kayıt " + hm(m.last_log_ts) : "";
  const f = m.today, fmax = Math.max(f.cands, 1);
  $("#funnel").innerHTML = [["Tarama", f.scans, Math.max(f.scans, 1)], ["Aday", f.cands, fmax], ["Elendi", f.kills, fmax], ["Skorlandı", f.scored, fmax], ["Geçti", f.passed, fmax], ["Sanal alım", f.entries, fmax]]
    .map(([k, v, mx]) => `<div class="fr"><span>${k}</span><div class="fb"><i style="width:${Math.min(100, v / mx * 100)}%"></i></div><b class="num">${v}</b></div>`).join("");
  const kmax = Math.max(1, ...m.kills.map(k => k[1]));
  $("#kills").innerHTML = m.kills.length ? `<div class="kills">` + m.kills.map(([k, v]) => `<div class="fr"><span>${esc(k)}</span><div class="fb"><i style="width:${v / kmax * 100}%"></i></div><b class="num">${v}</b></div>`).join("") + `</div>` : `<div class="muted sm">Bugün eleme yok</div>`;
  $("#trades").innerHTML = m.trades.length ? m.trades.map((x, i) => `<div class="row glass" data-trade="${i}">
      <div class="a">${esc(x.sym)} <small>${dhm(x.ts)} → ${hm(x.xts)}</small></div><div class="b ${cls(x.pnl)} num">${sgnUsd(x.pnl)}</div>
      <div class="c">${esc(x.why)}</div><div class="d num ${cls(x.pnl_pct)}">${pct(x.pnl_pct)}</div></div>`).join("") : `<div class="empty">Henüz kapanan işlem yok</div>`;
  // feed / alerts
  $("#feed").innerHTML = m.feed.map(e => `<div class="fe glass ${esc(e.k)}"><div class="l1"><time>${hm(e.ts)}</time><span class="ag2">${esc(e.ag)}</span><b>${esc(e.ev)}${e.n > 1 ? ` <span class="muted">×${e.n}</span>` : ""}</b>${e.sym ? `<span class="tag e">${esc(e.sym)}</span>` : ""}</div>${e.d ? `<div class="l2">${e.n > 1 ? "son: " : ""}${esc(e.d)}</div>` : ""}</div>`).join("");
  $("#alerts").innerHTML = m.alerts.length ? m.alerts.map(a => `<div class="al">${esc(a)}</div>`).join("") : `<div class="empty">Uyarı yok <span class="em">Fiyat ayrışması, izleme sessizliği gibi durumlar burada görünür</span></div>`;
}

let curvePts = null;
function drawCurve() {
  const m = D.meme, cv = $("#curve"); if (!m?.curve?.length || !m.bal) { ctx2d(cv,150); curvePts=null; return; }
  const pts = m.curve.slice(); const lastEq = m.bal.eq;
  if (pts.length && pts[pts.length - 1][0] < D.gen) pts.push([D.gen, lastEq]);
  const vals = pts.map(p => p[1]); const col = lastEq >= m.bal.start ? "#37f5a6" : "#ff4d6d";
  const r = drawLine(cv, vals, {color: col, ref: m.bal.start, dot: true, h: 150, pad: 14, xs: pts.map(p => p[0])});
  curvePts = {pts, r};
}
$("#curve").addEventListener("pointermove", e => {
  if (!curvePts?.r) return; const cv = e.currentTarget, rect = cv.getBoundingClientRect();
  const P = curvePts.pts, tx = P[0][0] + (e.clientX - rect.left) / rect.width * (P[P.length - 1][0] - P[0][0]);
  let p = P[0]; for (const q of P) { if (q[0] <= tx) p = q; else break; }
  const tip = $("#curveTip"); tip.style.opacity = 1; tip.style.left = Math.min(rect.width - 140, Math.max(0, e.clientX - rect.left - 60)) + "px";
  tip.textContent = `${dhm(p[0])} · ${usd(p[1])}`;
});
$("#curve").addEventListener("pointerleave", () => $("#curveTip").style.opacity = 0);

function posLive(p) {
  const quote = dex[p.mint], L = quote && Core.isFresh(quote.t, now(), 60) && Number.isFinite(quote.px) && quote.px > 0 ? quote : null; const last = L?.px ?? p.last;
  const val = p.qty * last * (1 - (D.meme.set.slip || 1.5) / 100);
  return {last, pnl: val - p.cost, pnl_pct: (val / p.cost - 1) * 100, live: !!L, ch5: L?.ch5};
}
function renderPositions() {
  const m = D.meme, el = $("#positions");
  if (!m.pos.length) { if (!el.querySelector(".empty")) el.innerHTML = `<div class="empty">Şu an açık pozisyon yok<span class="em">Masa ${m.status === "aktif" ? "taramaya devam ediyor; filtreyi geçen olursa burada canlı görünür" : "şu an " + m.status}</span></div>`; return; }
  el.innerHTML = m.pos.map((p, i) => {
    const L = posLive(p);
    return `<div class="pos glass" data-pos="${i}">
      <div class="pos-h"><span class="sym">${esc(p.sym)}</span><span class="pnl num ${cls(L.pnl)}" id="pp${i}">${sgnUsd(L.pnl)} · ${pct(L.pnl_pct)}</span></div>
      <div class="pos-g"><div><label>Giriş</label><b class="num">${fpx(p.entry)}</b></div><div><label>Şimdi ${L.live ? "· canlı" : "· masa"}</label><b class="num" id="pl${i}">${fpx(L.last)}</b></div><div><label>Stop</label><b class="num">${fpx(p.stop)}</b></div>
      <div><label>Boyut</label><b class="num">${usd(p.cost)}</b></div><div><label>İz süren</label><b>${p.armed ? "AKTİF" : "+%" + p.trail_on + "'te"}</b></div><div><label>Açılış</label><b class="num">${hm(p.ts)}</b></div></div>
      ${progHTML(p, L.last, i)}</div>`;
  }).join("");
}
function progHTML(p, last, i) {
  const lo = p.stop, hi = p.armed ? Math.max(p.peak, last) * 1.03 : p.entry * (1 + p.trail_on / 100);
  const pos = v => Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100));
  return `<div class="prog"><div class="rail"></div><span class="mk dn" style="left:0%">stop</span><span class="mk" style="left:${pos(p.entry)}%">giriş</span>
    <span class="mk up" style="left:${p.armed ? pos(p.peak) : 100}%">${p.armed ? "zirve" : "+%" + p.trail_on}</span><i class="now" id="pn${i}" style="left:${pos(last)}%"></i></div>`;
}
function updatePositionsLive() {
  if (!D?.meme?.pos) return;
  D.meme.pos.forEach((p, i) => {
    const L = posLive(p), el = $("#pl" + i); if (!el) return;
    const label = el.closest('.pos').querySelectorAll('.pos-g label')[1]; if (label) label.textContent = L.live ? 'Şimdi · canlı' : 'Şimdi · masa kaydı';
    const prev = el._v; el._v = L.last;
    setTxt(el, fpx(L.last), prev != null && L.last !== prev ? Math.sign(L.last - prev) : 0);
    const pp = $("#pp" + i); pp.textContent = `${sgnUsd(L.pnl)} · ${pct(L.pnl_pct)}`; pp.className = "pnl num " + cls(L.pnl);
    const lo = p.stop, hi = p.armed ? Math.max(p.peak, L.last) * 1.03 : p.entry * (1 + p.trail_on / 100);
    const n = $("#pn" + i); if (n) n.style.left = Math.max(0, Math.min(100, (L.last - lo) / (hi - lo) * 100)) + "%";
  });
}

/* ---------- radar ---------- */
function renderRadar() {
  const m = D?.meme; if (!m?.radar) { $("#radar").innerHTML = '<div class="empty">Radar verisi son kayıtta bulunmuyor.</div>'; return; }
  $("#radar").innerHTML = m.radar.length ? m.radar.map((c, i) => {
    const q = dex[c.mint], L = q && Core.isFresh(q.t, now(), 60) ? q : null; const tg = c.vk === "kill" ? "k" : c.vk === "pass" || c.vk === "approve" || c.vk === "paper_entry" ? "p" : "w";
    return `<div class="row glass" data-radar="${i}"><div class="a">${esc(c.sym)} <span class="tag ${tg}">${esc(c.v)}</span></div>
      <div class="b num" id="rp${i}">${L ? "$" + fpx(L.px) : "—"}</div>
      <div class="c">${hm(c.ts)} · ${esc(c.vd || c.dex || "")}</div>
      <div class="d num" id="rc${i}">${L ? `<span class="${cls(L.ch5)}">5dk ${pct(L.ch5, 1)}</span> · liq $${nf((L.liq || 0) / 1000, 0)}k` : "—"}</div></div>`;
  }).join("") : `<div class="empty">Radar boş</div>`;
}
function updateRadarLive() {
  D?.meme?.radar?.forEach((c, i) => {
    const q = dex[c.mint], L = q && Core.isFresh(q.t, now(), 60) ? q : null, el = $("#rp" + i); if (!el) return; if (!L) { el.textContent = "—"; $("#rc" + i).textContent = "Fiyat güncel değil"; return; }
    const prev = el._v; el._v = L.px; setTxt(el, "$" + fpx(L.px), prev != null && prev !== L.px ? Math.sign(L.px - prev) : 0);
    $("#rc" + i).innerHTML = `<span class="${cls(L.ch5)}">5dk ${pct(L.ch5, 1)}</span> · liq $${nf((L.liq || 0) / 1000, 0)}k`;
  });
}

/* ---------- spot desk ---------- */
function renderSpot() {
  const s = D.spot; if (!s || s.error) return;
  const n = $("#spotNet"); n.textContent = (s.net > 0 ? "+" : "") + nf(s.net); n.className = "num " + cls(s.net);
  const chip = $("#spotStatus"); chip.textContent = s.status;
  const stopped = s.status === "DURDURULDU";
  chip.className = "chip" + (stopped ? " red" : " yel");
  const card = chip.closest(".card"); if (card) card.classList.toggle("stopped", stopped);
  $("#spotStrat").textContent = s.strategy;
  const lab = $("#spotLabel"); if (lab) lab.textContent = s.label || "OKX verisi, Binance değil · sadece spot, kaldıraç yok";
  $("#spotN").textContent = s.n; $("#spotW").textContent = s.wins;
  const k = $("#spotKill"), kill = Core.killState(s.kill); k.textContent = kill.label; k.className = kill.tone;
  $("#spotGate").textContent = s.gate;
  $("#spotScanTs").textContent = s.scan_ts ? `${s.universe} parite · ${hm(s.scan_ts)}` : "";
  $("#spotInd").innerHTML = s.watch.filter(b => s.ind[b]).map(b => { const x = s.ind[b];
    return `<div class="glass"><b>${b}</b><span class="${x.trend === "yukarı" ? "up" : "dn"}">${x.trend}</span><span class="muted">RSI ${nf(x.rsi, 0)} · ADX ${nf(x.adx, 0)}</span><span class="muted">ATR %${nf(x.atr_pct, 1)}</span></div>`; }).join("") || `<div class="muted sm">Gösterge yok</div>`;
  $("#spotTrades").innerHTML = s.trades.map((t, i) => `<div class="row glass" data-spot="${i}"><div class="a">${esc(t.pair)} <small>${dhm(t.ts)} → ${hm(t.xts)}</small></div>
    <div class="b num ${cls(t.pnl)}">${(t.pnl > 0 ? "+" : "") + nf(t.pnl)} USDT</div><div class="c">${esc(t.why)}</div><div class="d num ${cls(t.pnl_pct)}">${pct(t.pnl_pct)}</div></div>`).join("") || `<div class="empty">İşlem yok</div>`;
}

/* ---------- team / box ---------- */
function renderTeam() {
  const t = now();
  $("#team").innerHTML = (D.team || []).map(a => { const age = a.ts ? t - a.ts : 1e9;
    return `<div class="tm glass"><div class="av">${esc(a.name.split(" ").map(w => w[0]).join("").slice(0, 2))}</div>
      <div><div class="nm">${esc(a.name)}</div><div class="ls">${esc(a.last)}</div></div>
      <div class="ts"><i class="${age < 4 * 3600 ? "ok" : age < 12 * 3600 ? "mid" : ""}"></i>${a.ts ? ago(age).replace(" önce", "") : "—"}</div></div>`; }).join("");
  const b = D.box || {};
  $("#boxUp").textContent = b.uptime_pct != null ? "%" + nf(b.uptime_pct, 1) : "—";
  $("#boxUp").className = "num " + (b.uptime_pct > 95 ? "up" : b.uptime_pct > 80 ? "" : "dn");
  $("#boxGaps").textContent = b.gaps ?? "—"; $("#boxMax").textContent = b.max_gap_s ? dur(b.max_gap_s) : "—";
  $("#boxSpan").textContent = b.span_h ? `son ${nf(b.span_h, 1)} sa` : "";
  drawStrip();
  const src = D.meme?.src || {};
  $("#srcs").innerHTML = Object.entries(src).map(([k, v]) => `<span>${esc(k)}</span><span class="${v.st === 200 ? "ok" : "bad"} num">${v.ok} ok · ${v.fail} hata</span>`).join("") +
    `<span>DexScreener (tarayıcı)</span><span class="${dexOk && now() - dexOk < 60 ? "ok" : "bad"}">${dexOk ? ago(now() - dexOk) : "bekleniyor"}</span>` +
    `<span>OKX (tarayıcı, ${okxMode === "ws" ? "WebSocket" : "REST"})</span><span class="${okxOk && now() - okxOk < 60 ? "ok" : "bad"}">${okxOk ? ago(now() - okxOk) : "bekleniyor"}</span>`;
  $("#about").innerHTML = `<p><b>SANAL (paper) — gerçek para yok.</b> Bu sayfa yalnızca izler; emir göndermez, anahtar istemez.</p>
    <p>Masa verisi kutudaki yayıncıdan ~${D.interval || 60} sn'de bir gelir, tarayıcı ${DATA_POLL / 1e3} sn'de bir çeker (kaynak: ${esc(dataSrc)}). Son veri: ${esc(D.gen_local)} (İstanbul).</p>
    <p>Canlı fiyatlar doğrudan tarayıcından: DexScreener (Solana) ~${DEX_POLL / 1e3} sn, OKX spot (Binance verisi değil) ${okxMode === "ws" ? "anlık WebSocket" : OKX_POLL / 1e3 + " sn"}. Mumlar GeckoTerminal ve OKX'ten gerçek veridir.</p>
    <p>Kutu durursa masa rakamları donar, sayfa bunu "eski veri" uyarısıyla gösterir. 7/24 kesintisiz çalışma ve getiri garantisi yoktur.</p>`;
}
function drawStrip() {
  const b = D.box, cv = $("#boxStrip"); if (!b?.span_h) { ctx2d(cv,46); return; }
  const [c, w, h] = ctx2d(cv, 46); const end = b.probe_last || D.gen, start = end - b.span_h * 3600;
  c.fillStyle = "rgba(55,245,166,.18)"; c.fillRect(0, 14, w, 18);
  c.fillStyle = "#ff4d6d"; c.shadowColor = "#ff4d6d"; c.shadowBlur = 8;
  (b.strip || []).forEach(([a, g]) => { const x = (a - start) / (end - start) * w; c.fillRect(x, 10, Math.max(2, g / (end - start) * w), 26); });
  c.shadowBlur = 0; c.fillStyle = "#8b91ad"; c.font = "10px Inter"; c.fillText(hm(start), 0, 46); const e = hm(end); c.fillText(e, w - c.measureText(e).width, 46);
}

/* ---------- tickers ---------- */
function watch() { return D?.spot?.watch || ["BTC", "ETH", "SOL", "XRP", "BNB", "DOGE", "ADA", "LINK"]; }
function renderTickers() {
  const el = $("#tickers"), list = watch();
  if (el.dataset.k !== list.join()) {
    el.dataset.k = list.join();
    el.innerHTML = list.map(b => `<div class="tk glass" data-okx="${b}"><div class="tk-h"><b>${b}</b><span id="tc-${b}">—</span></div><div class="p num" id="tp-${b}">—</div><canvas id="ts-${b}" height="38"></canvas><div class="meta"><span>15dk mum · 24 sa</span><span id="tv-${b}"></span></div></div>`).join("");
  }
  list.forEach(updTicker); list.forEach(drawSpark); updTape();
}
function updTicker(b) {
  const o = okx[b], p = $("#tp-" + b); if (!o || !p) return;
  p.classList.toggle("quote-stale", !Core.isFresh(o.t, now(), 60));
  const prev = p._v; p._v = o.px; setTxt(p, fpx(o.px), prev != null && prev !== o.px ? Math.sign(o.px - prev) : 0);
  const c = $("#tc-" + b); c.textContent = pct(o.ch); c.className = cls(o.ch);
  $("#tv-" + b).textContent = o.src === "masa" ? "masa verisi · " + hm(o.t) : "$" + nf(o.vol / 1e6, 1) + "M";
}
function drawSpark(b) { const cv = $("#ts-" + b), s = spark[b]; if (!cv || !s) return; const v = s.slice(); if (okx[b]) v[v.length - 1] = okx[b].px; drawLine(cv, v, {color: v[v.length - 1] >= v[0] ? "#37f5a6" : "#ff4d6d", h: 38, lw: 1.6, glow: 6, pad: 3}); }
function updTape() {
  const items = watch().filter(b => okx[b]).map(b => `<span><b>${b}</b><span class="num">${(fpx(okx[b].px) + (Core.isFresh(okx[b].t, now(), 60) ? "" : " (eski)"))}</span><span class="${cls(okx[b].ch)} num">${pct(okx[b].ch)}</span></span>`);
  if (D?.meme) items.unshift(`<span><b>Memecoin masası</b><span class="num">$${nf(D.meme.bal.eq)}</span><span class="${cls(D.meme.bal.pnl_pct)} num">${pct(D.meme.bal.pnl_pct)}</span></span>`);
  items.push(`<span><b>OKX verisi</b><span>Binance değil</span></span>`, `<span><b>SANAL</b><span>gerçek para yok</span></span>`);
  const html = items.join(""); const t = $("#tapeIn"); if (t._h !== html) { t._h = html; t.innerHTML = html + html; }
}

function onOkxTicker(x) {
  const b = x.instId.split("-")[0], px = +x.last, op = +x.open24h;
  okx[b] = {px, ch: op ? (px / op - 1) * 100 : 0, vol: +x.volCcy24h || 0, t: now(), src: x.src || "okx"}; if (!x.src) okxOk = now();
  updTicker(b); if (sheet.kind === "okx" && sheet.base === b) sheetLivePx(px, okx[b].ch);
}
let ws = null, wsFails = 0, wsPing = null, restTimer = null;
function okxWS() {
  try { ws = new WebSocket("wss://ws.okx.com/ws/v5/public"); } catch (e) { return okxREST(); }
  const to = setTimeout(() => { if (ws.readyState !== 1) { ws.close(); } }, 8000);
  ws.onopen = () => { clearTimeout(to); wsFails = 0; okxMode = "ws"; ws.send(JSON.stringify({op: "subscribe", args: watch().map(b => ({channel: "tickers", instId: b + "-USDT"}))}));
    clearInterval(wsPing); wsPing = setInterval(() => ws.readyState === 1 && ws.send("ping"), 20e3); };
  ws.onmessage = e => { if (e.data === "pong") return; try { const j = JSON.parse(e.data); (j.data || []).forEach(onOkxTicker); } catch (_) {} };
  ws.onclose = () => { clearInterval(wsPing); wsFails++; setTimeout(okxWS, Math.min(60e3, 2e3 * 2 ** wsFails)); };
  ws.onerror = () => {};
}
function okxREST() {
  if (restTimer) return;
  const run = async () => { if (okxMode === "ws" && ws?.readyState === 1 && now() - okxOk < 15) return; okxMode = "rest"; await Promise.all(watch().map(async b => { try { const [j] = await getJSON(`https://www.okx.com/api/v5/market/ticker?instId=${b}-USDT`); j.data?.[0] && onOkxTicker(j.data[0]); } catch (_) {} })); updTape(); };
  run(); restTimer = setInterval(run, OKX_POLL);
}
async function pollSparks() {
  for (const b of watch()) {
    try { const [j] = await getJSON(`https://www.okx.com/api/v5/market/candles?instId=${b}-USDT&bar=15m&limit=96`); spark[b] = j.data.map(r => +r[4]).reverse(); drawSpark(b); } catch (_) {}
  }
}
setInterval(updTape, 5e3);

/* ---------- DexScreener ---------- */
async function pollDex() {
  if (!D?.meme) return;
  const want = [...new Set([...(D.meme.pos || []).map(p => p.mint), ...(D.meme.radar || []).map(c => c.mint)])].slice(0, 30);
  if (!want.length) return;
  try {
    const [arr] = await getJSON(`https://api.dexscreener.com/tokens/v1/solana/${want.join(",")}`);
    const pairOf = {}; (D.meme.pos || []).forEach(p => pairOf[p.mint] = p.pair);
    const best = {};
    for (const p of arr || []) {
      const m = p.baseToken?.address; if (!m || !Number.isFinite(+p.priceUsd) || +p.priceUsd <= 0) continue;
      const pref = pairOf[m] && p.pairAddress === pairOf[m];
      if (!best[m] || pref || (!best[m]._pref && (p.liquidity?.usd || 0) > (best[m].liquidity?.usd || 0))) { best[m] = p; p._pref = pref; }
    }
    for (const [m, p] of Object.entries(best)) dex[m] = {px: +p.priceUsd, ch5: p.priceChange?.m5, ch1: p.priceChange?.h1, ch24: p.priceChange?.h24, liq: p.liquidity?.usd, pair: p.pairAddress, url: p.url, mcap: p.marketCap, t: now()};
    if (Object.keys(best).length) dexOk = now(); $("#posLive").classList.remove("off"); $("#radarLive").classList.remove("off");
    updatePositionsLive(); updateRadarLive();
    if (sheet.kind === "dex" && !sheet.fixed && best[sheet.mint]) { const L = dex[sheet.mint]; sheetLivePx(L.px, L.ch24, "24s", L.t); }
  } catch (_) { if (now() - dexOk > 60) { $("#posLive").classList.add("off"); $("#radarLive").classList.add("off"); } }
}

/* ---------- sheet with real candles ---------- */
const sheet = {kind: null};
let sheetOpener = null;
function openSheet(o) {
  sheetOpener = document.activeElement;
  for (const k of Object.keys(sheet)) delete sheet[k];
  Object.assign(sheet, {kind: null, mint: null, base: null, pair: null, inst: null, marks: [], tf: null, tfs: [], c: null, until: null, fixed: false}, o);
  $("#shPx").classList.remove("quote-stale");
  sheet.quoteAt = o.quoteAt || null; sheet.originalSub = o.sub || "";
  $("#shT").textContent = o.title; $("#shS").textContent = o.sub || ""; $("#shPx").textContent = o.px != null ? fpx(o.px) : "—"; $("#shCh").textContent = "";
  $("#shGrid").innerHTML = (o.grid || []).map(([k, v, c]) => `<div><label>${esc(k)}</label><b class="num ${c || ""}">${esc(v)}</b></div>`).join("");
  $("#shNote").innerHTML = o.note || "";
  $("#shTf").innerHTML = sheet.tfs.map(t => `<button data-tf="${t[0]}" class="${t[0] === sheet.tf ? "on" : ""}">${t[1]}</button>`).join("");
  $("#sheet").classList.add("on"); $("#sheetBg").classList.add("on");
  loadCandles();
  $("#sheet").setAttribute("aria-hidden", "false");
  $("#sheet").inert = false;
  document.querySelector("main").inert = true;
  $("#nav").inert = true;
  $("#shX").focus();
}
function closeSheet() { $("#sheet").classList.remove("on"); $("#sheetBg").classList.remove("on"); sheet.kind = null; sheet.tok = null; $("#sheet").setAttribute("aria-hidden", "true"); $("#sheet").inert = true; document.querySelector("main").inert = false; $("#nav").inert = false; sheetOpener?.focus(); }
$("#shX").onclick = closeSheet; $("#sheetBg").onclick = closeSheet;
document.addEventListener("keydown", e => e.key === "Escape" && closeSheet());
$("#shTf").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; sheet.tf = b.dataset.tf; [...$("#shTf").children].forEach(x => x.classList.toggle("on", x === b)); loadCandles(); });
function sheetLivePx(px, ch, lbl = "24s", quoteAt = now()) { sheet.quoteAt = quoteAt; const el = $("#shPx"), prev = el._v; el._v = px; setTxt(el, fpx(px), prev != null && prev !== px ? Math.sign(px - prev) : 0); const c = $("#shCh"); c.textContent = ch != null ? `${lbl} ${pct(ch)}` : ""; c.className = "num " + cls(ch);
  if (sheet.c?.length) { const last = sheet.c[sheet.c.length - 1]; if (!sheet.fixed) { last.c = px; last.h = Math.max(last.h, px); last.l = Math.min(last.l, px); drawCandles(); } } }

async function loadCandles() {
  const msg = $("#shMsg"); msg.textContent = "Gerçek mumlar yükleniyor…"; sheet.c = null; ctx2d($("#shChart"), 260);
  const k = sheet.kind, token = Symbol(); sheet.tok = token;
  try {
    let c = [];
    if (k === "dex") {
      if (!sheet.pair && dex[sheet.mint]) sheet.pair = dex[sheet.mint].pair;
      if (!sheet.pair) throw new Error("Bu coin için havuz adresi yok");
      const [tf, agg] = sheet.tf.split(":");
      const before = sheet.until ? `&before_timestamp=${Math.round(sheet.until)}` : "";
      const [j] = await getJSON(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${sheet.pair}/ohlcv/${tf}?aggregate=${agg}&limit=200&currency=usd${before}`, {headers: {Accept: "application/json"}});
      c = (j.data?.attributes?.ohlcv_list || []).map(r => ({t: r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5]})).reverse();
    } else {
      const after = sheet.until ? `&after=${Math.round(sheet.until * 1000)}` : "";
      const ep = sheet.until ? "history-candles" : "candles";
      const [j] = await getJSON(`https://www.okx.com/api/v5/market/${ep}?instId=${sheet.inst}&bar=${sheet.tf}&limit=${sheet.until ? 100 : 200}${after}`);
      c = (j.data || []).map(r => ({t: +r[0] / 1000, o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5]})).reverse();
    }
    if (sheet.tok !== token) return;
    if (!c.length) throw new Error("Bu aralık için mum verisi yok");
    sheet.c = c; msg.textContent = ""; drawCandles();
  } catch (e) { if (sheet.tok === token) msg.textContent = (e.status === 429 ? "Mum servisi şu an yoğun (429), birazdan tekrar dene." : e.message || "Mum verisi alınamadı") + ""; }
}
function drawCandles() {
  const cv = $("#shChart"), c = sheet.c; if (!c?.length) return;
  const [g, w, h] = ctx2d(cv, 260); const padR = 64, padB = 18, padT = 8, W = w - padR, H = h - padB - padT;
  const marks = sheet.marks || [];
  let lo = Math.min(...c.map(x => x.l)), hi = Math.max(...c.map(x => x.h));
  marks.forEach(m => { if (m.y != null && m.y > 0 && m.y > lo * 0.7 && m.y < hi * 1.4) { lo = Math.min(lo, m.y); hi = Math.max(hi, m.y); } });
  const r = (hi - lo) || hi * 0.01 || 1; lo -= r * 0.04; hi += r * 0.04;
  const Y = v => padT + (1 - (v - lo) / (hi - lo)) * H, bw = W / c.length;
  g.strokeStyle = "rgba(255,255,255,.05)"; g.fillStyle = "#5a6080"; g.font = "10px Inter";
  for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4, y = Y(v); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); g.fillText(fpx(v), W + 6, y + 3); }
  const t0 = c[0].t, t1 = c[c.length - 1].t; [0, .5, 1].forEach(f => { const i = Math.min(c.length - 1, Math.round(f * (c.length - 1))); const s = hm(c[i].t); g.fillText(s, Math.min(W - 26, Math.max(0, i * bw)), h - 4); });
  c.forEach((x, i) => {
    const up = x.c >= x.o, col = up ? "#37f5a6" : "#ff4d6d", cx = i * bw + bw / 2;
    g.strokeStyle = col; g.lineWidth = 1; g.beginPath(); g.moveTo(cx, Y(x.h)); g.lineTo(cx, Y(x.l)); g.stroke();
    g.fillStyle = col; const y1 = Y(Math.max(x.o, x.c)), y2 = Y(Math.min(x.o, x.c)); g.fillRect(cx - Math.max(1, bw * .35), y1, Math.max(2, bw * .7), Math.max(1, y2 - y1));
  });
  const last = c[c.length - 1].c; g.setLineDash([2, 3]); g.strokeStyle = "rgba(255,255,255,.5)"; g.beginPath(); g.moveTo(0, Y(last)); g.lineTo(W, Y(last)); g.stroke(); g.setLineDash([]);
  g.fillStyle = "#eef1ff"; g.fillRect(W + 2, Y(last) - 8, padR - 4, 16); g.fillStyle = "#05060b"; g.fillText(fpx(last), W + 6, Y(last) + 3);
  marks.forEach(m => {
    if (m.y != null && m.y >= lo && m.y <= hi) { g.strokeStyle = m.col; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(0, Y(m.y)); g.lineTo(W, Y(m.y)); g.stroke(); g.setLineDash([]); g.fillStyle = m.col; g.fillText(m.label, 4, Y(m.y) - 4); }
    if (m.t && m.t >= t0 && m.t <= t1 + (t1 - t0) / c.length) { const x = (m.t - t0) / (t1 - t0 || 1) * (W - bw) + bw / 2; g.fillStyle = m.col; g.beginPath(); g.arc(x, Y(m.y ?? last), 5, 0, 7); g.fill(); g.strokeStyle = "#05060b"; g.lineWidth = 2; g.stroke(); g.lineWidth = 1; }
  });
}
setInterval(() => { if (sheet.kind && !sheet.until) loadCandles(); }, 45e3);
window.addEventListener("resize", () => { if (D) { drawCurve(); drawStrip(); watch().forEach(drawSpark); } drawCandles(); });

const DEX_TF = [["minute:1", "1dk"], ["minute:5", "5dk"], ["minute:15", "15dk"], ["hour:1", "1sa"]];
const OKX_TF = [["15m", "15dk"], ["1H", "1sa"], ["4H", "4sa"], ["1D", "1g"]];
document.addEventListener("click", e => {
  const t = e.target.closest("[data-pos],[data-trade],[data-radar],[data-okx],[data-spot]"); if (!t || !D) return;
  if (t.dataset.pos != null) { const p = D.meme.pos[+t.dataset.pos], L = posLive(p);
    openSheet({kind: "dex", quoteAt: L.live ? dex[p.mint].t : D.gen, title: p.sym, sub: "Açık sanal pozisyon · GeckoTerminal mumları", mint: p.mint, pair: p.pair, px: L.last, tfs: DEX_TF, tf: "minute:1",
      marks: [{label: "giriş", y: p.entry, t: p.ts, col: "#4de2ff"}, {label: "stop", y: p.stop, col: "#ff4d6d"}, p.armed ? {label: "zirve", y: p.peak, col: "#ffd166"} : {label: "iz süren +%" + p.trail_on, y: p.entry * (1 + p.trail_on / 100), col: "#ffd166"}],
      grid: [["Giriş", fpx(p.entry)], ["Stop", fpx(p.stop)], ["PnL", `${sgnUsd(L.pnl)} (${pct(L.pnl_pct)})`, cls(L.pnl)], ["Boyut", usd(p.cost)], ["Skor", p.score ?? "—"], ["Açılış", dhm(p.ts)]],
      note: p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">DexScreener'da aç ↗</a> · PnL çıkışta %${D.meme.set.slip} kayma+ücret düşülerek hesaplanır` : ""}); }
  else if (t.dataset.trade != null) { const x = D.meme.trades[+t.dataset.trade], span = Math.max(1800, (x.xts - x.ts));
    openSheet({kind: "dex", title: x.sym, sub: `Kapanan sanal işlem · ${dhm(x.ts)} → ${dhm(x.xts)}`, mint: x.mint, pair: x.pair, px: x.exit, fixed: true, until: x.xts + span * 1.5, tfs: DEX_TF.slice(0, 3), tf: span > 4 * 3600 ? "minute:15" : "minute:1",
      marks: [{label: "giriş", y: x.entry, t: x.ts, col: "#4de2ff"}, {label: "çıkış", y: x.exit, t: x.xts, col: x.pnl >= 0 ? "#37f5a6" : "#ff4d6d"}, {label: "stop", y: x.stop, col: "rgba(255,77,109,.6)"}],
      grid: [["Giriş", fpx(x.entry)], ["Çıkış", fpx(x.exit)], ["PnL", `${sgnUsd(x.pnl)} (${pct(x.pnl_pct)})`, cls(x.pnl)], ["Zirve", fpx(x.peak)], ["Boyut", usd(x.cost)], ["Neden", x.why]],
      note: (x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">DexScreener'da aç ↗</a> · ` : "") + "Mumlar GeckoTerminal'in gerçek verisi; giriş/çıkış noktaları masanın kayıtlı dolum fiyatları."}); }
  else if (t.dataset.radar != null) { const c = D.meme.radar[+t.dataset.radar], q = dex[c.mint], L = q && Core.isFresh(q.t, now(), 60) ? q : null;
    openSheet({kind: "dex", quoteAt: L?.t, title: c.sym, sub: `Radar · masa kararı: ${c.v}`, mint: c.mint, pair: L?.pair, px: L?.px, tfs: DEX_TF, tf: "minute:5",
      grid: [["Mcap (bulunduğunda)", "$" + nf((c.mcap || 0) / 1000, 0) + "k"], ["Likidite", L ? "$" + nf(L.liq / 1000, 0) + "k" : "—"], ["1 sa", L ? pct(L.ch1, 1) : "—", cls(L?.ch1)], ["Bulundu", dhm(c.ts)], ["Yaş", (c.age_h ?? "?") + " sa"], ["Not", c.vd || "—"]],
      note: (L?.url ? `<a href="${esc(L.url)}" target="_blank" rel="noopener">DexScreener'da aç ↗</a> · ` : "") + "Sadece gözlem; masa bu coinde pozisyon açmadıysa sanal bakiye etkilenmez."}); }
  else if (t.dataset.okx) { const b = t.dataset.okx, o = okx[b], ind = D.spot?.ind?.[b];
    openSheet({kind: "okx", quoteAt: o?.t, title: b + "/USDT", sub: "OKX spot · Binance verisi değil", base: b, inst: b + "-USDT", px: o?.px, tfs: OKX_TF, tf: "15m",
      grid: [["24 sa", o ? pct(o.ch) : "—", cls(o?.ch)], ["Hacim 24 sa", o ? "$" + nf(o.vol / 1e6, 1) + "M" : "—"], ["Trend (1sa EMA)", ind?.trend || "—"], ["RSI", ind ? nf(ind.rsi, 0) : "—"], ["ADX", ind ? nf(ind.adx, 0) : "—"], ["ATR", ind ? "%" + nf(ind.atr_pct, 1) : "—"]],
      note: "Son kayıttaki spot durum: " + (D.spot?.status || "bilinmiyor") + ". Bu fiyatlar izleme içindir."}); }
  else if (t.dataset.spot != null) { const x = D.spot.trades[+t.dataset.spot];
    openSheet({kind: "okx", title: x.pair, sub: `Kapanan sanal işlem · OKX verisi, Binance değil`, inst: x.pair.replace("/", "-"), px: x.exit, fixed: true, until: x.xts + 4 * 3600, tfs: [["15m", "15dk"], ["1H", "1sa"]], tf: "15m",
      marks: [{label: "giriş", y: x.entry, t: x.ts, col: "#4de2ff"}, {label: "çıkış", y: x.exit, t: x.xts, col: x.pnl >= 0 ? "#37f5a6" : "#ff4d6d"}],
      grid: [["Giriş", fpx(x.entry)], ["Çıkış", fpx(x.exit)], ["PnL", (x.pnl > 0 ? "+" : "") + nf(x.pnl) + " USDT", cls(x.pnl)], ["Boyut", nf(x.size) + " USDT"], ["Ücret", nf(x.fees)], ["Neden", x.why]]}); }
});

/* ---------- deney (lab) ---------- */
function renderLab() {
  const L = D.lab; if (!L || L.error) return;
  const S = L.sol, O = L.okx;
  const eqLine = (b, x) => { const e = $(b); e.textContent = usd(x.eq); e.className = "num " + cls(x.eq - x.start); };
  eqLine("#labSolEq", S); eqLine("#labOkxEq", O);
  $("#labSolSub").textContent = `${S.n} işlem · ${S.wins} kazanan · net ${sgnUsd(S.net)}`;
  $("#labOkxSub").textContent = `${O.n} işlem · ${O.wins} kazanan · net ${sgnUsd(O.net)}`;
  const st = $("#labStatus"); const halted = S.halted || O.halted; st.textContent = halted ? "GÜNLÜK LİMİT" : "ÇALIŞIYOR"; st.className = "chip" + (halted ? " red" : "");
  $("#labSet").textContent = L.settings; $("#labOSet").textContent = L.osettings;
  const sc = O.scan; $("#labScan").textContent = sc ? `OKX: ${sc.universe} enstrüman (${sc.spot} spot, ${sc.perp} vadeli) · ${sc.time.slice(11, 16)} · Solana tur ${S.passes}` : "";
  const tag = (t, c) => `<span class="lab-tag ${c || ""}">${esc(t)}</span>`;
  const rows = [];
  const B = L.bysrc, SM = L.smart;
  if (B) {
    const nm = {SMART: "Akıllı cüzdan", SPIKE: "Hacim patlaması", BASE: "Mevcut akış"};
    $("#labSrc").innerHTML = ["SMART", "SPIKE", "BASE"].map(k => { const b = B[k] || {n: 0, w: 0, net: 0}; return `<div class="row glass"><div class="a">${esc(nm[k])}${tag(k)}</div><div class="b num ${cls(b.net)}">${sgnUsd(b.net)}</div><div class="c">${b.n} işlem · ${b.w} kazanan${b.open ? " · " + b.open + " açık" : ""}</div><div class="d num muted">${b.wr == null ? "—" : nf(b.wr, 0) + "%"}</div></div>`; }).join("")
      + (SM ? `<div class="row glass"><div class="a">Akıllı cüzdan listesi</div><div class="b num">${SM.wallets || 0}</div><div class="c">A sınıfı ${SM.tier_a ?? 0} · B ${SM.tier_b ?? 0} · ${SM.pools ?? 0} havuzdan · izlenen alım ${SM.buys ?? 0}</div><div class="d num muted">${esc((SM.gen || "").slice(11, 16))}</div></div>` : "")
      + (SM && SM.recent && SM.recent.length ? SM.recent.map(x => `<div class="row glass"><div class="a">${esc(x.sym)}${tag(x.src)} <small>${hm(x.ts)}</small></div><div class="b num muted">${esc(x.d)}</div><div class="c">sinyal → güvenlik filtresi</div><div class="d"></div></div>`).join("") : "");
    $("#labSrcRule").textContent = SM ? SM.rule + " · halka açık veri (GeckoTerminal işlemleri, DexScreener, RugCheck, Solana RPC), anahtar yok" : "";
  }
  for (const p of S.pos) rows.push(`<div class="row glass"><div class="a">${esc(p.sym)}${tag("Solana")}${p.src && p.src !== "BASE" ? tag(p.src) : ""}</div><div class="b num ${cls(p.pnl)}">${sgnUsd(p.pnl)}</div><div class="c">${fpx(p.entry)} → ${fpx(p.last)}${p.armed ? " · trailing" : ""}</div><div class="d num ${cls(p.chg)}">${pct(p.chg, 1)}</div></div>`);
  for (const p of O.pos) rows.push(`<div class="row glass"><div class="a">${esc(p.inst.replace("-USDT-SWAP", " perp").replace("-USDT", " spot"))}${tag(p.side, p.side)}${tag(p.lev + "x")}</div><div class="b num ${cls(p.pnl)}">${sgnUsd(p.pnl)}</div><div class="c">${fpx(p.entry)} → ${fpx(p.last)} · stop ${fpx(p.stop)}${p.liq ? " · tasfiye " + fpx(p.liq) : ""}</div><div class="d num ${cls(p.chg)}">${pct(p.chg, 1)}</div></div>`);
  $("#labPos").innerHTML = rows.join("") || `<div class="empty">Açık pozisyon yok</div>`;
  const Q = L.quant;
  if (Q) {
    const F = Q.flow, k$ = v => v == null ? "—" : (v < 0 ? "-$" : "+$") + nf(Math.abs(v) / 1000, 0) + "k";
    if (F) {
      $("#labFlowTs").textContent = hm(F.gen);
      $("#labFlow").innerHTML = F.rows.map(x => `<div class="row glass"><div class="a">${esc(x.s)}${x.pos ? tag("pozisyon " + x.pos, x.pos) : ""}${x.adv ? tag("ters akış", "short") : ""}</div><div class="b num ${cls(x.net15)}">${k$(x.net15)}</div><div class="c">15 dk dengesizlik ${x.imb == null ? "—" : nf(x.imb * 100, 0) + "%"} · 1 sa ${k$(x.net1h)}${x.doi != null ? " · OI " + pct(x.doi, 1) : ""}${x.big_b || x.big_s ? " · büyük al " + k$(x.big_b) + " / sat " + k$(-x.big_s) : ""}</div><div class="d num muted">${x.fund == null ? "" : "funding " + nf(x.fund, 3) + "%"}</div></div>`).join("")
        + (F.sol || []).map(x => `<div class="row glass"><div class="a">${esc(x.s)}${tag("Solana")}</div><div class="b num ${cls(x.net15)}">${k$(x.net15)}</div><div class="c">15 dk dengesizlik ${nf((x.imb || 0) * 100, 0)}% · büyük işlem ${x.big}</div><div class="d"></div></div>`).join("");
      $("#labWhale").innerHTML = (F.alerts || []).length ? F.alerts.map(a => `<div class="row glass"><div class="a">${esc(a.s)}${tag(a.type === "large_trade" ? "balina " + (a.side === "buy" ? "alış" : "satış") : "akış dengesizliği", a.side === "sell" || (a.usd < 0) ? "short" : "long")} <small>${esc(a.t)}</small></div><div class="b num">${k$(a.usd)}</div><div class="c">${esc(a.v)}${a.pos ? " · açık pozisyonumuz: " + esc(a.pos) : ""}</div><div class="d"></div></div>`).join("") : `<div class="empty">Henüz büyük işlem uyarısı yok</div>`;
    }
    const M2 = Q.ml;
    if (M2) {
      $("#labMlTs").textContent = `LightGBM · test AUC ${M2.auc ?? "—"}`;
      const t = M2.terc || {};
      $("#labMl").innerHTML = `<div class="row glass"><div class="a">Geçmiş test (${M2.n_test} aday)</div><div class="b num">${t.high ? nf(t.high.win_pct, 0) + "% / " + nf(t.low.win_pct, 0) + "%" : "—"}</div><div class="c">yüksek skorlu üçte bir vs düşük: kazanma oranı · ort. ${t.high ? pct(t.high.mean_ret_pct, 2) + " / " + pct(t.low.mean_ret_pct, 2) : ""}</div><div class="d num muted">gölge mod</div></div>`
        + (M2.recent || []).map(x => `<div class="row glass"><div class="a">${esc((x.inst || "").replace("-USDT-SWAP", " perp").replace("-USDT", " spot"))}${tag(x.side, x.side)}${x.flag ? tag("sinyal") : ""}${x.in ? tag("girildi") : ""}</div><div class="b num">${nf((x.p || 0) * 100, 0)}%</div><div class="c">model kazanma olasılığı (işleme karışmaz)</div><div class="d"></div></div>`).join("");
    }
    const O2 = Q.opt;
    if (O2) {
      $("#labOptTs").textContent = `optuna · ${O2.syms} vadeli · ${esc((O2.gen || "").slice(11, 16))}`;
      $("#labOpt").innerHTML = (O2.folds || []).map(f => `<div class="row glass"><div class="a">Dönem ${f.k} (test, örneklem dışı)</div><div class="b num ${cls(f.ob)}">${pct(f.ob, 1)}</div><div class="c">optimize ${f.on} işlem · mevcut kural ${pct(f.oc, 1)} (${f.ocn} işlem)</div><div class="d"></div></div>`).join("") + `<p class="hint">${esc(O2.verdict || "")} · Sonuçlar otomatik uygulanmaz.</p>`;
    }
    const V = Q.risk_vetoes || [];
    $("#labRisk").innerHTML = V.length ? V.map(v => `<div class="row glass"><div class="a">${esc((v.inst || "").replace("-USDT-SWAP", " perp").replace("-USDT", " spot"))} <small>${hm(v.ts)}</small></div><div class="b num muted">veto</div><div class="c">${esc(v.why)}</div><div class="d"></div></div>`).join("") : `<div class="empty">Portföy limiti henüz bir girişi engellemedi</div>`;
  }
  const tr = [...S.trades.map(t => ({...t, name: t.sym, book: t.src && t.src !== "BASE" ? "Solana " + t.src : "Solana"})), ...O.trades.map(t => ({...t, name: t.inst.replace("-USDT-SWAP", " perp").replace("-USDT", " spot"), book: t.side + " " + t.lev + "x"}))].sort((a, b) => b.xts - a.xts).slice(0, 20);
  $("#labTrades").innerHTML = tr.map(t => `<div class="row glass"><div class="a">${esc(t.name)}${tag(t.book)} <small>${hm(t.xts)}</small></div><div class="b num ${cls(t.pnl)}">${sgnUsd(t.pnl)}</div><div class="c">${esc(t.why)}</div><div class="d num ${cls(t.pct)}">${pct(t.pct, 1)}</div></div>`).join("") || `<div class="empty">Henüz kapanan işlem yok</div>`;
  $("#labCls").textContent = Object.entries(L.classes || {}).map(([k, v]) => `${k} ${v}`).join(" · ");
  $("#labPm").innerHTML = (L.pm || []).map(x => `<div class="row glass"><div class="a">${esc(x.id)}${tag(x.book)}${tag(x.side, x.side)}</div><div class="b num ${cls(x.pnl)}">${sgnUsd(x.pnl)}</div><div class="c">${esc(x.cls)}${x.lesson ? " — " + esc(x.lesson) : ""}</div><div class="d num muted">MFE ${pct(x.mfe, 0)} / MAE ${pct(x.mae, 0)}</div></div>`).join("") || `<div class="empty">Kapanan her işlem burada nedeniyle görünecek</div>`;
  const M = L.missed;
  if (M) {
    $("#labMissTs").textContent = `${M.date} · ${hm(M.gen)}`;
    const a = M.ake;
    $("#labAke").innerHTML = a ? `<div class="card glass lab-ake"><div class="card-h">AKE (OKX, yalnızca vadeli)</div><div>Gün açılışı ${fpx(a.open)} → zirve ${fpx(a.high)} (${esc(a.high_time)}) · şimdi ${fpx(a.last)}</div><div class="num"><b class="up">${pct(a.up, 1)}</b> açılıştan zirveye · <b class="${cls(a.move)}">${pct(a.move, 1)}</b> açılıştan şimdiye · 24 sa ${pct(a.chg24h, 1)}</div><div class="muted sm">Neden kaçtı: OKX spot masasının evreninde yoktu (yalnızca vadeli). Deney masası artık tüm OKX spot+vadeli enstrümanlarını izliyor.</div></div>` : "";
    $("#labMiss").innerHTML = M.okx.map((m, i) => `<div class="row glass"><div class="a">${i + 1}. ${esc(m.inst.replace("-USDT-SWAP", " perp").replace("-USDT", " spot"))}</div><div class="b num up">${pct(m.up, 1)}</div><div class="c">${esc(m.why)}</div><div class="d num ${cls(m.move)}">${pct(m.move, 1)}</div></div>`).join("")
      + M.ds.map((d, i) => `<div class="row glass"><div class="a">${i + 1}. ${esc(d.sym)}${tag("DexScreener")}</div><div class="b num up">${pct(d.h24, 0)}</div><div class="c">${esc(d.why)}</div><div class="d num muted">liq $${nf((d.liq || 0) / 1000, 0)}k</div></div>`).join("");
    $("#labRules").innerHTML = M.rules.map(x => `<div class="row glass"><div class="a">${esc(x.rule)}</div><div class="b num ${cls(x.avg)}">${pct(x.avg, 2)} ort.</div><div class="c">${x.n} işlem · ${x.w} kazanan · yakaladığı: ${esc((x.caught || []).join(", ") || "—")}</div><div class="d num muted">${x.n ? nf(100 * x.w / x.n, 0) : 0}%</div></div>`).join("") + `<p class="hint">Bugünün OKX mumlarında oynatma: stop −%7, trailing +%13/%7, maliyet dahil. Tek günlük veri; kural değişikliği ≥30 ileriye dönük işlemden sonra.</p>`;
  } else { $("#labMiss").innerHTML = `<div class="empty">Rapor saatlik üretiliyor</div>`; }
}


/* ---------- balina ---------- */
function renderWhale() {
  const W = D.whale; if (!W) return;
  if (!Number.isFinite(W.gen)) throw Error('Balina veri zamanı bulunamadı');
  const tag = (t, c) => `<span class="lab-tag ${c || ""}">${esc(t)}</span>`;
  const k$ = v => v == null ? "—" : (v < 0 ? "-$" : "+$") + (Math.abs(v) >= 1e6 ? nf(Math.abs(v) / 1e6, 2) + "M" : nf(Math.abs(v) / 1000, 0) + "k");
  const st = $("#whStatus"); st.textContent = W.safe ? "GÜVENLİ MOD" : "CANLI"; st.className = "chip" + (W.safe ? " red" : "");
  const Q = W.q || {};
  $("#whQ").textContent = Q.cov != null ? nf(Q.cov * 100, 1) + "%" : "—";
  $("#whQs").textContent = `işlem kapsama (1 dk mum hacmine göre) · gecikme p50 ${Q.lat50 ?? "—"} ms / p95 ${Q.lat95 ?? "—"} ms · defter sıra hatası ${Q.seq_bad ?? 0} · yeniden bağlanma ${Object.values(Q.rc || {}).reduce((a, b) => a + b, 0)} · ${Object.values(Q.ws || {}).filter(Boolean).length}/${Object.keys(Q.ws || {}).length} WS bağlı`;
  const P = W.paper || {}; $("#whEq").textContent = P.eq != null ? usd(P.eq) : "—"; $("#whEq").className = "num " + cls((P.eq || 0) - (P.start || 0));
  $("#whEqs").textContent = (P.strats && P.strats.length) ? `kağıt işlem: ${P.strats.join(", ")}` : "OOS testini geçen strateji yok → işlem açılmıyor, hepsi gölgede";
  $("#whMeta").textContent = `${W.n} enstrüman canlı izleniyor · BTC yönü: ${W.btc || "—"} · WS/REST karşılaştırma ${(Q.rest || []).map(x => x.s + " " + (x.r == null ? "—" : nf(x.r * 100, 1) + "%")).join(", ") || "bekleniyor"} · ${Q.pauses || 0} duraklama · ${hm(W.gen)}${W.safe ? " · " + (W.safe_why || "") : ""}${P.kill ? " · ACİL DURDURMA AKTİF" : ""}`;
  $("#whAlTs").textContent = `${Q.alerts ?? 0} uyarı (bu oturum)`;
  const sideCls = a => (a.side === "buy" || a.side === "bid" || a.side === "up") ? "long" : ((a.side === "sell" || a.side === "ask" || a.side === "down") ? "short" : "");
  $("#whAlerts").innerHTML = (W.alerts || []).slice(0, 18).map(a => `<div class="row glass"><div class="a">${esc(a.s)} ${tag(a.ti || a.ty, sideCls(a))} <small>${hm(a.t)}</small></div><div class="b num">${a.usd ? k$(a.usd).replace("+", "") : (a.x != null ? nf(a.x, 2) : "")}</div><div class="c">${a.note ? "⚠ " + esc(a.note) : esc(a.ty)}</div><div class="d">${a.sev >= 2 ? tag("önemli", "short") : ""}</div></div>`).join("") || `<div class="empty">Henüz uyarı yok</div>`;
  $("#whRkTs").textContent = hm(W.gen);
  $("#whCoins").innerHTML = (W.coins || []).map(c => `<div class="row glass"><div class="a">${esc(c.s)} ${tag(nf(c.rk, 0))}${c.wb ? tag(c.wb + " balina alış", "long") : ""}${c.wsl ? tag(c.wsl + " balina satış", "short") : ""}</div><div class="b num ${cls(c.d15)}">${k$(c.d15)}</div><div class="c">15 dk CVD · dengesizlik ${c.imb == null ? "—" : nf(c.imb * 100, 0) + "%"} · defter ${c.obi == null ? "—" : nf(c.obi * 100, 0) + "%"} · derinlik ±1% ${k$(c.dep).replace("+", "")} · spread ${c.sp ?? "—"} bp${c.oi != null ? " · OI 1sa " + pct(c.oi, 1) : ""}${c.fr != null ? " · funding " + nf(c.fr, 3) + "%" : ""}${c.vg != null ? " · hacim " + nf(c.vg, 1) + "x" : ""}</div><div class="d num ${cls(c.ch)}">${pct(c.ch, 1)}</div></div>`).join("");
  $("#whReps").innerHTML = (W.reps || []).map(r => `<div class="card glass wh-rep"><div class="card-h">${esc(r.coin)} · ${fpx(r.px)} ${tag("risk: " + r.risk, r.risk === "Yüksek" ? "short" : (r.risk === "Düşük" ? "long" : ""))}</div>
    <div class="wh-grid"><span>Balina aktivitesi</span><b>${esc(r.bal)}</b><span>Alış baskısı</span><b>${esc(r.al)}</b><span>Satış baskısı</span><b>${esc(r.sat)}</b><span>CVD</span><b>${esc(r.cvd)}</b><span>Likidite</span><b>${esc(r.liq)}</b><span>Trend</span><b>${esc(r.tr)}</b></div>
    <div class="muted sm">Veri: RSI15 ${r.data.rsi15 ?? "—"} · ATR 1sa ${r.data.atr1h ?? "—"}% · ADX ${r.data.adx ?? "—"} · funding ${r.data.fr ?? "—"}% · OI 1sa ${r.data.oi1h ?? "—"}% · BTC ${esc(r.data.btc || "—")}</div>
    <div class="wh-ai"><b>Yorum (AI · kural tabanlı)</b><ul>${(r.sc || []).map(x => `<li>${esc(x)}</li>`).join("")}</ul><details><summary>Analiz gerekçesi</summary><ul>${(r.why || []).map(x => `<li>${esc(x)}</li>`).join("")}</ul></details></div></div>`).join("") || `<div class="empty">Analiz her dakika üretiliyor</div>`;
  const B = W.bt || {}, nmS = {whale_momentum: "Balina momentumu", cvd_divergence: "CVD uyumsuzluğu", volume_breakout: "Hacim kırılımı", liquidity_sweep: "Likidite süpürme", oi_momentum: "OI momentumu"};
  $("#whBtTs").textContent = B.per ? `${B.syms} vadeli · ${B.per.start.slice(5, 10)} → ${B.per.end.slice(5, 10)} · 1 sa` : "";
  $("#whBt").innerHTML = (B.s || []).map(x => `<div class="row glass"><div class="a">${esc(nmS[x.k] || x.k)} ${tag(x.p ? "GEÇTİ → kağıt" : "geçmedi → gölge", x.p ? "long" : "short")}</div><div class="b num ${cls(x.oos?.mean)}">${x.oos?.mean == null ? "—" : pct(x.oos.mean, 2)}</div><div class="c">örneklem dışı ${x.oos?.n ?? 0} işlem · kazanma ${x.oos?.win ?? "—"}% · PF ${x.oos?.pf ?? "—"} | eğitim ${x.is?.mean == null ? "—" : pct(x.is.mean, 2)} (${x.is?.n ?? 0})</div><div class="d num muted">işlem başı net</div></div>`).join("")
    + `<div class="row glass"><div class="a">Emir defteri dengesizliği ${tag("yalnız ileri test", "")}</div><div class="b num muted">—</div><div class="c">OKX geçmiş emir defteri vermiyor; canlı gölge sinyal olarak ölçülüyor</div><div class="d"></div></div>`
    + `<p class="hint">Maliyet dahil (komisyon %0,05 + kayma %0,03 + gecikme %0,02 + yarım spread, her yön) + funding. Sinyal mum kapanışında, giriş sonraki mumun açılışında (geleceğe bakma yok). Geçiş şartı: ${esc(B.gate || "")}.</p>`;
  const SH = W.shadow || {}, nm2 = {...nmS, order_flow_imbalance: "Emir defteri dengesizliği"};
  const shRows = Object.entries(SH).map(([k, v]) => { const h = v.h4 || v.h1 || v["h0.25"]; const lbl = v.h4 ? "4 sa" : (v.h1 ? "1 sa" : "15 dk"); return `<div class="row glass"><div class="a">${esc(nm2[k] || k)} ${tag(v.mode === "paper" ? "kağıt" : "gölge")}</div><div class="b num ${cls(h?.mean_net_pct)}">${h ? pct(h.mean_net_pct, 2) : "—"}</div><div class="c">${v.n} sinyal · ${h ? lbl + " sonra, " + h.n + " ölçüm, kazanma " + h.win_pct + "%" : "sonuç bekleniyor"}</div><div class="d"></div></div>`; }).join("");
  $("#whSh").innerHTML = shRows + (W.sigs || []).map(x => `<div class="row glass"><div class="a">${esc(x.s)} ${tag(x.side, x.side)} <small>${hm(x.t)}</small></div><div class="b num muted">${esc(x.m)}</div><div class="c">${esc(nm2[x.st] || x.st)}</div><div class="d"></div></div>`).join("") || `<div class="empty">Henüz sinyal yok</div>`;
  $("#whTr").innerHTML = (P.pos || []).map(p => `<div class="row glass"><div class="a">${esc(p.s)} ${tag(p.side, p.side)}${tag(p.lev + "x")}</div><div class="b num">${fpx(p.l)}</div><div class="c">${esc(p.st)} · giriş ${fpx(p.e)} · $${nf(p.n, 0)}</div><div class="d"></div></div>`).join("")
    + (P.trades || []).map(t => `<div class="row glass"><div class="a">${esc(t.s)} ${tag(t.ev === "entry" ? "giriş" : "çıkış")} <small>${hm(t.t)}</small></div><div class="b num ${cls(t.pnl)}">${t.pnl == null ? "" : sgnUsd(t.pnl)}</div><div class="c">${esc(t.st)}${t.why ? " · " + esc(t.why) : ""}</div><div class="d"></div></div>`).join("") || `<div class="empty">Kağıt işlem yok (geçen strateji yok)</div>`;
}
/* ---------- nav ---------- */
function go(tab) {
  if (![...document.querySelectorAll(".tab")].some(s => s.dataset.tab === tab)) tab = "ozet";
  document.querySelectorAll(".tab").forEach(s => s.classList.toggle("on", s.dataset.tab === tab));
  const btns = [...document.querySelectorAll(".nav button")]; btns.forEach(b => b.classList.toggle("on", b.dataset.go === tab));
  placeInd();
  history.replaceState(null, "", "#" + tab); window.scrollTo({top: 0, behavior: "smooth"});
  if (D) requestAnimationFrame(() => { drawCurve(); drawStrip(); watch().forEach(drawSpark); });
}
function placeInd() { const b = document.querySelector(".nav button.on"), ind = $("#navInd"); if (!b) return; ind.style.width = b.offsetWidth + "px"; ind.style.transform = `translateX(${b.offsetLeft - 6}px)`; }
window.addEventListener("resize", placeInd); document.fonts?.ready.then(placeInd);
$("#nav").addEventListener("click", e => { const b = e.target.closest("button"); b && go(b.dataset.go); });
window.addEventListener("hashchange", () => go(location.hash.slice(1)));
$("#liveBtn").onclick = () => go("ekip");

function seedOkx() { const s = D?.okx; if (!s?.t) return; for (const [b, x] of Object.entries(s.px || {})) if (!okx[b] || (okx[b].src === "masa" && okx[b].t < s.t)) okx[b] = {px: x[0], ch: x[1], vol: x[2] || 0, t: s.t, src: "masa"}; }
function renderSection(name, fn) {
  const sections = {renderMeme:["masa","akis"],renderSpot:["spot"],renderLab:["deney"],renderWhale:["balina"]};
  const required = {renderMeme:"meme",renderSpot:"spot",renderLab:"lab",renderWhale:"whale"};
  let failed = false;
  try {
    const key = required[name];
    if (key && (!D[key] || D[key].error || typeof D[key] !== "object")) throw Error("Masa verisi bulunamadı");
    fn(); delete renderErrors[name];
  } catch (e) { failed = true; renderErrors[name] = "Bu bölümün verisi eksik veya geçersiz"; console.error(name, e); }
  for (const tab of sections[name] || []) {
    const section = document.querySelector('[data-tab="'+tab+'"]');
    if (!section) continue;
    section.classList.toggle("section-unavailable", failed);
    let placeholder = section.querySelector(".section-placeholder");
    if (!placeholder) { placeholder = document.createElement("div"); placeholder.className = "section-placeholder empty"; section.prepend(placeholder); }
    placeholder.textContent = "Bu masanın verisi son kayıtta eksik veya geçersiz. Önceki değerler gösterilmiyor. Sonraki güncellemede yeniden denenecek.";
  }
}
function renderAll() { for (const fn of [seedOkx,renderMeme,renderSpot,renderLab,renderWhale,renderTeam,renderRadar,renderTickers]) renderSection(fn.name,fn); renderSection("overview",()=>window.MasaTerminal?.render(D)); enhanceCards(); tickStatus(); }
function enhanceCards() {
  document.querySelectorAll("[data-pos],[data-trade],[data-radar],[data-okx],[data-spot]").forEach(el => { el.tabIndex = 0; el.setAttribute("role", "button"); });
}
document.addEventListener("keydown", e => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-pos],[data-trade],[data-radar],[data-okx],[data-spot]")) { e.preventDefault(); e.target.click(); }
  if (e.key === "Tab" && sheet.kind) {
    const focusable = [...$("#sheet").querySelectorAll('button,a[href]')], first = focusable[0], last = focusable[focusable.length-1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});
$("#refreshBtn").onclick = () => loadData();
setInterval(() => {
  if (!D) return;
  renderSection("positions", updatePositionsLive);
  renderSection("radar-live", updateRadarLive);
  watch().forEach(updTicker);
  const dexFresh = Core.isFresh(dexOk, now(), 60);
  $("#posLive").classList.toggle("off", !dexFresh); $("#radarLive").classList.toggle("off", !dexFresh);
  $("#posLive").textContent = dexFresh ? "DexScreener · güncel" : "DexScreener · güncel değil";
  $("#radarLive").textContent = $("#posLive").textContent;
  $("#okxBadge").classList.toggle('off', !Core.isFresh(okxOk, now(), 60));
  $("#okxBadge").textContent = Core.isFresh(okxOk, now(), 60) ? 'OKX · güncel' : 'OKX · güncel değil';
}, 5e3);

/* ---------- boot ---------- */
go((location.hash || "#ozet").slice(1).replace(/[^a-z]/g, "") || "masa");
loadData(); setInterval(loadData, DATA_POLL);
setInterval(tickStatus, 1e3);
setInterval(pollDex, DEX_POLL);
setInterval(() => { if (D) renderSection("renderTeam", renderTeam); }, 30e3);
okxWS(); setTimeout(okxREST, 4e3); pollSparks(); setInterval(pollSparks, SPARK_POLL);
renderTickers();
document.addEventListener("visibilitychange", () => { if (!document.hidden) { loadData(); pollDex(); } });
})();

