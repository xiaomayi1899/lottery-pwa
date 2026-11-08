/* engine.v5.js — 数字彩推荐引擎 v5：近 50 期基础走势形态系统
   维度：和值 / 奇偶 / 质合 / 大小 / 区间 / 走势图模式(重号·邻号·斜跳) / 冷热遗漏
   流程：各维度统计 → 预测下期形态 → 形态约束下按不同评分视角合成推荐（含随机对照）
   郑重声明：开奖为独立随机事件，任何形态分析都不能提高中奖概率，本引擎仅做统计整理。 */
(function (global) {
  "use strict";

  const GAMES = {
    dlt: { name: "大乐透", full: "超级大乐透", fn: 35, fk: 5, bn: 12, bk: 2, price: 2,
      zones: [12, 24],
      tierNote: "前区 1–35 选 5，后区 1–12 选 2" },
    ssq: { name: "双色球", full: "双色球", fn: 33, fk: 6, bn: 16, bk: 1, price: 2,
      zones: [11, 22],
      tierNote: "红球 1–33 选 6，蓝球 1–16 选 1" },
  };
  const WINDOW = 50; // 分析窗口：只用最近 50 期（用户口径）
  const PRIMES = [1, 2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31]; // 官方走势图惯例：1 计入质数

  var DATA = null; // 由 app.js 注入 {dlt:[...], ssq:[...]}

  const mulberry32 = (a) => function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const pad2 = (n) => String(n).padStart(2, "0");
  const fmtS = (set) => [...set].sort((a, b) => a - b).map(pad2).join(" ");
  const fmtArr = (a) => a.slice().sort((x, y) => x - y).map(pad2).join(" ");
  const pct = (x, nd) => (x * 100).toFixed(nd === undefined ? 1 : nd) + "%";
  const isPrime = (n) => PRIMES.indexOf(n) >= 0;
  const zoneOf = (cfg, x) => (x <= cfg.zones[0] ? 0 : x <= cfg.zones[1] ? 1 : 2);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  const std = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length || 1)); };

  function buildTS(cfg, draws) {
    const D = draws.length;
    const fSets = draws.map((d) => new Set(d.nums.slice(0, cfg.fk)));
    const bSets = draws.map((d) => new Set(d.nums.slice(cfg.fk)));
    const fc = new Array(cfg.fn + 1).fill(0), bc = new Array(cfg.bn + 1).fill(0);
    const fom = new Array(cfg.fn + 1).fill(D), bom = new Array(cfg.bn + 1).fill(D);
    for (let t = D - 1; t >= 0; t--) {
      for (const x of fSets[t]) { fc[x]++; if (fom[x] === D) fom[x] = D - 1 - t; }
      for (const x of bSets[t]) { bc[x]++; if (bom[x] === D) bom[x] = D - 1 - t; }
    }
    const sums = draws.map((d) => d.nums.slice(0, cfg.fk).reduce((a, b) => a + b, 0));
    const half = Math.floor(cfg.fn / 2);
    const oddDist = new Array(cfg.fk + 1).fill(0);
    const primeDist = new Array(cfg.fk + 1).fill(0);
    const lowDist = new Array(cfg.fk + 1).fill(0);
    const zoneMean = [0, 0, 0];
    draws.forEach((d) => {
      const f = d.nums.slice(0, cfg.fk);
      oddDist[f.filter((x) => x % 2 === 1).length]++;
      primeDist[f.filter((x) => isPrime(x)).length]++;
      lowDist[f.filter((x) => x <= half).length]++;
      const zc = [0, 0, 0];
      f.forEach((x) => { zc[zoneOf(cfg, x)]++; });
      for (let z = 0; z < 3; z++) zoneMean[z] += zc[z] / D;
    });
    const repeats = [], neighbors = [], jumps = [];
    for (let t = 1; t < D; t++) {
      let r = 0, n1 = 0, n2 = 0;
      for (const x of fSets[t]) {
        if (fSets[t - 1].has(x)) r++;
        else if (fSets[t - 1].has(x - 1) || fSets[t - 1].has(x + 1)) n1++;
        else if (fSets[t - 1].has(x - 2) || fSets[t - 1].has(x + 2)) n2++;
      }
      repeats.push(r); neighbors.push(n1); jumps.push(n2);
    }
    const bOddDist = new Array(cfg.bk + 1).fill(0);
    bSets.forEach((s) => bOddDist[[...s].filter((x) => x % 2 === 1).length]++);
    const bRepeats = [];
    for (let t = 1; t < D; t++) {
      let r = 0;
      for (const x of bSets[t]) if (bSets[t - 1].has(x)) r++;
      bRepeats.push(r);
    }
    return { D, fSets, bSets, fc, bc, fom, bom, sums, half, oddDist, primeDist, lowDist, zoneMean,
      repeats, neighbors, jumps, bOddDist, bRepeats,
      prevF: fSets[D - 1], prevB: bSets[D - 1] };
  }

  function modeOf(dist) {
    let m = 0;
    for (let i = 1; i < dist.length; i++) if (dist[i] > dist[m]) m = i;
    return m;
  }
  function distLine(dist, total, labelFn) {
    const out = [];
    for (let i = 0; i < dist.length; i++) {
      if (dist[i] > 0) out.push(labelFn(i) + " " + dist[i] + "次(" + (dist[i] / total * 100).toFixed(0) + "%)");
    }
    return out.join(" | ");
  }

  function predictForm(cfg, ts) {
    const odd = modeOf(ts.oddDist);
    const prime = modeOf(ts.primeDist);
    const low = modeOf(ts.lowDist);
    const avg50 = mean(ts.sums), avg10 = mean(ts.sums.slice(-10)), sd = std(ts.sums);
    const center = 0.65 * avg10 + 0.35 * avg50;
    const bh = Math.max(8, Math.round(sd * 0.8));
    const sum = [Math.max(cfg.fk * (cfg.fk + 1) / 2, Math.round(center - bh)), Math.min(cfg.fk * (2 * cfg.fn - cfg.fk + 1) / 2, Math.round(center + bh))];
    const repeat = Math.min(2, Math.round(mean(ts.repeats)));
    const neighbor = Math.min(2, Math.round(mean(ts.neighbors)));
    const jump = Math.min(1, Math.round(mean(ts.jumps)));
    const zoneCounts = ts.zoneMean.map((z) => Math.round(z));
    const bOdd = modeOf(ts.bOddDist);
    return { odd, prime, low, sum, repeat, neighbor, jump, zoneCounts, bOdd,
      avg50: avg50, avg10: avg10, sd: sd, trend: avg10 - avg50 };
  }

  function pickForm(cfg, scoreArr, form, rs) {
    const order = [];
    for (let i = 1; i <= cfg.fn; i++) order.push(i);
    order.sort((a, b) => scoreArr[b] - scoreArr[a]);
    const pool = order.slice(0, 18);
    const zn0 = [0, 0, 0];
    let states = [{ picked: [], odd: 0, pr: 0, low: 0, zn: zn0.slice(), sum: 0, score: 0 }];
    for (let depth = 0; depth < cfg.fk; depth++) {
      const next = [];
      for (const st of states) {
        for (const i of pool) {
          if (st.picked.indexOf(i) >= 0) continue;
          const R = cfg.fk - depth - 1;
          const minRest = R * (R + 1) / 2;
          const maxRest = (cfg.fn - R + 1 + cfg.fn) * R / 2;
          const ns = st.sum + i;
          if (ns + minRest > form.sum[1] + 12) continue;
          if (ns + maxRest < form.sum[0] - 12) continue;
          const zc = st.zn.slice();
          zc[zoneOf(cfg, i)]++;
          next.push({
            picked: st.picked.concat([i]),
            odd: st.odd + (i % 2 === 1 ? 1 : 0),
            pr: st.pr + (isPrime(i) ? 1 : 0),
            low: st.low + (i <= cfg.fn / 2 ? 1 : 0),
            zn: zc, sum: ns, score: st.score + scoreArr[i],
          });
        }
      }
      next.sort((a, b) => b.score - a.score);
      states = next.slice(0, 80);
      if (!states.length) break;
    }
    if (!states.length) return order.slice(0, cfg.fk).sort((a, b) => a - b);
    function q(s) {
      let pen = 0;
      pen += Math.abs(s.odd - form.odd) * 1.0;
      pen += Math.abs(s.pr - form.prime) * 0.8;
      pen += Math.abs(s.low - form.low) * 0.8;
      for (let z = 0; z < 3; z++) pen += Math.abs(s.zn[z] - form.zoneCounts[z]) * 0.6;
      if (s.sum < form.sum[0]) pen += (form.sum[0] - s.sum) * 0.08;
      if (s.sum > form.sum[1]) pen += (s.sum - form.sum[1]) * 0.08;
      return -pen;
    }
    states.sort((a, b) => (q(b) + b.score * 0.12) - (q(a) + a.score * 0.12));
    return states[0].picked.sort((a, b) => a - b);
  }

  function pickBack(cfg, scoreArr, form, rs) {
    const order = [];
    for (let i = 1; i <= cfg.bn; i++) order.push(i);
    order.sort((a, b) => scoreArr[b] - scoreArr[a]);
    if (cfg.bk === 1) {
      const want = form.bOdd;
      const hit = order.find((i) => (i % 2 === 1 ? 1 : 0) === want);
      return [hit != null ? hit : order[0]];
    }
    const want = form.bOdd;
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        if ((order[i] % 2 === 1 ? 1 : 0) + (order[j] % 2 === 1 ? 1 : 0) === want) {
          return [order[i], order[j]].sort((a, b) => a - b);
        }
      }
    }
    return order.slice(0, 2).sort((a, b) => a - b);
  }

  function analyzeGame(key) {
    const cfg = GAMES[key];
    const all = DATA[key];
    if (!all || all.length < 30) throw new Error("历史数据不足 30 期，无法做走势分析");
    const stock = all.length;
    const draws = all.slice(-WINDOW);
    const ts = buildTS(cfg, draws);
    const form = predictForm(cfg, ts);
    const out = {
      name: cfg.name,
      upto: { issue: draws[draws.length - 1].issue, date: String(draws[draws.length - 1].date).slice(0, 10), count: draws.length, stock: stock },
      sections: [],
      form: {
        odd: form.odd + ":" + (cfg.fk - form.odd),
        prime: form.prime + ":" + (cfg.fk - form.prime),
        low: form.low + ":" + (cfg.fk - form.low),
        zone: form.zoneCounts.join(":"),
        sum: form.sum,
        repeat: form.repeat, neighbor: form.neighbor,
      },
    };
    const t0 = Date.now();

    /* ---- 第一节 · 和值 ---- */
    {
      const L = [];
      L.push("近 " + ts.D + " 期和值：均值 " + mean(ts.sums).toFixed(1) + "，最大 " + Math.max.apply(null, ts.sums) + "，最小 " + Math.min.apply(null, ts.sums) + "，标准差 " + std(ts.sums).toFixed(1));
      L.push("近 10 期均值 " + mean(ts.sums.slice(-10)).toFixed(1) + (form.trend >= 0 ? "（高于 50 期均值，走势偏大）" : "（低于 50 期均值，走势偏小）"));
      L.push("预测下期和值带：[" + form.sum[0] + " ~ " + form.sum[1] + "]（近 10 期 65% + 近 50 期 35% 加权中心 ±0.8σ）");
      L.push("⚠ 和值只是号码之和的统计特征，无预测力，仅供约束选号");
      out.sections.push({ title: "第一节 · 和值分析（近 50 期）", lines: L, cand: null, why: "形态维度：和值" });
    }
    /* ---- 第二节 · 奇偶 ---- */
    {
      const L = [];
      L.push("近 " + ts.D + " 期奇偶比分布：" + distLine(ts.oddDist, ts.D, (i) => i + ":" + (cfg.fk - i)));
      L.push("预测下期奇偶比：" + form.odd + ":" + (cfg.fk - form.odd) + "（出现最多）");
      out.sections.push({ title: "第二节 · 奇偶形态", lines: L, cand: null, why: "形态维度：奇偶" });
    }
    /* ---- 第三节 · 质合 ---- */
    {
      const L = [];
      L.push("质数口径（官方走势图惯例，1 计入质数）：" + PRIMES.filter((p) => p <= cfg.fn).map(pad2).join(" "));
      L.push("近 " + ts.D + " 期质合比分布：" + distLine(ts.primeDist, ts.D, (i) => i + ":" + (cfg.fk - i)));
      L.push("预测下期质合比：" + form.prime + ":" + (cfg.fk - form.prime) + "（出现最多）");
      out.sections.push({ title: "第三节 · 质合形态", lines: L, cand: null, why: "形态维度：质合" });
    }
    /* ---- 第四节 · 大小与区间 ---- */
    {
      const L = [];
      L.push("近 " + ts.D + " 期大小比分布：" + distLine(ts.lowDist, ts.D, (i) => i + ":" + (cfg.fk - i)) + "（小号 1–" + Math.floor(cfg.fn / 2) + "）");
      L.push("三区划分：1–" + cfg.zones[0] + " / " + (cfg.zones[0] + 1) + "–" + cfg.zones[1] + " / " + (cfg.zones[1] + 1) + "–" + cfg.fn +
        "，近 " + ts.D + " 期各区场均 " + ts.zoneMean.map((z) => z.toFixed(2)).join(" / ") + " 个");
      L.push("预测下期区间比：" + form.zoneCounts.join(":") + "，大小比 " + form.low + ":" + (cfg.fk - form.low));
      out.sections.push({ title: "第四节 · 大小与区间", lines: L, cand: null, why: "形态维度：大小/区间" });
    }
    /* ---- 第五节 · 走势图模式 ---- */
    {
      const L = [];
      const cycle = cfg.fn / cfg.fk;
      L.push("重号（与上期相同）：近 " + (ts.D - 1) + " 期场均 " + mean(ts.repeats).toFixed(2) + " 个（独立随机期望 " + (cfg.fk * cfg.fk / cfg.fn).toFixed(2) + "），模式 " + form.repeat + " 个");
      L.push("邻号（上期号 ±1）：场均 " + mean(ts.neighbors).toFixed(2) + " 个；斜跳（±2）：场均 " + mean(ts.jumps).toFixed(2) + " 个");
      L.push("上期开：" + fmtArr(draws[draws.length - 1].nums.slice(0, cfg.fk)) + "，预测下期含重号 " + form.repeat + " 个、邻号 " + form.neighbor + " 个");
      L.push("⚠ 重号/邻号出现频率≈随机水平，无预测力，仅作选号结构参考");
      out.sections.push({ title: "第五节 · 走势图模式（重号 / 邻号 / 斜跳）", lines: L, cand: null, why: "形态维度：走势模式" });
    }
    /* ---- 第六节 · 冷热与遗漏 ---- */
    {
      const L = [];
      const cycle = cfg.fn / cfg.fk;
      const hot = [];
      for (let i = 1; i <= cfg.fn; i++) hot.push(i);
      hot.sort((a, b) => ts.fc[b] - ts.fc[a] || a - b);
      L.push("热号（近 50 期出现最多）：" + hot.slice(0, cfg.fk + 2).map(pad2).join(" ") + "（各 " + ts.fc[hot[0]] + " 次）");
      const cold = hot.slice().reverse().filter((i) => ts.fc[i] <= 1);
      L.push("冷号（出现 ≤1 次）：" + (cold.length ? cold.map(pad2).join(" ") : "无") + "；理论出现周期约 " + cycle.toFixed(1) + " 期");
      const due = [];
      for (let i = 1; i <= cfg.fn; i++) if (ts.fom[i] >= Math.ceil(cycle * 1.8)) due.push(pad2(i) + "(遗漏" + ts.fom[i] + ")");
      L.push("超期回补候选（遗漏 ≥1.8×周期）：" + (due.length ? due.join(" ") : "无"));
      L.push("⚠ 冷热与遗漏无预测力，仅供结构参考");
      out.sections.push({ title: "第六节 · 冷热与遗漏（近 50 期）", lines: L, cand: null, why: "形态维度：冷热/遗漏" });
    }

    /* ---- 合成：形态约束 + 四种评分视角 ---- */
    const cycle = cfg.fn / cfg.fk;
    const maxFc = Math.max.apply(null, ts.fc.slice(1).concat([1]));
    const scoreMain = new Array(cfg.fn + 1).fill(0);
    const scoreHot = new Array(cfg.fn + 1).fill(0);
    const scoreDue = new Array(cfg.fn + 1).fill(0);
    const scoreBal = new Array(cfg.fn + 1).fill(0);
    for (let i = 1; i <= cfg.fn; i++) {
      const sFreq = ts.fc[i] / maxFc;
      const sDue = Math.min(1.5, ts.fom[i] / cycle) / 1.5;
      const rep = form.repeat >= 1 ? (ts.prevF.has(i) ? 1 : 0) : (ts.prevF.has(i) ? -0.4 : 0);
      const nb = (ts.prevF.has(i - 1) || ts.prevF.has(i + 1)) ? (form.neighbor >= 1 ? 1 : -0.2) : 0;
      scoreMain[i] = 0.35 * sFreq + 0.35 * sDue + 0.15 * rep + 0.15 * nb;
      scoreHot[i] = sFreq;
      scoreDue[i] = sDue;
      scoreBal[i] = 0.5 * sFreq + 0.5 * sDue;
    }
    const bScoreMain = new Array(cfg.bn + 1).fill(0);
    const bScoreHot = new Array(cfg.bn + 1).fill(0);
    const bScoreDue = new Array(cfg.bn + 1).fill(0);
    const bScoreBal = new Array(cfg.bn + 1).fill(0);
    const bMax = Math.max.apply(null, ts.bc.slice(1).concat([1]));
    const bCycle = cfg.bn / cfg.bk;
    for (let i = 1; i <= cfg.bn; i++) {
      const sFreq = ts.bc[i] / bMax;
      const sDue = Math.min(1.5, ts.bom[i] / bCycle) / 1.5;
      bScoreMain[i] = 0.5 * sFreq + 0.5 * sDue;
      bScoreHot[i] = sFreq;
      bScoreDue[i] = sDue;
      bScoreBal[i] = 0.5 * sFreq + 0.5 * sDue;
    }
    const fMain = pickForm(cfg, scoreMain, form);
    const bMain = pickBack(cfg, bScoreMain, form);
    out.final = { f: fMain, b: bMain };

    const rs = mulberry32(20261108);
    const fRand = [];
    const poolR = [];
    for (let i = 1; i <= cfg.fn; i++) poolR.push(i);
    for (let k = 0; k < cfg.fk; k++) {
      const idx = Math.floor(rs() * poolR.length);
      fRand.push(poolR.splice(idx, 1)[0]);
    }
    const bRand = [];
    const poolB = [];
    for (let i = 1; i <= cfg.bn; i++) poolB.push(i);
    for (let k = 0; k < cfg.bk; k++) {
      const idx = Math.floor(rs() * poolB.length);
      bRand.push(poolB.splice(idx, 1)[0]);
    }

    out.sets = [
      { tag: "主推 · 形态合成", f: fMain, b: bMain },
      { tag: "热号 · 形态内取热", f: pickForm(cfg, scoreHot, form), b: pickBack(cfg, bScoreHot, form) },
      { tag: "回补 · 形态内取遗漏", f: pickForm(cfg, scoreDue, form), b: pickBack(cfg, bScoreDue, form) },
      { tag: "均衡 · 热度遗漏各半", f: pickForm(cfg, scoreBal, form), b: pickBack(cfg, bScoreBal, form) },
      { tag: "随机对照 · 纯随机", f: fRand.sort((a, b) => a - b), b: bRand.sort((a, b) => a - b) },
    ];

    const seen = new Set();
    for (const s of out.sets) {
      let k2 = fmtS(new Set(s.f)) + "|" + fmtS(new Set(s.b));
      let guard = 0;
      while (seen.has(k2) && guard < 8) {
        guard++;
        const alt = pickForm(cfg, scoreMain.map((v, i2) => v + rs() * 0.08), form);
        if (fmtS(new Set(alt)) !== fmtS(new Set(s.f))) { s.f = alt.sort((a, b) => a - b); }
        k2 = fmtS(new Set(s.f)) + "|" + fmtS(new Set(s.b));
      }
      seen.add(k2);
    }

    out.sections.push({
      title: "第七节 · 形态合成推荐",
      lines: [
        "预测形态：奇偶 " + form.odd + ":" + (cfg.fk - form.odd) + " · 质合 " + form.prime + ":" + (cfg.fk - form.prime) +
          " · 大小 " + form.low + ":" + (cfg.fk - form.low) + " · 区间 " + form.zoneCounts.join(":") + " · 和值 " + form.sum[0] + "–" + form.sum[1],
        "走势结构：含重号 " + form.repeat + " 个、邻号 " + form.neighbor + " 个",
        "合成方法：满足上述形态约束下，分别按「综合 / 热号 / 回补 / 均衡」四种评分取最优组合，另附纯随机对照",
        "⚠ 所有推荐均为统计整理输出，与随机对照的中奖概率完全相同",
      ],
      cand: { f: new Set(fMain), b: new Set(bMain) },
      why: "形态约束 + 多视角评分合成",
    });

    out.ms = Date.now() - t0;
    out.gd = { fc: ts.fc, bc: ts.bc, fom: ts.fom, bom: ts.bom, window: ts.D };
    return out;
  }

  global.Engine = { GAMES, WINDOW, analyzeGame, pad2, fmtArr, fmtS, pct };
  Object.defineProperty(global, "DATA", {
    get() { return DATA; },
    set(v) { DATA = v; },
    configurable: true,
  });
})(window);
