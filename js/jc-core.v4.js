/* jc-core.js — 竞彩赔率分析引擎（移植自「竞彩赔率分析」工具 core.js 的核心纯函数）
   口径与原工具一致：去水公平概率、跨玩法互证、泊松模型、价值与 Kelly */
(function (global) {
  "use strict";

  const num = (x) => {
    if (x == null || x === "") return null;
    const v = parseFloat(x);
    return isFinite(v) ? v : null;
  };

  /* 一组互斥赔率 → 去水公平概率 + 返还率（payout=1/总隐含概率） */
  function implied(odds) {
    const inv = odds.map(num);
    let s = 0;
    for (const v of inv) if (v != null && v > 1) s += 1 / v;
    if (s <= 0) return { probs: odds.map(() => null), margin: null, payout: null };
    return {
      probs: inv.map((v) => (v != null && v > 1 ? 1 / v / s : null)),
      margin: s,
      payout: 1 / s,
    };
  }

  function hadFair(pool) {
    if (!pool) return null;
    const im = implied([pool.h, pool.d, pool.a]);
    if (im.probs.every((p) => p == null)) return null;
    return { probs: im.probs, payout: im.payout, margin: im.margin, odds: im.probs.map((_, i) => num([pool.h, pool.d, pool.a][i])) };
  }

  function hhadFair(pool) {
    const r = hadFair(pool);
    if (!r) return null;
    r.line = num(pool.goalLine);
    return r;
  }

  /* ---------- 比分 CRS（28 个具体比分 + 3 个"其他"） ---------- */
  const CRS_OTHER = {
    "s-1sh": ["胜其他", "home"], "s1sh": ["胜其他", "home"],
    "s-1sd": ["平其他", "draw"], "s1sd": ["平其他", "draw"],
    "s-1sa": ["负其他", "away"], "s1sa": ["负其他", "away"],
  };

  function crsFair(pool) {
    if (!pool) return null;
    const items = [];
    for (const [k, v] of Object.entries(pool)) {
      const odds = num(v);
      if (odds == null) continue;
      const m = /^s0?(\d)s0?(\d)$/.exec(k);
      if (m) {
        const h = +m[1], a = +m[2];
        const group = h > a ? "home" : h === a ? "draw" : "away";
        items.push({ key: k, label: h + ":" + a, h, a, odds, group, other: false });
      } else if (CRS_OTHER[k]) {
        const [label, group] = CRS_OTHER[k];
        items.push({ key: k, label, h: null, a: null, odds, group, other: true });
      }
    }
    if (!items.length) return null;
    const im = implied(items.map((i) => i.odds));
    items.forEach((it, i) => { it.prob = im.probs[i]; });
    const sums = { home: 0, draw: 0, away: 0 };
    let mH = 0, mA = 0, sf = 0;
    for (const it of items) {
      if (it.prob == null) continue;
      sums[it.group] += it.prob;
      if (!it.other) { mH += it.prob * it.h; mA += it.prob * it.a; sf += it.prob; }
    }
    const order = { home: 0, draw: 1, away: 2 };
    items.sort((x, y) =>
      order[x.group] - order[y.group] ||
      (x.other ? 1 : 0) - (y.other ? 1 : 0) ||
      x.h - y.h || x.a - y.a
    );
    return {
      items,
      sums,
      payout: im.payout,
      margin: im.margin,
      lambdaH: sf > 0 ? mH / sf : null,
      lambdaA: sf > 0 ? mA / sf : null,
    };
  }

  /* ---------- 总进球 TTG（0~7+） ---------- */
  function ttgFair(pool) {
    if (!pool) return null;
    const items = [];
    for (let k = 0; k <= 7; k++) {
      const odds = num(pool["s" + k]);
      if (odds == null) continue;
      items.push({ key: "s" + k, label: k === 7 ? "7+" : String(k), goals: k, odds });
    }
    if (!items.length) return null;
    const im = implied(items.map((i) => i.odds));
    items.forEach((it, i) => { it.prob = im.probs[i]; });
    let lam = 0, sf = 0;
    for (const it of items) if (it.prob != null && it.goals < 7) { lam += it.prob * it.goals; sf += it.prob; }
    return { items, payout: im.payout, margin: im.margin, lambda: sf > 0 ? lam / sf : null };
  }

  /* ---------- 半全场 HAFU（9 格） ---------- */
  const HAFU_L = { h: "主", d: "平", a: "客" };
  function hafuFair(pool) {
    if (!pool) return null;
    const items = [];
    for (const half of ["h", "d", "a"]) {
      for (const full of ["h", "d", "a"]) {
        const k = half + full;
        const odds = num(pool[k]);
        if (odds == null) continue;
        items.push({ key: k, half, full, label: HAFU_L[half] + HAFU_L[full], odds });
      }
    }
    if (!items.length) return null;
    const im = implied(items.map((i) => i.odds));
    items.forEach((it, i) => { it.prob = im.probs[i]; });
    const halfM = { h: 0, d: 0, a: 0 }, fullM = { h: 0, d: 0, a: 0 };
    for (const it of items) if (it.prob != null) { halfM[it.half] += it.prob; fullM[it.full] += it.prob; }
    return { items, halfM, fullM, payout: im.payout, margin: im.margin };
  }

  /* ---------- 泊松模型（以比分隐含的攻防强度重建矩阵） ---------- */
  const FACT = (() => { const f = [1]; for (let i = 1; i <= 12; i++) f[i] = f[i - 1] * i; return f; })();
  const pois = (l, k) => (Math.exp(-l) * Math.pow(l, k)) / FACT[k];

  function poissonModel(lambdaH, lambdaA, maxG = 10) {
    if (lambdaH == null || lambdaA == null) return null;
    const ph = [], pa = [];
    for (let k = 0; k <= maxG; k++) { ph.push(pois(lambdaH, k)); pa.push(pois(lambdaA, k)); }
    let pHome = 0, pDraw = 0, pAway = 0;
    const totals = new Array(8).fill(0);
    const scores = [];
    for (let h = 0; h <= maxG; h++) {
      for (let a = 0; a <= maxG; a++) {
        const p = ph[h] * pa[a];
        if (h > a) pHome += p; else if (h === a) pDraw += p; else pAway += p;
        const t = h + a;
        if (t >= 7) totals[7] += p; else totals[t] += p;
        scores.push({ h, a, p });
      }
    }
    scores.sort((x, y) => y.p - x.p);
    const tot = pHome + pDraw + pAway;
    if (tot > 0) {
      pHome /= tot; pDraw /= tot; pAway /= tot;
      for (let i = 0; i < 8; i++) totals[i] /= tot;
      for (const s of scores) s.p /= tot;
    }
    return { pHome, pDraw, pAway, totals, top: scores.slice(0, 8), lambdaTotal: lambdaH + lambdaA };
  }

  /* ---------- 共识概率 / 价值 / Kelly ---------- */
  function consensus1x2(rows) {
    const ok = rows.filter((r) => r && r.every((x) => x != null && isFinite(x) && x >= 0));
    if (!ok.length) return null;
    const avg = [0, 0, 0];
    for (const r of ok) for (let i = 0; i < 3; i++) avg[i] += r[i];
    const s = avg[0] + avg[1] + avg[2];
    return s > 0 ? avg.map((x) => x / s) : null;
  }

  function kelly(p, o) {
    p = num(p); o = num(o);
    if (p == null || o == null || o <= 1) return null;
    const edge = p * o - 1;
    return { edge, kelly: edge / (o - 1) };
  }

  /* ---------- 汇总分析 ---------- */
  function analyzeMatch(pools) {
    pools = pools || {};
    const had = hadFair(pools.had);
    const hhad = pools.hhad ? hhadFair(pools.hhad) : null;
    const crs = crsFair(pools.crs);
    const ttg = ttgFair(pools.ttg);
    const hafu = hafuFair(pools.hafu);
    const pm = crs && crs.lambdaH != null ? dixonColesModel(crs.lambdaH, crs.lambdaA) : null;

    const sources = [];
    if (had) sources.push({ name: "胜平负（竞彩）", probs: had.probs, ref: true });
    if (crs) sources.push({ name: "比分反推", probs: [crs.sums.home, crs.sums.draw, crs.sums.away] });
    if (hafu) sources.push({ name: "半全场反推", probs: [hafu.fullM.h, hafu.fullM.d, hafu.fullM.a] });
    if (pm) sources.push({ name: "泊松模型", probs: [pm.pHome, pm.pDraw, pm.pAway] });
    const nonRef = sources.filter((s) => !s.ref);
    const consensus = consensus1x2(nonRef.map((s) => s.probs)) || (had ? had.probs.slice() : null);
    let value = null;
    if (consensus && had) {
      value = [kelly(consensus[0], had.odds[0]), kelly(consensus[1], had.odds[1]), kelly(consensus[2], had.odds[2])];
    }
    let hhadValue = null;
    if (hhad && crs && crs.lambdaH != null && hhad.odds && hhad.odds.every((x) => x != null)) {
      const hp = handicapProbs(crs.lambdaH, crs.lambdaA, hhad.line);
      if (hp) {
        hhadValue = {
          line: hhad.line,
          probs: [hp.w, hp.d, hp.l],
          value: [kelly(hp.w, hhad.odds[0]), kelly(hp.d, hhad.odds[1]), kelly(hp.l, hhad.odds[2])],
        };
      }
    }
    return { had, hhad, crs, ttg, hafu, pm, sources, consensus, value, hhadValue };
  }

  /* ---------- Dixon-Coles 修正泊松：低比分相关性调整（行业标准做法，ρ 取小负值） ---------- */
  function dixonColesModel(lambdaH, lambdaA, maxG = 10, rho = -0.05) {
    if (lambdaH == null || lambdaA == null) return null;
    const ph = [], pa = [];
    for (let k = 0; k <= maxG; k++) { ph.push(pois(lambdaH, k)); pa.push(pois(lambdaA, k)); }
    const tau = (h, a) => {
      if (h === 0 && a === 0) return Math.max(0, 1 - lambdaH * lambdaA * rho);
      if (h === 0 && a === 1) return Math.max(0, 1 + lambdaH * rho);
      if (h === 1 && a === 0) return Math.max(0, 1 + lambdaA * rho);
      if (h === 1 && a === 1) return Math.max(0, 1 - rho);
      return 1;
    };
    let pHome = 0, pDraw = 0, pAway = 0;
    const totals = new Array(8).fill(0);
    const scores = [];
    const matrix = [];
    for (let h = 0; h <= maxG; h++) {
      for (let a = 0; a <= maxG; a++) {
        let p = ph[h] * pa[a] * tau(h, a);
        if (p < 0) p = 0;
        matrix.push({ h, a, p });
        if (h > a) pHome += p; else if (h === a) pDraw += p; else pAway += p;
        const t = h + a;
        if (t >= 7) totals[7] += p; else totals[t] += p;
        scores.push({ h, a, p });
      }
    }
    scores.sort((x, y) => y.p - x.p);
    const tot = pHome + pDraw + pAway;
    if (tot > 0) {
      pHome /= tot; pDraw /= tot; pAway /= tot;
      for (let i = 0; i < 8; i++) totals[i] /= tot;
      for (const s of scores) s.p /= tot;
      for (const s of matrix) s.p /= tot;
    }
    return { pHome, pDraw, pAway, totals, top: scores.slice(0, 8), lambdaTotal: lambdaH + lambdaA, rho, matrix };
  }

  /* ---------- 让球盘模型概率：比分矩阵按让球线平移后求胜平负 ---------- */
  function handicapProbs(lambdaH, lambdaA, line) {
    line = num(line);
    if (line == null || lambdaH == null || lambdaA == null) return null;
    const m = dixonColesModel(lambdaH, lambdaA);
    if (!m) return null;
    let w = 0, d = 0, l = 0;
    for (const s of m.matrix) {
      const adj = s.h + line;
      if (adj > s.a) w += s.p; else if (adj === s.a) d += s.p; else l += s.p;
    }
    return { w, d, l, line };
  }

  /* ---------- 赔率变动（开盘 → 当前快照序列） ---------- */
  function poolMovement(list, keys) {
    if (!Array.isArray(list) || list.length < 2) return null;
    const f = list[0], l = list[list.length - 1];
    const fv = keys.map((k) => num(f[k]));
    const lv = keys.map((k) => num(l[k]));
    const delta = lv.map((v, i) => (v != null && fv[i] != null ? +(v - fv[i]).toFixed(3) : null));
    const r = {
      n: list.length,
      firstAt: ((f.updateDate || "") + " " + (f.updateTime || "")).trim(),
      lastAt: ((l.updateDate || "") + " " + (l.updateTime || "")).trim(),
      first: fv, last: lv, delta,
    };
    if (keys.length === 3 && "goalLine" in f) {
      const lines = new Set(list.map((s) => String(s.goalLine)));
      r.lineChanged = lines.size > 1;
      r.line = num(l.goalLine);
    }
    return r;
  }

  /* ---------- 基本面近期战绩汇总（配合 /api/fund 的 500 源数据） ---------- */
  function formSummary(matches) {
    if (!Array.isArray(matches) || !matches.length) return null;
    const played = matches.filter((m) => m.res && typeof m.teamGoals === "number");
    if (!played.length) return null;
    const last = played.slice(0, 6);
    let w = 0, dr = 0, l = 0, gf = 0, ga = 0;
    for (const m of last) {
      if (m.res === "胜") w++; else if (m.res === "平") dr++; else l++;
      gf += m.teamGoals; ga += m.oppGoals;
    }
    return {
      w, d: dr, l, gf, ga, n: last.length,
      ppg: +(((w * 3 + dr) / last.length).toFixed(2)),
      list: played.slice(0, 5).map((m) => ({ date: String(m.date).slice(5), comp: m.comp, home: m.home, away: m.away, score: m.score, res: m.res })),
    };
  }

  /* ---------- 信心星级与口径分歧度 ---------- */
  function starsOf(ana) {
    const c = ana.consensus;
    if (!c) return null;
    let dir = 0;
    for (let i = 1; i < 3; i++) if (c[i] > c[dir]) dir = i;
    const srcs = ana.sources.filter((s) => !s.ref);
    let div = null;
    if (srcs.length >= 2) {
      div = 0;
      for (let i = 0; i < 3; i++) {
        const arr = srcs.map((s) => s.probs[i]);
        const mu = arr.reduce((a, b) => a + b, 0) / arr.length;
        div += Math.sqrt(arr.reduce((a, b) => a + (b - mu) * (b - mu), 0) / arr.length);
      }
      div /= 3;
    }
    const confBase = Math.max(0, Math.min(1, (c[dir] - 0.36) / 0.4));
    const conf = div == null ? confBase : confBase * Math.max(0, 1 - div / 0.12);
    const stars = 1 + Math.round(conf * 4);
    return { dir, name: ["胜", "平", "负"][dir], pMax: c[dir], div, stars };
  }

  global.JC = { implied, hadFair, hhadFair, crsFair, ttgFair, hafuFair, poissonModel, dixonColesModel, handicapProbs, consensus1x2, kelly, analyzeMatch, poolMovement, formSummary, starsOf };
})(window);
