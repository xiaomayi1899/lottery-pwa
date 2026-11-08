/* jc-core.v5.js — 竞彩三指标引擎
   指标一：真实去水赔率（de-vig）；指标二：市场热度（赔率水平+变化方向代理，官方无投注率公开接口）；
   指标三：实力（排名/近况/交锋）；叠加：大热必死规则、跨玩法异常检测（如 胜2.2 vs 胜胜3.1）。
   口径与「竞彩赔率分析」工具一致：跨玩法互证、Dixon-Coles 修正泊松、价值与 Kelly。 */
(function (global) {
  "use strict";

  const num = (x) => {
    if (x == null || x === "") return null;
    const v = parseFloat(x);
    return isFinite(v) ? v : null;
  };
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);

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
      items, sums, payout: im.payout, margin: im.margin,
      lambdaH: sf > 0 ? mH / sf : null, lambdaA: sf > 0 ? mA / sf : null,
    };
  }

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

  const FACT = (() => { const f = [1]; for (let i = 1; i <= 12; i++) f[i] = f[i - 1] * i; return f; })();
  const pois = (l, k) => (Math.exp(-l) * Math.pow(l, k)) / FACT[k];

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
    if (pm) sources.push({ name: "泊松(DC)模型", probs: [pm.pHome, pm.pDraw, pm.pAway] });
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

  /* ---------- 指标二：市场热度（官方未公开投注率 → 赔率水平 + 变化方向代理） ---------- */
  function heatFromOdds(ana, mv) {
    if (!ana || !ana.had) return null;
    const out = [];
    for (let i = 0; i < 3; i++) {
      const o = ana.had.odds[i];
      if (o == null) { out.push(null); continue; }
      const level = clamp01((2.05 - o) / 1.0);
      let flow = 0;
      if (mv && mv.had && mv.had.delta[i] != null) {
        flow = clamp01(-mv.had.delta[i] / 0.2);
      }
      out.push(clamp01(0.65 * level + 0.35 * flow));
    }
    return out;
  }

  /* ---------- 指标三：实力（排名 + 近况场均分） ---------- */
  function strengthFromFund(fund) {
    if (!fund || fund.found !== true || !fund.home || !fund.away) return null;
    const fh = formSummary(fund.home.matches);
    const fa = formSummary(fund.away.matches);
    let s = 0.5;
    const rh = fund.home.rank, ra = fund.away.rank;
    if (rh != null && ra != null) s += 0.25 * Math.tanh((ra - rh) / 6);
    if (fh && fa) s += 0.45 * Math.tanh((fh.ppg - fa.ppg) * 1.1);
    s = clamp01(s);
    return [s, 0.5, 1 - s];
  }

  /* ---------- 跨玩法异常检测（population = 当日全表分布） ---------- */
  function populationStats(list) {
    const buckets = {};
    for (const m of list || []) {
      const ana = analyzeMatch(m.pools);
      if (!ana.had || !ana.hafu || !ana.crs) continue;
      const ph = ana.had.probs[0], pa = ana.had.probs[2], pd = ana.had.probs[1];
      const hh = (ana.hafu.items.find((x) => x.key === "hh") || {}).prob;
      const aa = (ana.hafu.items.find((x) => x.key === "aa") || {}).prob;
      const put = (k, v) => { if (v != null && isFinite(v)) { (buckets[k] = buckets[k] || []).push(v); } };
      if (hh != null && ph) put("rhh", hh / ph);
      if (aa != null && pa) put("raa", aa / pa);
      put("dCrsH", ana.crs.sums[0] - ph);
      put("dCrsD", ana.crs.sums[1] - pd);
      put("dHafuH", ana.hafu.fullM[0] - ph);
    }
    const stats = {};
    for (const k of Object.keys(buckets)) {
      const arr = buckets[k];
      const m = mean(arr);
      const sd = Math.sqrt(arr.reduce((s, x) => s + (x - m) * (x - m), 0) / (arr.length || 1)) || 0.0001;
      stats[k] = { mean: m, sd, n: arr.length };
    }
    return stats;
  }

  function anomalyScan(ana, pop) {
    if (!ana || !ana.had || !pop) return { flags: [], bonus: null };
    const flags = [];
    const bonus = [0.5, 0.5, 0.5];
    const ph = ana.had.probs[0], pa = ana.had.probs[2], pd = ana.had.probs[1];
    const zed = (k, v) => {
      const s = pop[k];
      if (!s || v == null || !isFinite(v)) return null;
      return (v - s.mean) / s.sd;
    };
    if (ana.hafu) {
      const hh = (ana.hafu.items.find((x) => x.key === "hh") || {}).prob;
      const z1 = zed("rhh", hh != null && ph ? hh / ph : null);
      if (z1 != null && z1 >= 1.2) {
        flags.push("半全场「胜胜」/ 胜平负「胜」概率比 " + (hh / ph).toFixed(2) +
          "，显著高于当日全表均值 " + pop.rhh.mean.toFixed(2) + "（z=" + z1.toFixed(1) + "）——市场在半全场重仓主胜，主胜被低估");
        bonus[0] += Math.min(0.35, z1 * 0.08);
      }
      const aa = (ana.hafu.items.find((x) => x.key === "aa") || {}).prob;
      const z2 = zed("raa", aa != null && pa ? aa / pa : null);
      if (z2 != null && z2 >= 1.2) {
        flags.push("半全场「负负」/ 胜平负「负」概率比 " + (aa / pa).toFixed(2) +
          "，显著高于全表均值 " + pop.raa.mean.toFixed(2) + "（z=" + z2.toFixed(1) + "）——客胜被低估");
        bonus[2] += Math.min(0.35, z2 * 0.08);
      }
    }
    if (ana.crs) {
      const z3 = zed("dCrsH", ana.crs.sums[0] - ph);
      if (z3 != null && z3 >= 1.3) {
        flags.push("比分口径主胜 " + (ana.crs.sums[0] * 100).toFixed(0) + "% 明显高于胜平负口径 " + (ph * 100).toFixed(0) + "%（z=" + z3.toFixed(1) + "）");
        bonus[0] += Math.min(0.3, z3 * 0.06);
      }
      const z4 = zed("dCrsD", ana.crs.sums[1] - pd);
      if (z4 != null && z4 >= 1.3) {
        flags.push("比分口径平局 " + (ana.crs.sums[1] * 100).toFixed(0) + "% 明显高于胜平负口径 " + (pd * 100).toFixed(0) + "%（z=" + z4.toFixed(1) + "）——平局需重点防");
        bonus[1] += Math.min(0.3, z4 * 0.06);
      }
      const z5 = zed("dHafuH", ana.hafu ? ana.hafu.fullM[0] - ph : null);
      if (z5 != null && z5 >= 1.3) {
        flags.push("半全场口径主胜 " + (ana.hafu.fullM[0] * 100).toFixed(0) + "% 高于胜平负口径（z=" + z5.toFixed(1) + "）");
        bonus[0] += Math.min(0.3, z5 * 0.06);
      }
    }
    return { flags, bonus: bonus.map((b) => clamp01(b)) };
  }

  /* ---------- 三指标综合（含大热必死） ---------- */
  function composite(ana, ctx) {
    if (!ana || !ana.had) return null;
    ctx = ctx || {};
    const heat = ctx.heat || null;
    const strength = ctx.strength || null;
    const anomaly = ctx.anomaly && ctx.anomaly.bonus ? ctx.anomaly.bonus : null;
    const names = ["胜", "平", "负"];
    const rows = [];
    for (let i = 0; i < 3; i++) {
      const p = ana.had.probs[i], o = ana.had.odds[i];
      const v = ana.value ? ana.value[i] : null;
      const edge = v && v.edge != null ? v.edge : null;
      const sValue = edge == null ? 0.5 : clamp01(0.5 + edge * 6);
      const h = heat ? heat[i] : null;
      const sHeat = h == null ? 0.5 : clamp01(1 - h);
      const st = strength ? strength[i] : null;
      const sStr = st == null ? 0.5 : clamp01(st);
      const an = anomaly ? anomaly[i] : null;
      const sAnom = an == null ? 0.5 : clamp01(an);
      const total = 0.40 * sValue + 0.20 * sHeat + 0.20 * sStr + 0.20 * sAnom;
      rows.push({ i, name: names[i], p, o, edge, heat: h, strength: st, sValue, sHeat, sStr, sAnom, total });
    }
    rows.sort((a, b) => b.total - a.total);
    const hot = rows.slice().sort((x, y) => (y.heat != null ? y.heat : -1) - (x.heat != null ? x.heat : -1))[0];
    const trap = !!(hot && hot.heat != null && hot.heat >= 0.65 && (hot.edge == null || hot.edge <= 0.01));
    const stars = Math.max(1, Math.min(5, 1 + Math.round((rows[0].total - 0.33) / 0.075)));
    return { rows, top: rows[0], hot, trap, stars, heatAvail: !!heat, strAvail: !!strength };
  }

  global.JC = {
    implied, hadFair, hhadFair, crsFair, ttgFair, hafuFair,
    poissonModel: dixonColesModel, dixonColesModel, handicapProbs,
    consensus1x2, kelly, analyzeMatch, poolMovement, formSummary,
    heatFromOdds, strengthFromFund, populationStats, anomalyScan, composite,
  };
})(window);
