/* app.js — 彩票预测助手 页面逻辑
   数据层：官方接口（本机服务代理）→ localStorage 缓存 → 内置快照兜底
   页面：双色球 / 大乐透（12 步模型） + 竞彩足球（赔率互证） + 说明 */
(() => {
  "use strict";

  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const Engine = window.Engine;
  const JC = window.JC;
  const GAMES = { ssq: "双色球", dlt: "大乐透" };
  const WD = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const pctf = (x, d) => (x == null || !isFinite(x) ? "—" : (x * 100).toFixed(d == null ? 1 : d) + "%");

  /* ============ 数据层 ============ */
  const LS_KEY = "lph_data_v1";
  const SNAP = window.__SNAPSHOT__ || { builtAt: "", ssq: [], dlt: [] };
  window.DATA = { ssq: [], dlt: [] }; // 12 步引擎读取的全局数据

  const store = {
    ssq: { list: [], ts: 0, src: "" },
    dlt: { list: [], ts: 0, src: "" },
  };
  const state = {
    ssq: { result: null, running: false, metric: "freq", open: new Set(), rendered: false },
    dlt: { result: null, running: false, metric: "freq", open: new Set(), rendered: false },
    jc: { list: [], ts: 0, loading: false, loaded: false, error: "" },
  };

  function loadLocal() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch (e) {}
    for (const g of ["ssq", "dlt"]) {
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
    if (saved && saved.jc && Array.isArray(saved.jc.list)) {
      state.jc.list = saved.jc.list;
      state.jc.ts = saved.jc.ts || 0;
    }
  }

  function persist() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        ssq: { list: store.ssq.list, ts: store.ssq.ts },
        dlt: { list: store.dlt.list, ts: store.dlt.ts },
        jc: { list: state.jc.list.slice(0, 80), ts: state.jc.ts },
      }));
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

  /* 大乐透：体彩官方接口开放跨域，手机可浏览器直连（10 页×100 期） */
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

  /* 数据来源链：本机服务 → GitHub Pages 静态数据；大乐透优先浏览器直连官方 */
  const SOURCES = {
    ssq: [() => fetchNorm("/api/ssq?n=1000"), () => fetchNorm("./data/ssq.json")],
    dlt: [fetchDltLive, () => fetchNorm("/api/dlt?n=1000"), () => fetchNorm("./data/dlt.json")],
  };

  async function refreshGame(g, silent) {
    let list = null;
    for (const src of SOURCES[g]) {
      try { const got = await src(); if (got && got.length) { list = got; break; } }
      catch (e) { /* 试下一个来源 */ }
    }
    if (!list) {
      if (store[g].list.length) setNet("ok", "官方接口未响应 · 使用本地数据");
      else setNet("err", "数据不可用 · 请检查网络");
      if (!silent) toast(GAMES[g] + "更新失败：所有数据来源均不可达（继续使用本地数据）");
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
    if (!silent) toast(GAMES[g] + "已更新至第 " + lastNew + " 期");
    return true;
  }

  /* ============ 号码彩 UI ============ */
  function gameBalls(g, nums, size) {
    const cfg = Engine.GAMES[g];
    const fk = cfg.fk;
    let h = "";
    (nums || []).forEach((n, i) => {
      const zone = i < fk ? "r" : "b";
      h += '<span class="ball ' + zone + (size ? " " + size : "") + '">' + Engine.pad2(n) + "</span>";
      if (i === fk - 1 && nums.length > fk) h += '<span class="vs">+</span>';
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
    const cfg = Engine.GAMES[g];
    const draws = store[g].list.slice(-100);
    const D = draws.length;
    const fc = new Array(cfg.fn + 1).fill(0), bc = new Array(cfg.bn + 1).fill(0);
    const fom = new Array(cfg.fn + 1).fill(D), bom = new Array(cfg.bn + 1).fill(D);
    for (let t = D - 1; t >= 0; t--) {
      const nums = draws[t].nums;
      for (let i = 0; i < cfg.fk && i < nums.length; i++) { const n = nums[i]; if (n >= 1 && n <= cfg.fn) { fc[n]++; if (fom[n] === D) fom[n] = D - 1 - t; } }
      for (let i = cfg.fk; i < nums.length; i++) { const n = nums[i]; if (n >= 1 && n <= cfg.bn) { bc[n]++; if (bom[n] === D) bom[n] = D - 1 - t; } }
    }
    return { fc, bc, fom, bom, D };
  }

  function numgridHTML(g, zone) {
    const cfg = Engine.GAMES[g];
    const st = statsFor(g);
    const N = zone === "f" ? cfg.fn : cfg.bn;
    const freq = zone === "f" ? st.fc : st.bc;
    const miss = zone === "f" ? st.fom : st.bom;
    const max = Math.max.apply(null, freq.slice(1).concat([1]));
    const metric = state[g].metric;
    const rgb = zone === "f" ? "228,87,74" : "88,131,255";
    let h = '<div class="numgrid">';
    for (let i = 1; i <= N; i++) {
      const f = freq[i], m = miss[i];
      const a = 0.10 + 0.32 * (f / max);
      const border = f === max ? "1px solid rgba(" + rgb + ",.6)" : "1px solid transparent";
      h += '<div class="nchip" style="background:rgba(' + rgb + "," + a.toFixed(2) + ');border:' + border + '">' +
        Engine.pad2(i) + "<small>" + (metric === "freq" ? f + "次" : "遗漏" + m) + "</small></div>";
    }
    return h + "</div>";
  }

  function setsCardHTML(g) {
    const st = state[g];
    if (!st.result || !st.result.sets) return "";
    let h = '<div class="card"><div class="eyebrow">策略五注 · 同一批模型的不同合成视角</div>';
    st.result.sets.forEach((s, i) => {
      h += '<div class="pr-row"><div class="pr-l"><span>' + (i + 1) + ". " + esc(s.tag) + "</span></div>" +
        '<div class="balls" style="margin:4px 0 2px">' + gameBalls(g, s.f.concat(s.b), "xs") + "</div></div>";
    });
    h += '<div class="hint" style="margin-top:8px">五注只是同一信息的不同组合方式，不改变中奖概率；随机对照那注与其他四注的期望完全相同。</div></div>';
    return h;
  }

  function weightsCardHTML(g) {
    const st = state[g];
    const w = st.result && st.result.weights;
    if (!w || !w.rows) return "";
    const maxW = Math.max.apply(null, w.rows.map((r) => r.w));
    let h = '<div class="card"><div class="eyebrow">回测加权 · 近 ' + w.n + ' 期逐期走前回测</div>';
    h += '<div class="hint" style="margin-bottom:8px">基准 = 随机期望（前 ' + w.baseF.toFixed(2) + " 个 / 后 " + w.baseB.toFixed(2) + " 个）；命中高于基准的模型话语权更大。</div>";
    for (const r of w.rows) {
      const tag = r.avgF != null ? ' <span class="src-tag">均命中 ' + r.avgF.toFixed(2) + "</span>" : ' <span class="src-tag">中性权重</span>';
      h += '<div class="pr-row"><div class="pr-l"><span>' + esc(r.name) + tag + '</span><b class="num">' + (r.w * 100).toFixed(1) + "%</b></div>" +
        '<div class="bar"><i style="width:' + (r.w / maxW * 100).toFixed(0) + '%"></i></div></div>';
    }
    h += '<div class="hint" style="margin-top:8px">' + esc(w.note) + "。回测加权只是历史统计，不改变每期开奖的随机性。</div></div>";
    return h;
  }

  function statsCardHTML(g) {
    const cfg = Engine.GAMES[g];
    const m = state[g].metric;
    return '<div class="card">' +
      '<div class="eyebrow">近 100 期统计 · ' + (m === "freq" ? "按出现次数着色" : "按当前遗漏着色") + "</div>" +
      '<div class="seg"><button class="' + (m === "freq" ? "on" : "") + '" data-act="metric" data-m="freq">出现次数</button>' +
      '<button class="' + (m === "miss" ? "on" : "") + '" data-act="metric" data-m="miss">遗漏期数</button></div>' +
      '<div class="hint" style="margin-bottom:8px">前区（1–' + cfg.fn + "）</div>" + numgridHTML(g, "f") +
      '<div class="hint" style="margin:12px 0 8px">后区（1–' + cfg.bn + "）</div>" + numgridHTML(g, "b") +
      '<div class="hint" style="margin-top:10px">统计只描述历史；冷热与遗漏对下期开奖没有预测力。</div>' +
      "</div>";
  }

  function bannerHTML(g) {
    const r = state[g].result;
    return '<div class="banner">' +
      '<div class="tag">模型合成推荐 · ' + esc(r.name) + "</div>" +
      '<div class="pick">' + gameBalls(g, r.final.f.concat(r.final.b)) + "</div>" +
      '<div class="votes num">前区加权得票(×100) ' + esc(r.votes.f) + "<br>后区加权得票(×100) " + esc(r.votes.b) + "</div>" +
      (r.consensus ? '<div class="consensus">' + esc(r.consensus) + "</div>" : "") +
      '<div class="upto">截至第 ' + esc(r.upto.issue) + " 期（" + esc(r.upto.date) + " 开奖）· 分析最近 " + r.upto.count +
      " 期 · 库存 " + r.upto.stock.toLocaleString("en-US") + " 期 · 计算 " + r.ms + "ms<br>" +
      "再次强调：推荐是统计输出的练习结果，不能提高中奖概率。</div></div>";
  }

  function stepsHTML(g) {
    const r = state[g].result;
    let h = '<div style="margin-top:14px"><div class="eyebrow">12 步明细（点开查看）</div></div>';
    r.sections.forEach((sec, i) => {
      const open = state[g].open.has(i) ? " open" : "";
      let body = "";
      for (const l of sec.lines) {
        const e2 = esc(l);
        if (/^(奖级|前区|后区|一等奖|二等奖|三等奖|四等奖|五等奖|六等奖|七等奖|八等奖|九等奖|不中奖|n=|模型|数据:)/.test(l)) body += '<div class="mono">' + e2 + "</div>";
        else body += "<div>" + e2 + "</div>";
      }
      body += '<div class="cand">[该模型推荐组] ' + esc(Engine.fmtS(sec.cand.f)) + " + " + esc(Engine.fmtS(sec.cand.b)) + "</div>";
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
    const cfg = Engine.GAMES[g];
    const st = state[g];
    const s = store[g];
    const el = $("#page-" + g);
    let h = "";
    if (!s.list.length) {
      h += '<div class="state-box"><strong>还没有本地数据</strong>从官方接口获取历史开奖后即可开始分析' +
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
    h += '<div class="card"><div class="eyebrow">16 模型 · 回测加权投票</div>' +
      '<div class="hint">原 12 步模型 + 衰减热度 / 形态匹配 / 共现聚类 / 模拟退火；近 30 期逐期回测自动分配权重；只用最近 100 期窗口。</div>' +
      '<div class="btn-row"><button class="btn ghost" data-act="refresh">更新数据</button>' +
      '<button class="btn primary" data-act="go" id="' + g + '-go">' + (st.result ? "重新分析" : "开始分析") + "</button></div>" +
      '<div class="hint" id="' + g + '-prog" style="margin-top:8px;min-height:16px">' + (st.running ? "16 个模型 + 近 30 期回测计算中（约数秒）…" : "") + "</div></div>";
    if (st.result) {
      h += bannerHTML(g);
      h += setsCardHTML(g);
      h += weightsCardHTML(g);
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
    if (store[g].list.length < 100) { toast("历史数据不足 100 期，请先更新数据"); return; }
    st.running = true;
    const btn = $("#" + g + "-go"), prog = $("#" + g + "-prog");
    if (btn) btn.disabled = true;
    if (prog) prog.textContent = "16 个模型 + 近 30 期逐期回测计算中（约数秒），请稍候…";
    await new Promise((r) => setTimeout(r, 50));
    try {
      const t0 = performance.now();
      const res = Engine.analyzeGame(g);
      res.ms = Math.round(performance.now() - t0);
      st.result = res;
      st.running = false;
      renderGame(g);
      toast(GAMES[g] + "分析完成，用时 " + res.ms + "ms");
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

  /* ============ 竞彩足球 ============ */
  const JC_API = "https://webapi.sporttery.cn/gateway/jc/football/getMatchCalculatorV1.qry?poolCode=hhad,had,crs,ttg,hafu&channel=c";

  function wdLabel(dateStr) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || "");
    return m ? WD[new Date(+m[1], +m[2] - 1, +m[3]).getDay()] : "";
  }
  const fmtTime = (ts) => { const d = new Date(ts); const p = (x) => String(x).padStart(2, "0"); return p(d.getHours()) + ":" + p(d.getMinutes()); };

  function matchFromRaw(s) {
    return {
      id: String(s.matchId),
      num: s.matchNumStr || "",
      league: s.leagueAbbName || "",
      date: s.matchDate || "",
      time: (s.matchTime || "").slice(0, 5),
      home: s.homeTeamAbbName || "",
      away: s.awayTeamAbbName || "",
      homeRank: (s.homeRank || "").replace(/^\[|\]$/g, ""),
      awayRank: (s.awayRank || "").replace(/^\[|\]$/g, ""),
      single: s.bettingSingle === 1,
      pools: { had: s.had, hhad: s.hhad, crs: s.crs, ttg: s.ttg, hafu: s.hafu },
    };
  }

  function parseRawJC(j) {
    const mil = (j.value && j.value.matchInfoList) || [];
    const arr = [];
    for (const lg of mil) for (const s of lg.subMatchList || []) arr.push(matchFromRaw(s));
    return arr;
  }

  async function loadJC(manual) {
    if (state.jc.loading) return;
    state.jc.loading = true;
    state.jc.error = "";
    if (!state.jc.list.length) renderJC();
    try {
      let arr = [];
      const chain = [
      () => fetchJSON(JC_API, 20000).then(parseRawJC),
      () => fetchJSON("/api/jc", 20000).then(parseRawJC),
      () => fetchJSON("./data/jc.json", 20000).then((j) => {
        if (j && Array.isArray(j.list) && j.list.length) return j.list;
        throw new Error("静态赛程不可用");
      }),
    ];
    for (const src of chain) {
      try { const got = await src(); if (got && got.length) { arr = got; break; } }
      catch (e) { /* 试下一个来源 */ }
    }
    if (!arr.length) throw new Error("所有赛程来源均不可达（可能处于销售切换时段）");
    arr.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    state.jc.list = arr;
    state.jc.ts = Date.now();
    state.jc.loaded = true;
    setNet("ok", "官方数据已连接");
    persist();
    } catch (e) {
      state.jc.error = e.message || String(e);
      if (!state.jc.list.length) setNet("err", "竞彩接口不可用");
      if (manual) toast("赛程更新失败：" + state.jc.error);
    }
    state.jc.loading = false;
    renderJC();
  }

  function matchCardHTML(m) {
    const im = JC.hadFair(m.pools.had);
    const p = im ? im.probs : [null, null, null];
    const odds = m.pools.had ? [m.pools.had.h, m.pools.had.d, m.pools.had.a] : [null, null, null];
    let hot = -1, bv = -1;
    p.forEach((x, i) => { if (x != null && x > bv) { bv = x; hot = i; } });
    const line = m.pools.hhad && m.pools.hhad.goalLine != null && m.pools.hhad.goalLine !== "" ? "让球(" + esc(m.pools.hhad.goalLine) + ")" : "不让球";
    return '<div class="match-card" data-mid="' + esc(m.id) + '" role="button" tabindex="0">' +
      '<div class="l1"><span class="lg">' + (esc(m.league) || "—") + '</span><span class="num">' + esc(m.num) + "</span><span>" + esc(m.time) + "</span>" +
      (m.single ? "<span>单关</span>" : "") + "<span>" + line + "</span></div>" +
      '<div class="teams"><span class="team">' + esc(m.home) + (m.homeRank ? '<span class="rank">[' + esc(m.homeRank) + "]</span>" : "") + "</span>" +
      '<span class="score">VS</span><span class="team away">' + esc(m.away) + (m.awayRank ? '<span class="rank">[' + esc(m.awayRank) + "]</span>" : "") + "</span></div>" +
      '<div class="odds-row">' + ["胜", "平", "负"].map((lab, i) =>
        '<div class="o-cell' + (hot === i ? " hot" : "") + '"><div class="o-l">' + lab + " " + (p[i] != null ? (p[i] * 100).toFixed(0) + "%" : "") +
        '</div><div class="o-v num">' + (odds[i] != null ? Number(odds[i]).toFixed(2) : "—") + "</div></div>").join("") +
      "</div></div>";
  }

  function renderJC() {
    const el = $("#page-jc");
    const jst = state.jc;
    let h = '<div class="card"><div class="eyebrow">竞彩足球 · 官方在售场次</div>' +
      '<div class="hint">点任意场次查看：去水概率、跨玩法互证、Dixon-Coles 比分分布、赔率变动、基本面、价值与 Kelly。' +
      (jst.ts ? "赔率更新于 " + fmtTime(jst.ts) + "。" : "") + "</div>" +
      '<div class="btn-row"><button class="btn ghost" data-act="refresh">刷新赛程</button></div></div>';
    if (jst.list.length) {
      const pl = buildParlay();
      if (pl) h += parlayHTML(pl);
    }
    if (jst.loading && !jst.list.length) {
      h += '<div class="skel tall"></div><div class="skel tall"></div><div class="skel tall"></div>';
    } else if (!jst.list.length) {
      h += '<div class="state-box"><strong>暂时拿不到赛程</strong>' + esc(jst.error || "网络不可用或官方接口维护中，稍后重试") +
        '<div><button class="btn primary" data-act="refresh">重试</button></div></div>';
    } else {
      let day = "";
      for (const m of jst.list) {
        if (m.date !== day) { day = m.date; h += '<div class="day-h num">' + (wdLabel(m.date) ? wdLabel(m.date) + " " : "") + esc(day) + "</div>"; }
        h += matchCardHTML(m);
      }
      h += '<div class="hint" style="margin:12px 2px">在售列表不含已开赛场次；赔率变动历史与深度复盘请用电脑版「竞彩赔率分析」。</div>';
    }
    el.innerHTML = h;
  }

  const mvCache = new Map();

  async function loadMovement(m) {
    if (mvCache.has(m.id)) return mvCache.get(m.id);
    const u = "https://webapi.sporttery.cn/gateway/uniform/football/getFixedBonusV1.qry?clientCode=3001&matchId=" + m.id;
    try {
      const j = await fetchJSON(u, 15000);
      const v = (j && j.value) || {};
      const r = {
        had: JC.poolMovement(v.hadList, ["h", "d", "a"]),
        hhad: v.hhadList ? JC.poolMovement(v.hhadList, ["h", "d", "a"]) : null,
      };
      mvCache.set(m.id, r);
      return r;
    } catch (e) {
      mvCache.set(m.id, null);
      return null;
    }
  }

  function movementHTML(r) {
    if (!r || (!r.had && !r.hhad)) return '<div class="hint">官方暂无调赔记录或接口未响应（新开盘场次通常没有历史）。</div>';
    let h = "";
    const fmt = (mv, label) => {
      if (!mv) return;
      const arr = ["主胜", "平局", "客胜"];
      const parts = [];
      for (let i = 0; i < 3; i++) {
        if (mv.first[i] != null && mv.last[i] != null) {
          parts.push(arr[i] + " " + mv.first[i].toFixed(2) + "→" + mv.last[i].toFixed(2) +
            (mv.delta[i] ? (mv.delta[i] > 0 ? "（+" : "（") + mv.delta[i].toFixed(2) + "）" : ""));
        }
      }
      if (!parts.length) return;
      let flow = "市场态度平稳";
      if (mv.delta[0] != null && mv.delta[0] < -0.1) flow = "主胜赔率走低，资金偏主队";
      else if (mv.delta[2] != null && mv.delta[2] < -0.1) flow = "客胜赔率走低，资金偏客队";
      else if (mv.delta[0] != null && mv.delta[0] > 0.1) flow = "主胜赔率走高，资金偏客队";
      else if (mv.delta[2] != null && mv.delta[2] > 0.1) flow = "客胜赔率走高，资金偏主队";
      h += '<div class="pr-l" style="font-size:12px"><span>' + label + "（" + mv.n + " 次记录）</span></div>" +
        '<div class="hint num" style="margin:2px 0 6px">' + esc(parts.join(" · ")) + "</div>" +
        '<div class="hint">' + esc(flow) + (mv.lineChanged ? "；让球线发生过变化" : "") + "。调赔是庄家控风险的手段，不等于真实倾向。</div>";
    };
    fmt(r.had, "胜平负");
    fmt(r.hhad, "让球胜平负");
    return h || '<div class="hint">官方暂无调赔记录。</div>';
  }

  async function loadFund(m) {
    try {
      return await fetchJSON("/api/fund?date=" + encodeURIComponent(m.date) + "&num=" + encodeURIComponent(m.num), 25000);
    } catch (e) {
      return { found: false, error: e.message || String(e) };
    }
  }

  function fundHTML(r) {
    if (!r || r.found !== true) {
      if (r && r.error) return '<div class="hint">基本面服务不可用：' + esc(r.error) + "。静态 Pages 模式无此功能，电脑服务模式（启动服务.bat）下可用。</div>";
      return '<div class="hint">500 源暂未收录该场基本面（小联赛常见），本场以赔率口径为主。</div>';
    }
    const fh = JC.formSummary(r.home && r.home.matches);
    const fa = JC.formSummary(r.away && r.away.matches);
    let h = "";
    if (r.league) h += '<div class="hint">' + esc(r.league) + (r.home && r.home.rank != null ? " · 主队联赛第 " + r.home.rank + " 位" : "") + (r.away && r.away.rank != null ? " · 客队第 " + r.away.rank + " 位" : "") + "</div>";
    if (fh) h += '<div class="pr-l" style="font-size:12px"><span>主队近 ' + fh.n + " 场</span><b>" + fh.w + "胜" + fh.d + "平" + fh.l + "负 · 场均 " + fh.ppg + " 分</b></div>";
    if (fa) h += '<div class="pr-l" style="font-size:12px"><span>客队近 ' + fa.n + " 场</span><b>" + fa.w + "胜" + fa.d + "平" + fa.l + "负 · 场均 " + fa.ppg + " 分</b></div>";
    if (r.h2h && r.h2h.length) {
      h += '<div class="hint" style="margin-top:6px">近期交锋：' + esc(r.h2h.slice(0, 2).map((x) => String(x.date).slice(5) + " " + x.home + " " + x.score + " " + x.away).join("；")) + "</div>";
    }
    if (fh && fa) {
      const diff = fh.ppg - fa.ppg;
      const s = diff >= 0.6 ? "基本面同向：主队近期状态明显更好" : diff <= -0.6 ? "基本面同向：客队近期状态明显更好" : "基本面分歧不大：两队近期状态接近";
      h += '<div class="hint" style="margin-top:6px">' + esc(s) + "。战绩只作参考，不直接改变概率。</div>";
    }
    return h || '<div class="hint">暂无足够近期战绩。</div>';
  }

  function buildParlay() {
    const rows = [];
    for (const m of state.jc.list) {
      const ana = JC.analyzeMatch(m.pools);
      const st = JC.starsOf(ana);
      if (!st || !ana.had) continue;
      const o = ana.had.odds[st.dir];
      if (o == null) continue;
      const v = ana.value && ana.value[st.dir];
      const edge = v && v.edge != null ? v.edge : 0;
      rows.push({ m, name: st.name, p: st.pMax, o, stars: st.stars, score: st.pMax + Math.max(0, edge) * 0.5 });
    }
    rows.sort((a, b) => b.score - a.score);
    const pick = rows.filter((r) => r.stars >= 3).slice(0, 2);
    if (pick.length < 2) return null;
    return { picks: pick, p: pick[0].p * pick[1].p, o: pick[0].o * pick[1].o };
  }

  function parlayHTML(pl) {
    let h = '<div class="card"><div class="eyebrow">当日串关参考 · 按信心自动挑选</div>';
    pl.picks.forEach((r, i) => {
      h += '<div class="pr-l" style="font-size:13px"><span>' + (i + 1) + ". " + esc(r.m.num) + " " + esc(r.m.home) + " vs " + esc(r.m.away) + "</span><b class=\"num\">" + esc(r.name) + " @" + r.o.toFixed(2) + " · " + "★".repeat(r.stars) + "</b></div>";
    });
    h += '<div class="hint num" style="margin-top:6px">组合赔率 ' + pl.o.toFixed(2) + " · 两场全对概率约 " + (pl.p * 100).toFixed(1) + "%</div>" +
      '<div class="hint" style="margin-top:4px">串关把方差放大，两场全对才有回报；仅供参考，请理性投注。</div></div>';
    return h;
  }

  function openSheet(m) {
    const ana = JC.analyzeMatch(m.pools);
    const st8 = JC.starsOf(ana);
    let h = "<h3>" + esc(m.home) + " vs " + esc(m.away) + "</h3>" +
      '<div class="sub-t">' + esc(m.league) + " · " + (wdLabel(m.date) ? wdLabel(m.date) + " " : "") + esc(m.date) + " " + esc(m.time) + " · 编号 " + esc(m.num) + "</div>" +
      (st8 ? '<div class="sub-t" style="color:var(--fg);font-size:13px">主方向 <strong>' + esc(st8.name) + "</strong> " +
        "★".repeat(st8.stars) + "☆".repeat(5 - st8.stars) +
        " · 市场倾向 " + esc(st8.name) + " " + pctf(st8.pMax, 0) +
        (st8.div != null ? " · 口径分歧 " + st8.div.toFixed(3) + (st8.div < 0.04 ? "（低）" : st8.div < 0.08 ? "（中）" : "（高）") : "") + "</div>" : "");
    if (ana.had) {
      h += '<div class="card"><div class="eyebrow">胜平负 · 去水市场概率（返还率 ' + (ana.had.payout * 100).toFixed(1) + "%）</div>";
      ["胜", "平", "负"].forEach((lab, i) => {
        const p = ana.had.probs[i], o = ana.had.odds[i];
        h += '<div class="pr-row"><div class="pr-l"><span>' + lab + " @" + (o != null ? o.toFixed(2) : "—") + "</span><b class=\"num\">" + pctf(p) + "</b></div>" +
          '<div class="bar"><i style="width:' + (p != null ? (p * 100).toFixed(1) : 0) + '%"></i></div></div>';
      });
      h += "</div>";
    }
    if (ana.sources.length > 1) {
      h += '<div class="card"><div class="eyebrow">跨玩法互证（胜 / 平 / 负）</div>';
      for (const s of ana.sources) {
        h += '<div class="pr-row"><div class="pr-l"><span>' + esc(s.name) + (s.ref ? ' <span class="src-tag">（基准）</span>' : "") + "</span><b class=\"num\">" +
          s.probs.map((x) => pctf(x, 0)).join(" / ") + "</b></div></div>";
      }
      h += '<div class="hint" style="margin-top:6px">各玩法各自定价，反推出的概率互有分歧时值得留意。</div></div>';
    }
    if (ana.consensus && ana.had && ana.value) {
      h += '<div class="card"><div class="eyebrow">跨玩法一致预期 · 价值检测</div>';
      ["胜", "平", "负"].forEach((lab, i) => {
        const c = ana.consensus[i], v = ana.value[i], o = ana.had.odds[i];
        const edge = v && v.edge != null ? v.edge : null;
        const col = edge == null ? "var(--fg)" : edge >= 0.02 ? "var(--success)" : edge <= -0.03 ? "var(--danger)" : "var(--fg)";
        h += '<div class="pr-row"><div class="pr-l"><span>' + lab + " @" + (o != null ? o.toFixed(2) : "—") + " · 一致概率 " + pctf(c) + "</span>" +
          '<b class="num" style="color:' + col + '">' + (edge == null ? "—" : (edge >= 0 ? "+" : "") + (edge * 100).toFixed(1) + "% EV") + "</b></div>" +
          '<div class="bar"><i style="width:' + (c * 100).toFixed(1) + (edge != null && edge >= 0.02 ? "%;background:var(--accent)" : "%") + '"></i></div></div>';
      });
      h += '<div class="hint" style="margin-top:8px">EV = 一致概率 × 赔率 − 1，≥ +2% 视为有价值方向；Kelly 建议仓位 = max(0, EV ÷ (赔率−1))，建议再除以 4 并设单场上限。价值是长期统计优势，不代表单场结果。</div></div>';
    }
    if (ana.hhadValue && ana.hhad) {
      h += '<div class="card"><div class="eyebrow">让球(' + esc(ana.hhadValue.line) + ") · 模型 vs 市场</div>";
      ["主胜", "平", "主负"].forEach((lab, i) => {
        const p = ana.hhadValue.probs[i];
        const o = ana.hhad.odds[i];
        const v = ana.hhadValue.value[i];
        const edge = v && v.edge != null ? v.edge : null;
        const col = edge != null && edge >= 0.02 ? "var(--success)" : "var(--fg)";
        h += '<div class="pr-row"><div class="pr-l"><span>' + lab + " @" + (o != null ? o.toFixed(2) : "—") + " · 模型 " + pctf(p) + "</span><b class=\"num\" style=\"color:" + col + "\">" + (edge == null ? "—" : (edge >= 0 ? "+" : "") + (edge * 100).toFixed(1) + "% EV") + "</b></div>" +
          '<div class="bar"><i style="width:' + (p * 100).toFixed(1) + '%"></i></div></div>';
      });
      h += '<div class="hint" style="margin-top:6px">模型概率由比分矩阵按让球线平移得到；EV ≥ +2% 才值得关注。</div></div>';
    }
    if (ana.pm) {
      h += '<div class="card"><div class="eyebrow">比分分布（泊松 + Dixon-Coles 修正 ρ=' + (ana.pm.rho != null ? ana.pm.rho.toFixed(2) : "-0.05") + " · λ总≈" + (ana.pm.lambdaTotal != null ? ana.pm.lambdaTotal.toFixed(2) : "—") + "）</div>";
      for (const s of ana.pm.top.slice(0, 6)) {
        h += '<div class="pr-row"><div class="pr-l"><span class="num">' + s.h + ":" + s.a + '</span><b class="num">' + (s.p * 100).toFixed(1) + "%</b></div>" +
          '<div class="bar"><i style="width:' + (s.p * 100).toFixed(1) + '%"></i></div></div>';
      }
      if (ana.ttg) h += '<div class="hint" style="margin-top:6px">总进球玩法返还率 ' + (ana.ttg.payout * 100).toFixed(1) + "%，隐含平均进球 ≈ " + (ana.ttg.lambda != null ? ana.ttg.lambda.toFixed(2) : "—") + "</div>";
      h += "</div>";
    } else if (ana.ttg && ana.ttg.lambda != null) {
      h += '<div class="card"><div class="eyebrow">总进球</div><div class="hint">市场隐含平均总进球 ≈ ' + ana.ttg.lambda.toFixed(2) + "（本场缺比分玩法数据，无法重建泊松矩阵）</div></div>";
    }
    h += '<div class="card"><div class="eyebrow">赔率变动（开盘 → 当前）</div><div id="mv-body"><div class="hint">加载中…</div></div></div>';
    h += '<div class="card"><div class="eyebrow">基本面 · 排名 / 近况 / 交锋（500 源）</div><div id="fund-body"><div class="hint">加载中…</div></div></div>';
    h += '<div class="hint" style="margin:6px 2px 0">所有口径均来自官方赔率与公开数据的换算，属于概率估计而非预测。理性投注，量力而行。</div>';
    $("#sheet-body").innerHTML = h;
    $("#overlay").classList.add("on");
    $("#sheet").classList.add("open");
    $("#sheet").scrollTop = 0;
    loadMovement(m).then((r) => {
      const el = $("#mv-body");
      if (el) el.innerHTML = movementHTML(r);
    });
    loadFund(m).then((r) => {
      const el = $("#fund-body");
      if (el) el.innerHTML = fundHTML(r);
    });
  }

  function closeSheet() {
    $("#overlay").classList.remove("on");
    $("#sheet").classList.remove("open");
  }

  function bindJCPage() {
    const el = $("#page-jc");
    el.addEventListener("click", (ev) => {
      const act = ev.target.closest("[data-act]");
      if (act) { if (act.dataset.act === "refresh") loadJC(true); return; }
      const card = ev.target.closest(".match-card");
      if (card) {
        const m = state.jc.list.find((x) => x.id === card.dataset.mid);
        if (m) openSheet(m);
      }
    });
    el.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      const card = ev.target.closest && ev.target.closest(".match-card");
      if (card) {
        const m = state.jc.list.find((x) => x.id === card.dataset.mid);
        if (m) { ev.preventDefault(); openSheet(m); }
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
    if (id === "page-jc" && !state.jc.loaded && !state.jc.loading) loadJC(false);
    window.scrollTo(0, 0);
  }

  function boot() {
    loadLocal();
    bindGamePage("ssq");
    bindGamePage("dlt");
    bindJCPage();
    renderGame("ssq");
    renderGame("dlt");
    renderJC();
    $("#sheet-close").addEventListener("click", closeSheet);
    $("#overlay").addEventListener("click", closeSheet);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });
    $$(".tab-btn").forEach((b) => b.addEventListener("click", () => switchPage(b.dataset.page)));
    if (SNAP.builtAt) { const el2 = $("#snap-built"); if (el2) el2.textContent = String(SNAP.builtAt).slice(0, 10); }
    switchPage("page-ssq");
    if (store.ssq.list.length && store.dlt.list.length) setNet("ok", "本地数据就绪 · 正在核对官方");
    else setNet("", "正在获取数据…");
    const AUTO_AGE = 6 * 3600e3;
    ["ssq", "dlt"].forEach((g, i) => {
      if (!store[g].ts || Date.now() - store[g].ts >= AUTO_AGE) {
        setTimeout(() => refreshGame(g, true), 800 + i * 2000);
      }
    });
    if ("serviceWorker" in navigator &&
        (location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  boot();
})();
