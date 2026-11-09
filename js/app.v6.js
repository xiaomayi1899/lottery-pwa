/* app.v6.js — 彩票预测助手 页面逻辑（纯数字彩五版：双色球/大乐透/快乐8/福彩3D/排列五）
   推荐：近 50 期走势形态系统（engine.v6.js）；数据：官方接口/静态数据/快照三层降级 */
(() => {
  "use strict";

  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const Engine = window.Engine;
  const GAMES = Engine.GAMES;
  const KEYS = ["ssq", "dlt", "kl8", "fc3d", "p5"];

  /* ============ 数据层 ============ */
  const LS_KEY = "lph_data_v2";
  const SNAP = window.__SNAPSHOT__ || { builtAt: "", ssq: [], dlt: [], kl8: [], fc3d: [], p5: [] };
  window.DATA = { ssq: [], dlt: [], kl8: [], fc3d: [], p5: [] };

  const store = {};
  const state = {};
  for (const k of KEYS) {
    store[k] = { list: [], ts: 0, src: "" };
    state[k] = { result: null, running: false, metric: "freq", open: new Set(), rendered: false };
  }

  function loadLocal() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch (e) {}
    for (const g of KEYS) {
      const snap = Array.isArray(SNAP[g]) ? SNAP[g] : [];
      const s = saved && saved[g];
      if (s && Array.isArray(s.list) && s.list.length >= snap.length && s.list.length > 0) {
        store[g] = { list: s.list, ts: s.ts || 0, src: "缓存" };
      } else if (snap.length) {
        store[g] = { list: snap.slice(), ts: SNAP.builtAt ? (Date.parse(SNAP.builtAt) || 0) : 0, src: "快照" };
      } else {
        store[g] = { list: [], ts: 0, src: "" };
      }
      window.DATA[g] = store[g].list;
    }
  }

  function persist() {
    try {
      const o = { builtAt: SNAP.builtAt || "" };
      for (const g of KEYS) o[g] = { list: store[g].list, ts: store[g].ts };
      localStorage.setItem(LS_KEY, JSON.stringify(o));
    } catch (e) {}
  }

  function setNet(cls, label) {
    const dot = $("#netdot"), lab = $("#netlabel");
    if (dot) dot.className = "netdot" + (cls ? " " + cls : "");
    if (lab) lab.textContent = label;
  }

  async function fetchJSON(url, timeout) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout || 30000);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error("HTTP " + r.status + ((j && j.error) ? " · " + j.error : ""));
      return j;
    } finally {
      clearTimeout(t);
    }
  }

  async function fetchNorm(u) {
    const j = await fetchJSON(u, 30000);
    if (j && Array.isArray(j.list) && j.list.length) return j.list;
    throw new Error((j && j.error) || "数据格式异常");
  }

  async function fetchDltLive() {
    const out = [], seen = new Set();
    for (let page = 1; page <= 10; page++) {
      const j = await fetchJSON("https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry?gameNo=85&provinceId=0&pageSize=100&isVerify=1&pageNo=" + page, 15000);
      const lst = (j.value && j.value.list) || [];
      for (const it of lst) {
        const code = String(it.lotteryDrawNum || "").trim();
        const nums = String(it.lotteryDrawResult || "").split(/\s+/).map(Number).filter((x) => x > 0);
        if (!code || seen.has(code) || nums.length !== 7) continue;
        seen.add(code);
        out.push({ issue: code, date: String(it.lotteryDrawTime || "").slice(0, 10),
          nums: nums.slice(0, 5).sort((a, b) => a - b).concat(nums.slice(5).sort((a, b) => a - b)) });
      }
      if (lst.length < 100) break;
    }
    if (!out.length) throw new Error("体彩接口无数据");
    out.sort((a, b) => a.issue.localeCompare(b.issue));
    return out.slice(-1000);
  }

  async function fetchP5Live() {
    const out = [];
    const j = await fetchJSON("https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry?gameNo=34&provinceId=0&pageSize=100&isVerify=1&pageNo=1", 15000);
    const lst = (j.value && j.value.list) || [];
    for (const it of lst) {
      const code = String(it.lotteryDrawNum || "").trim();
      const nums = String(it.lotteryDrawResult || "").split(/\s+/).map(Number).filter((x) => x >= 0);
      if (!code || nums.length !== 5) continue;
      out.push({ issue: code, date: String(it.lotteryDrawTime || "").slice(0, 10), nums: nums });
    }
    if (!out.length) throw new Error("接口无排列五数据");
    out.sort((a, b) => a.issue.localeCompare(b.issue));
    return out.slice(-1000);
  }

  const SOURCES = {
    ssq: [() => fetchNorm("/api/ssq?n=1000"), () => fetchNorm("./data/ssq.json")],
    dlt: [fetchDltLive, () => fetchNorm("/api/dlt?n=1000"), () => fetchNorm("./data/dlt.json")],
    kl8: [() => fetchNorm("/api/kl8?n=1000"), () => fetchNorm("./data/kl8.json")],
    fc3d: [() => fetchNorm("/api/fc3d?n=1000"), () => fetchNorm("./data/fc3d.json")],
    p5: [fetchP5Live, () => fetchNorm("/api/p5?n=1000"), () => fetchNorm("./data/p5.json")],
  };

  async function refreshGame(g, silent) {
    let list = null;
    for (const src of SOURCES[g]) {
      try { const got = await src(); if (got && got.length) { list = got; break; } }
      catch (e) { /* 试下一个来源 */ }
    }
    if (!list) {
      if (store[g].list.length) setNet("ok", "官方接口未响应 · 使用本地数据");
      else setNet("err", GAMES[g].name + " 数据源暂不可用");
      if (!silent) toast(GAMES[g].name + "更新失败：所有数据来源均不可达");
      return false;
    }
    const cur = store[g].list;
    const lastOld = cur.length ? String(cur[cur.length - 1].issue) : "";
    const lastNew = String(list[list.length - 1].issue);
    store[g] = { list, ts: Date.now(), src: "已更新" };
    window.DATA[g] = list;
    persist();
    setNet("ok", "官方数据已连接");
    if (state[g].rendered) {
      if (lastNew !== lastOld) renderGame(g);
      else updateFreshBadge(g);
    }
    if (!silent) toast(GAMES[g].name + "已更新至第 " + lastNew + " 期");
    return true;
  }

  /* ============ 通用渲染 ============ */
  function gameBalls(g, nums, size) {
    const cfg = GAMES[g];
    const auto = cfg.fk >= 8 ? "sm" : "";
    const cls = size || auto;
    let h = "";
    (nums || []).forEach((n) => {
      h += '<span class="ball r' + (cls ? " " + cls : "") + '">' + Engine.pad2(n) + "</span>";
    });
    return h;
  }

  function freshHTML(g) {
    const s = store[g];
    if (!s.list.length) return "";
    const last = s.list[s.list.length - 1];
    const stale = s.src === "缓存" && Date.now() - s.ts > 36 * 3600e3;
    const cls = s.src === "已更新" ? "live" : stale ? "stale" : "";
    return '<span class="fresh ' + cls + '" id="' + g + '-fresh"><span class="dot"></span>' +
      esc(s.src) + " · 第" + esc(last.issue) + "期 · " + esc(String(last.date).slice(0, 10)) + "</span>";
  }

  function updateFreshBadge(g) {
    const old = $("#" + g + "-fresh");
    const next = freshHTML(g);
    if (old && next) {
      const tpl = document.createElement("div");
      tpl.innerHTML = next;
      old.replaceWith(tpl.firstElementChild);
    }
  }

  function statsFor(g) {
    const cfg = GAMES[g];
    const draws = store[g].list.slice(-50);
    const D = draws.length;
    if (cfg.type === "digits") {
      const freq = [], fom = [];
      for (let p = 0; p < cfg.pos; p++) {
        const f = new Array(10).fill(0), m = new Array(10).fill(D);
        for (let t = D - 1; t >= 0; t--) { const d2 = draws[t].nums[p]; f[d2]++; if (m[d2] === D) m[d2] = D - 1 - t; }
        freq.push(f); fom.push(m);
      }
      return { type: "digits", freq, fom, D };
    }
    const fc = new Array(cfg.fn + 1).fill(0);
    const fom = new Array(cfg.fn + 1).fill(D);
    for (let t = D - 1; t >= 0; t--) {
      for (let i = 0; i < cfg.fk && i < draws[t].nums.length; i++) {
        const n = draws[t].nums[i];
        if (n >= 1 && n <= cfg.fn) { fc[n]++; if (fom[n] === D) fom[n] = D - 1 - t; }
      }
    }
    return { type: "pick", fc, fom, D };
  }

  function numgridHTML(g, freq, fom, D, maxN, rgb, startAt) {
    const metric = state[g].metric;
    const start = startAt || 1;
    const max = Math.max.apply(null, freq.slice(start).concat([1]));
    let h = '<div class="numgrid">';
    for (let i = start; i <= maxN; i++) {
      const f = freq[i], m = fom[i];
      const a = 0.10 + 0.32 * (f / max);
      const border = f === max ? "1px solid rgba(" + rgb + ",.6)" : "1px solid transparent";
      h += '<div class="nchip" style="background:rgba(' + rgb + "," + a.toFixed(2) + ');border:' + border + '">' +
        Engine.pad2(i) + "<small>" + (metric === "freq" ? f + "次" : "遗漏" + m) + "</small></div>";
    }
    return h + "</div>";
  }

  function statsCardHTML(g) {
    const cfg = GAMES[g];
    const st = statsFor(g);
    const m = state[g].metric;
    let body = "";
    if (st.type === "digits") {
      for (let p = 0; p < cfg.pos; p++) {
        const freq = [0].concat(st.freq[p]);
        const fom = [0].concat(st.fom[p]);
        body += '<div class="hint" style="margin-bottom:6px">' + esc(cfg.posNames[p]) + "（0–9）</div>" +
          numgridHTML(g, freq, fom, st.D, 9, "228,87,74", 0);
      }
    } else {
      body += '<div class="hint" style="margin-bottom:6px">号码（1–' + cfg.fn + "）</div>" +
        numgridHTML(g, st.fc, st.fom, st.D, cfg.fn, "228,87,74", 1);
    }
    return '<div class="card">' +
      '<div class="eyebrow">近 50 期统计 · ' + (m === "freq" ? "按出现次数着色" : "按当前遗漏着色") + "</div>" +
      '<div class="seg"><button class="' + (m === "freq" ? "on" : "") + '" data-act="metric" data-m="freq">出现次数</button>' +
      '<button class="' + (m === "miss" ? "on" : "") + '" data-act="metric" data-m="miss">遗漏期数</button></div>' +
      body +
      '<div class="hint" style="margin-top:10px">统计只描述历史；冷热与遗漏对下期开奖没有预测力。</div>' +
      "</div>";
  }

  function bannerHTML(g) {
    const r = state[g].result;
    const cfg = GAMES[g];
    let formLine;
    if (cfg.type === "digits") {
      formLine = "预测形态：和值 " + r.form.sum[0] + "–" + r.form.sum[1] + " · " + r.form.odd + " 奇" + (cfg.pos - r.form.odd) + "偶 · " +
        r.form.big + " 大" + (cfg.pos - r.form.big) + "小 · 跨度 " + r.form.span;
    } else {
      formLine = "预测形态：奇偶 " + r.form.odd + " · 质合 " + r.form.prime + " · 大小 " + r.form.low +
        " · 区间 " + r.form.zone + " · 和值 " + r.form.sum[0] + "–" + r.form.sum[1] +
        (cfg.fk <= 6 ? " · 含重号 " + r.form.repeat + " / 邻号 " + r.form.neighbor : "");
    }
    return '<div class="banner">' +
      '<div class="tag">形态合成推荐 · ' + esc(r.name) + "</div>" +
      '<div class="pick">' + gameBalls(g, r.final.f) + "</div>" +
      '<div class="votes num">' + esc(formLine) + "</div>" +
      '<div class="upto">截至第 ' + esc(r.upto.issue) + " 期（" + esc(r.upto.date) + " 开奖）· 分析最近 " + r.upto.count +
      " 期走势 · 计算 " + r.ms + "ms<br>" +
      "再次强调：推荐是统计整理输出，与随机对照的中奖概率完全相同。</div></div>";
  }

  function setsCardHTML(g) {
    const st = state[g];
    if (!st.result || !st.result.sets) return "";
    let h = '<div class="card"><div class="eyebrow">策略五注 · 同一预测形态的不同评分视角</div>';
    st.result.sets.forEach((s, i) => {
      h += '<div class="pr-row"><div class="pr-l"><span>' + (i + 1) + ". " + esc(s.tag) + "</span></div>" +
        '<div class="balls" style="margin:4px 0 2px">' + gameBalls(g, s.f, "xs") + "</div></div>";
    });
    h += '<div class="hint" style="margin-top:8px">五注都满足同一预测形态，只是选号评分视角不同；随机对照与其他四注的中奖概率完全相同。</div></div>';
    return h;
  }

  function stepsHTML(g) {
    const r = state[g].result;
    let h = '<div style="margin-top:14px"><div class="eyebrow">走势明细（点开查看）</div></div>';
    r.sections.forEach((sec, i) => {
      const open = state[g].open.has(i) ? " open" : "";
      let body = "";
      for (const l of sec.lines) {
        const e2 = esc(l);
        if (/^(近 |预测|质数口径|三区|热号|冷号|超期|上期开|重号|邻号|⚠|合成方法|走势结构|所有推荐|0路|奇数|大数|跨度|组选|各位)/.test(l)) body += '<div class="mono">' + e2 + "</div>";
        else body += "<div>" + e2 + "</div>";
      }
      body += sec.cand ? ('<div class="cand">[形态合成推荐] ' + esc(Engine.fmtS(sec.cand.f)) + "</div>") : "";
      body += '<div class="why">(' + esc(sec.why) + ")</div>";
      h += '<details class="step"' + open + '><summary>' + esc(sec.title) + '<span class="arrow">›</span></summary><div class="body">' + body + "</div></details>";
    });
    return h;
  }

  function histHTML(g) {
    const list = store[g].list.slice(-10).reverse();
    let h = '<div class="card"><div class="eyebrow">最近 10 期开奖</div>';
    for (const d of list) {
      h += '<div class="hist-row"><span class="hissue num">第' + esc(d.issue) + "期</span>" +
        '<span class="hdate">' + esc(String(d.date).slice(0, 10)) + "</span>" +
        '<span class="balls">' + gameBalls(g, d.nums, "xs") + "</span></div>";
    }
    return h + "</div>";
  }

  function renderGame(g) {
    const cfg = GAMES[g];
    const st = state[g];
    const s = store[g];
    const el = $("#page-" + g);
    let h = "";
    if (!s.list.length) {
      h += '<div class="state-box"><strong>' + esc(cfg.name) + ' 数据未就绪</strong>从官方接口获取历史开奖后即可开始分析' +
        '<div><button class="btn primary" data-act="refresh">获取数据</button></div></div>';
      el.innerHTML = h;
      st.rendered = true;
      return;
    }
    const last = s.list[s.list.length - 1];
    h += '<div class="card"><div class="draw-hero"><div>' +
      '<div class="eyebrow">' + esc(cfg.full) + " · 最新开奖</div>" +
      '<div class="issue num">第 ' + esc(last.issue) + " 期</div>" +
      '<div class="meta">' + esc(String(last.date).slice(0, 10)) + " 开奖</div></div>" +
      freshHTML(g) + "</div>" +
      '<div class="balls" style="margin-top:12px">' + gameBalls(g, last.nums) + "</div></div>";
    h += '<div class="card"><div class="eyebrow">近 50 期走势形态 · 推荐合成</div>' +
      '<div class="hint">' + (cfg.type === "digits"
        ? "只用最近 50 期：各位走势 / 和值 / 奇偶大小 / 012路 / 跨度" + (g === "fc3d" ? " / 组选形态" : "") + " → 预测下期形态 → 形态约束下按四种评分视角合成直选，另附纯随机对照。"
        : "只用最近 50 期：和值 / 奇偶 / 质合 / 大小 / 区间 / 012路 / 走势图模式（重号·邻号·斜跳）/ 冷热遗漏 → 预测下期形态 → 形态约束下按四种评分视角合成，另附纯随机对照。") + "</div>" +
      '<div class="btn-row"><button class="btn ghost" data-act="refresh">更新数据</button>' +
      '<button class="btn primary" data-act="go" id="' + g + '-go">' + (st.result ? "重新分析" : "开始分析") + "</button></div>" +
      '<div class="hint" id="' + g + '-prog" style="margin-top:8px;min-height:16px">' + (st.running ? "近 50 期走势形态分析中…" : "") + "</div></div>";
    if (st.result) {
      h += bannerHTML(g);
      h += setsCardHTML(g);
    }
    h += statsCardHTML(g);
    if (st.result) h += stepsHTML(g);
    h += histHTML(g);
    el.innerHTML = h;
    st.rendered = true;
  }

  async function runAnalysis(g) {
    const st = state[g];
    if (st.running) return;
    if (store[g].list.length < 50) { toast(GAMES[g].name + " 历史数据不足 50 期，请先更新数据"); return; }
    st.running = true;
    const btn = $("#" + g + "-go"), prog = $("#" + g + "-prog");
    if (btn) btn.disabled = true;
    if (prog) prog.textContent = "近 50 期走势形态分析中，请稍候…";
    await new Promise((r) => setTimeout(r, 50));
    try {
      const t0 = performance.now();
      const res = Engine.analyzeGame(g);
      res.ms = Math.round(performance.now() - t0);
      st.result = res;
      st.running = false;
      renderGame(g);
      toast(GAMES[g].name + "走势分析完成，用时 " + res.ms + "ms");
    } catch (e) {
      toast("分析出错：" + e.message);
      if (prog) prog.textContent = "";
    } finally {
      st.running = false;
    }
  }

  function bindGamePage(g) {
    const el = $("#page-" + g);
    el.addEventListener("click", (ev) => {
      const t = ev.target.closest("[data-act]");
      if (t) {
        const act = t.dataset.act;
        if (act === "refresh") refreshGame(g, false);
        else if (act === "go") runAnalysis(g);
        else if (act === "metric") { state[g].metric = t.dataset.m; renderGame(g); }
        return;
      }
      if (ev.target.closest("summary")) {
        setTimeout(() => {
          const opens = new Set();
          $$("#page-" + g + " details.step").forEach((d, i) => { if (d.open) opens.add(i); });
          state[g].open = opens;
        }, 0);
      }
    });
  }

  /* ============ 全局 ============ */
  let toastTimer = null;
  function toast(msg) {
    const t = $("#toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("on"), 2800);
  }

  function switchPage(id) {
    $$(".page").forEach((p) => p.classList.toggle("on", p.id === id));
    $$(".tab-btn").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.page === id)));
    window.scrollTo(0, 0);
  }

  function boot() {
    loadLocal();
    for (const g of KEYS) bindGamePage(g);
    for (const g of KEYS) renderGame(g);
    $$(".tab-btn").forEach((b) => b.addEventListener("click", () => switchPage(b.dataset.page)));
    if (SNAP.builtAt) { const el2 = $("#snap-built"); if (el2) el2.textContent = String(SNAP.builtAt).slice(0, 10); }
    switchPage("page-ssq");
    const ready = KEYS.filter((g) => store[g].list.length).length;
    if (ready === KEYS.length) setNet("ok", "本地数据就绪 · 正在核对官方");
    else setNet("", "正在获取数据…");
    const AUTO_AGE = 6 * 3600e3;
    KEYS.forEach((g, i) => {
      if (!store[g].ts || Date.now() - store[g].ts >= AUTO_AGE) {
        setTimeout(() => refreshGame(g, true), 600 + i * 1200);
      }
    });
    if ("serviceWorker" in navigator &&
        (location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  boot();
})();
