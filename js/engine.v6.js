/* engine.v6.js — 数字彩推荐引擎 v6（参考开源思路：zxz0119/lottery-ai-simulator、snjyor/lucky_ball）
   彩种：双色球 / 大乐透 / 快乐8 / 福彩3D / 排列五，统一「近 50 期走势形态」框架：
   · 选号型（双色球/大乐透/快乐8）：和值·奇偶·质合·大小·区间·012路·重号邻号斜跳·冷热遗漏 → 形态约束合成
   · 数字型（3D/排列五）：各位走势·和值·跨度·奇偶大小·012路·（3D）组选形态 → 约束合成
   郑重声明：开奖为独立随机事件，任何分析都不能提高中奖概率，本引擎仅做统计整理。 */
(function (global) {
  "use strict";

  const GAMES = {
    ssq: { key: "ssq", name: "双色球", full: "双色球", type: "pick", fn: 33, fk: 6, draw: 6, bn: 16, bk: 1, zones: [11, 22], zoneNames: ["一区", "二区", "三区"] },
    dlt: { key: "dlt", name: "大乐透", full: "超级大乐透", type: "pick", fn: 35, fk: 5, draw: 5, bn: 12, bk: 2, zones: [12, 24], zoneNames: ["一区", "二区", "三区"] },
    kl8: { key: "kl8", name: "快乐8", full: "快乐8（选十）", type: "pick", fn: 80, fk: 10, draw: 20, bn: 0, bk: 0, zones: [20, 40, 60], zoneNames: ["一区", "二区", "三区", "四区"], zone4: true },
    fc3d: { key: "fc3d", name: "福彩3D", full: "福彩3D", type: "digits", pos: 3, max: 9, posNames: ["百位", "十位", "个位"] },
    p5: { key: "p5", name: "排列五", full: "排列5", type: "digits", pos: 5, max: 9, posNames: ["万位", "千位", "百位", "十位", "个位"] },
  };
  const WINDOW = 50;
  const PRIMES = [1, 2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79];

  var DATA = null;

  const mulberry32 = (a) => function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const pad2 = (n) => String(n).padStart(2, "0");
  const fmtS = (set) => [...set].sort((a, b) => a - b).map(pad2).join(" ");
  const fmtArr = (a) => a.slice().sort((x, y) => x - y).map(pad2).join(" ");
  const isPrime = (n) => PRIMES.indexOf(n) >= 0;
  const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  const sdOf = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length || 1)); };

  /* ---------- 选号型：通用统计 ---------- */
  function buildPickStats(cfg, draws) {
    const D = draws.length;
    const fSets = draws.map((d) => new Set(d.nums.slice(0, cfg.draw)));
    const bSets = cfg.bk ? draws.map((d) => new Set(d.nums.slice(cfg.draw))) : [];
    const fc = new Array(cfg.fn + 1).fill(0);
    const fom = new Array(cfg.fn + 1).fill(D);
    for (let t = D - 1; t >= 0; t--) for (const x of fSets[t]) { fc[x]++; if (fom[x] === D) fom[x] = D - 1 - t; }
    let bc = null, bom = null;
    if (cfg.bk) {
      bc = new Array(cfg.bn + 1).fill(0); bom = new Array(cfg.bn + 1).fill(D);
      for (let t = D - 1; t >= 0; t--) for (const x of bSets[t]) { bc[x]++; if (bom[x] === D) bom[x] = D - 1 - t; }
    }
    const sums = draws.map((d) => d.nums.slice(0, cfg.draw).reduce((a, b) => a + b, 0));
    const half = Math.floor(cfg.fn / 2);
    const dist = (fn2, f) => { const a = new Array(fn2 + 1).fill(0); draws.forEach((d) => { const nums = d.nums.slice(0, cfg.draw); a[f(nums)]++; }); return a; };
    const oddDist = dist(cfg.fk, (f) => f.filter((x) => x % 2 === 1).length);
    const primeDist = dist(cfg.fk, (f) => f.filter((x) => isPrime(x)).length);
    const lowDist = dist(cfg.fk, (f) => f.filter((x) => x <= half).length);
    const road012 = dist(cfg.fk, (f) => f.filter((x) => x % 3 === 0).length); // 0路个数分布
    const nZones = cfg.zone4 ? 4 : 3;
    const zEdge = cfg.zone4 ? [20, 40, 60] : cfg.zones;
    const zoneMean = new Array(nZones).fill(0);
    draws.forEach((d) => { const f = d.nums.slice(0, cfg.fk); const zc = new Array(nZones).fill(0);
      f.forEach((x) => { for (let z = 0; z < nZones; z++) { if (x <= (z === nZones - 1 ? cfg.fn : zEdge[z])) { zc[z]++; break; } } });
      for (let z = 0; z < nZones; z++) zoneMean[z] += zc[z] / D; });
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
    let bOddDist = null, bRepeats = null, prevB = null;
    if (cfg.bk) {
      bOddDist = new Array(cfg.bk + 1).fill(0);
      bSets.forEach((s) => bOddDist[[...s].filter((x) => x % 2 === 1).length]++);
      bRepeats = [];
      for (let t = 1; t < D; t++) { let r = 0; for (const x of bSets[t]) if (bSets[t - 1].has(x)) r++; bRepeats.push(r); }
      prevB = bSets[D - 1];
    }
    return { D, fSets, bSets, fc, fom, bc, bom, sums, half, oddDist, primeDist, lowDist, roadDist: road012,
      nZones, zoneMean, zEdge, repeats, neighbors, jumps, bOddDist, bRepeats, prevF: fSets[D - 1], prevB };
  }

  const modeOf = (d2) => { let m = 0; for (let i = 1; i < d2.length; i++) if (d2[i] > d2[m]) m = i; return m; };
  const distLine = (d2, total, lf) => { const o = []; for (let i = 0; i < d2.length; i++) if (d2[i] > 0) o.push(lf(i) + " " + d2[i] + "次(" + Math.round(d2[i] / total * 100) + "%)"); return o.join(" | "); };

  function pickForm(cfg, scoreArr, form) {
    const order = [];
    for (let i = 1; i <= cfg.fn; i++) order.push(i);
    order.sort((a, b) => scoreArr[b] - scoreArr[a]);
    const pool = order.slice(0, Math.min(22, cfg.fn));
    let states = [{ picked: [], odd: 0, pr: 0, low: 0, zn: new Array(form.zoneCounts.length).fill(0), sum: 0, score: 0 }];
    for (let depth = 0; depth < cfg.fk; depth++) {
      const next = [];
      for (const st of states) {
        for (const i of pool) {
          if (st.picked.indexOf(i) >= 0) continue;
          const R = cfg.fk - depth - 1;
          const minRest = R * (R + 1) / 2;
          const maxRest = (cfg.fn - R + 1 + cfg.fn) * R / 2;
          const ns = st.sum + i;
          if (ns + minRest > form.sum[1] + Math.round(form.sd * 0.5) + 12) continue;
          if (ns + maxRest < form.sum[0] - Math.round(form.sd * 0.5) - 12) continue;
          const zc = st.zn.slice();
          for (let z = 0; z < zc.length; z++) { if (i <= (z === zc.length - 1 ? cfg.fn : form.zEdge[z])) { zc[z]++; break; } }
          next.push({ picked: st.picked.concat([i]), odd: st.odd + (i % 2 === 1 ? 1 : 0), pr: st.pr + (isPrime(i) ? 1 : 0),
            low: st.low + (i <= cfg.fn / 2 ? 1 : 0), zn: zc, sum: ns, score: st.score + scoreArr[i] });
        }
      }
      next.sort((a, b) => b.score - a.score);
      states = next.slice(0, 90);
      if (!states.length) break;
    }
    if (!states.length) return order.slice(0, cfg.fk).sort((a, b) => a - b);
    function q(s) {
      let pen = 0;
      pen += Math.abs(s.odd - form.odd) * 1.0;
      pen += Math.abs(s.pr - form.prime) * 0.7;
      pen += Math.abs(s.low - form.low) * 0.7;
      for (let z = 0; z < s.zn.length; z++) pen += Math.abs(s.zn[z] - form.zoneCounts[z]) * 0.5;
      if (s.sum < form.sum[0]) pen += (form.sum[0] - s.sum) * 0.06;
      if (s.sum > form.sum[1]) pen += (s.sum - form.sum[1]) * 0.06;
      return -pen;
    }
    states.sort((a, b) => (q(b) + b.score * 0.12) - (q(a) + a.score * 0.12));
    return states[0].picked.sort((a, b) => a - b);
  }

  function pickBack(cfg, scoreArr, form) {
    const order = [];
    for (let i = 1; i <= cfg.bn; i++) order.push(i);
    order.sort((a, b) => scoreArr[b] - scoreArr[a]);
    if (cfg.bk === 1) {
      const hit = order.find((i) => (i % 2 === 1 ? 1 : 0) === form.bOdd);
      return [hit != null ? hit : order[0]];
    }
    for (let i = 0; i < order.length; i++)
      for (let j = i + 1; j < order.length; j++)
        if ((order[i] % 2 === 1 ? 1 : 0) + (order[j] % 2 === 1 ? 1 : 0) === form.bOdd)
          return [order[i], order[j]].sort((a, b) => a - b);
    return order.slice(0, 2).sort((a, b) => a - b);
  }

  function analyzePick(key) {
    const cfg = GAMES[key];
    const half = Math.floor(cfg.fn / 2);
    const ratio = cfg.fk / cfg.draw; // 开奖口径 → 选号口径换算（双色球/大乐透 =1）
    const all = DATA[key];
    if (!all || all.length < 30) throw new Error(cfg.name + " 历史数据不足 30 期");
    const draws = all.slice(-WINDOW);
    const ts = buildPickStats(cfg, draws);
    const cycle = cfg.fn / cfg.draw;
    const odd = Math.round(modeOf(ts.oddDist) * ratio);
    const prime = Math.round(modeOf(ts.primeDist) * ratio);
    const low = Math.round(modeOf(ts.lowDist) * ratio);
    const avg50 = mean(ts.sums), avg10 = mean(ts.sums.slice(-10)), sd = sdOf(ts.sums);
    const center = 0.65 * avg10 + 0.35 * avg50;
    const bh = Math.max(4, Math.round(sd * 0.8 * ratio));
    const sum = [Math.max(cfg.fk, Math.round(center * ratio - bh)), Math.min(cfg.fk * cfg.fn, Math.round(center * ratio + bh))];
    const repeat = Math.min(3, Math.round(mean(ts.repeats) * ratio));
    const neighbor = Math.min(3, Math.round(mean(ts.neighbors) * ratio));
    const zoneCounts = ts.zoneMean.map((z) => Math.round(z * ratio));
    const bOdd = ts.bOddDist ? modeOf(ts.bOddDist) : 0;
    const form = { odd, prime, low, sum, repeat, neighbor, zoneCounts, bOdd, sd, zEdge: ts.zEdge };
    const out = {
      name: cfg.name,
      upto: { issue: draws[draws.length - 1].issue, date: String(draws[draws.length - 1].date).slice(0, 10), count: draws.length, stock: all.length },
      sections: [],
      form: { odd: odd + ":" + (cfg.fk - odd), prime: prime + ":" + (cfg.fk - prime), low: low + ":" + (cfg.fk - low),
        zone: zoneCounts.join(":"), sum: sum, repeat: repeat, neighbor: neighbor },
    };
    const t0 = Date.now();

    out.sections.push({ title: "第一节 · 和值分析（近 50 期）", lines: [
      "近 " + ts.D + " 期和值：均值 " + avg50.toFixed(1) + "，最大 " + Math.max.apply(null, ts.sums) + "，最小 " + Math.min.apply(null, ts.sums) + "，σ=" + sd.toFixed(1),
      "近 10 期均值 " + avg10.toFixed(1) + (form.trendMark = (avg10 >= avg50 ? "（走势偏大）" : "（走势偏小）")),
      "预测下期和值带：[" + sum[0] + " ~ " + sum[1] + "]",
      "⚠ 和值无预测力，仅供约束选号",
    ], cand: null, why: "形态维度：和值" });
    out.sections.push({ title: "第二节 · 奇偶形态", lines: [
      "近 " + ts.D + " 期奇偶比分布：" + distLine(ts.oddDist, ts.D, (i) => i + ":" + (cfg.fk - i)),
      "预测下期奇偶比：" + form.odd + ":" + (cfg.fk - form.odd),
    ], cand: null, why: "形态维度：奇偶" });
    out.sections.push({ title: "第三节 · 质合形态", lines: [
      "质数口径（1 计入质数）：" + PRIMES.filter((p) => p <= cfg.fn).map(pad2).join(" "),
      "近 " + ts.D + " 期质合比分布：" + distLine(ts.primeDist, ts.D, (i) => i + ":" + (cfg.fk - i)),
      "预测下期质合比：" + form.prime + ":" + (cfg.fk - form.prime),
    ], cand: null, why: "形态维度：质合" });
    out.sections.push({ title: "第四节 · 大小 · 区间 · 012路", lines: [
      "大小比分布：" + distLine(ts.lowDist, ts.D, (i) => i + ":" + (cfg.fk - i)) + "（小 1–" + half + "）→ 预测 " + form.low + ":" + (cfg.fk - form.low),
      cfg.zoneNames.join("/") + " 场均个数：" + ts.zoneMean.map((z) => z.toFixed(2)).join(" / ") + " → 预测区间比 " + zoneCounts.join(":"),
      "0路(3的倍数)个数分布：" + distLine(ts.roadDist, ts.D, (i) => i + "个") + " → 参考 " + modeOf(ts.roadDist) + " 个",
    ], cand: null, why: "形态维度：大小/区间/012路" });
    out.sections.push({ title: "第五节 · 走势图模式（重号 / 邻号 / 斜跳）", lines: [
      "重号：场均 " + mean(ts.repeats).toFixed(2) + "（随机期望 " + (cfg.fk * cfg.draw / cfg.fn).toFixed(2) + "），模式 " + form.repeat + " 个",
      "邻号（±1）：场均 " + mean(ts.neighbors).toFixed(2) + "；斜跳（±2）：场均 " + mean(ts.jumps).toFixed(2),
      "上期开：" + fmtArr(draws[draws.length - 1].nums.slice(0, cfg.fk)) + " → 预测含重号 " + form.repeat + " / 邻号 " + form.neighbor,
      "⚠ 重号/邻号频率≈随机水平，无预测力",
    ], cand: null, why: "形态维度：走势模式" });
    {
      const hot = [];
      for (let i = 1; i <= cfg.fn; i++) hot.push(i);
      hot.sort((a, b) => ts.fc[b] - ts.fc[a] || a - b);
      const cold = hot.slice().reverse().filter((i) => ts.fc[i] <= Math.max(1, Math.round(cycle * 0.4)));
      const due = [];
      for (let i = 1; i <= cfg.fn; i++) if (ts.fom[i] >= Math.ceil(cycle * 1.8)) due.push(pad2(i) + "(遗漏" + ts.fom[i] + ")");
      out.sections.push({ title: "第六节 · 冷热与遗漏（近 50 期）", lines: [
        "热号：" + hot.slice(0, cfg.fk + 2).map(pad2).join(" ") + "（各 " + ts.fc[hot[0]] + " 次；理论周期 " + cycle.toFixed(1) + " 期）",
        "冷号（出现≤" + Math.max(1, Math.round(cycle * 0.4)) + " 次）：" + (cold.length ? cold.map(pad2).join(" ") : "无"),
        "超期回补候选（遗漏≥1.8×周期）：" + (due.length ? due.join(" ") : "无"),
        "⚠ 冷热与遗漏无预测力",
      ], cand: null, why: "形态维度：冷热/遗漏" });
    }

    const maxFc = Math.max.apply(null, ts.fc.slice(1).concat([1]));
    const mkScores = () => {
      const sMain = new Array(cfg.fn + 1).fill(0), sHot = new Array(cfg.fn + 1).fill(0),
        sDue = new Array(cfg.fn + 1).fill(0), sBal = new Array(cfg.fn + 1).fill(0);
      for (let i = 1; i <= cfg.fn; i++) {
        const sFreq = ts.fc[i] / maxFc;
        const sDueI = Math.min(1.5, ts.fom[i] / cycle) / 1.5;
        const rep = form.repeat >= 1 ? (ts.prevF.has(i) ? 1 : 0) : (ts.prevF.has(i) ? -0.4 : 0);
        const nb = (ts.prevF.has(i - 1) || ts.prevF.has(i + 1)) ? (form.neighbor >= 1 ? 1 : -0.2) : 0;
        sMain[i] = 0.35 * sFreq + 0.35 * sDueI + 0.15 * rep + 0.15 * nb;
        sHot[i] = sFreq; sDue[i] = sDueI; sBal[i] = 0.5 * sFreq + 0.5 * sDueI;
      }
      return [sMain, sHot, sDue, sBal];
    };
    const [sMain, sHot, sDue, sBal] = mkScores();
    const fMain = pickForm(cfg, sMain, form);
    let bMain = null;
    if (cfg.bk) {
      const bMax = Math.max.apply(null, ts.bc.slice(1).concat([1]));
      const bCycle = cfg.bn / cfg.bk;
      const mkB = () => { const a = new Array(cfg.bn + 1).fill(0);
        for (let i = 1; i <= cfg.bn; i++) { const sF = ts.bc[i] / bMax; const sD = Math.min(1.5, ts.bom[i] / bCycle) / 1.5;
          a[i] = 0.5 * sF + 0.5 * sD; }
        return a; };
      const bMainArr = mkB();
      bMain = pickBack(cfg, bMainArr, form);
    }
    out.final = { f: fMain, b: bMain };

    const rs = mulberry32(20261109);
    const randSet = (n, k) => { const pool = []; for (let i = 1; i <= n; i++) pool.push(i);
      for (let j = 0; j < k; j++) { const idx = Math.floor(rs() * (pool.length - j)) + j; const tmp = pool[j]; pool[j] = pool[idx]; pool[idx] = tmp; }
      return pool.slice(0, k).sort((a, b) => a - b); };
    const variants = [
      { tag: "主推 · 形态合成", f: fMain, b: bMain },
      { tag: "热号 · 形态内取热", f: pickForm(cfg, sHot, form), b: cfg.bk ? pickBack(cfg, (() => { const bMax = Math.max.apply(null, ts.bc.slice(1).concat([1])); const a = new Array(cfg.bn + 1).fill(0); for (let i = 1; i <= cfg.bn; i++) a[i] = ts.bc[i] / bMax; return a; })(), form) : null },
      { tag: "回补 · 形态内取遗漏", f: pickForm(cfg, sDue, form), b: cfg.bk ? pickBack(cfg, (() => { const bCycle = cfg.bn / cfg.bk; const a = new Array(cfg.bn + 1).fill(0); for (let i = 1; i <= cfg.bn; i++) a[i] = Math.min(1.5, ts.bom[i] / bCycle) / 1.5; return a; })(), form) : null },
      { tag: "均衡 · 热度遗漏各半", f: pickForm(cfg, sBal, form), b: cfg.bk ? pickBack(cfg, (() => { const bMax = Math.max.apply(null, ts.bc.slice(1).concat([1])); const bCycle = cfg.bn / cfg.bk; const a = new Array(cfg.bn + 1).fill(0); for (let i = 1; i <= cfg.bn; i++) a[i] = 0.5 * ts.bc[i] / bMax + 0.5 * Math.min(1.5, ts.bom[i] / bCycle) / 1.5; return a; })(), form) : null },
      { tag: "随机对照 · 纯随机", f: randSet(cfg.fn, cfg.fk), b: cfg.bk ? randSet(cfg.bn, cfg.bk) : null },
    ];
    out.sets = variants.filter((s) => s.f && s.f.length === cfg.fk && (!cfg.bk || (s.b && s.b.length === cfg.bk)));
    const seen = new Set();
    for (const s of out.sets) {
      let k2 = fmtS(new Set(s.f)) + "|" + (s.b ? fmtS(new Set(s.b)) : "");
      let guard = 0;
      while (seen.has(k2) && guard < 8) {
        guard++;
        const alt = pickForm(cfg, sMain.map((v, i2) => v + rs() * 0.08), form);
        if (fmtS(new Set(alt)) !== fmtS(new Set(s.f))) s.f = alt;
        k2 = fmtS(new Set(s.f)) + "|" + (s.b ? fmtS(new Set(s.b)) : "");
      }
      seen.add(k2);
    }

    out.sections.push({ title: "第七节 · 形态合成推荐", lines: [
      "预测形态：奇偶 " + form.odd + ":" + (cfg.fk - form.odd) + " · 质合 " + form.prime + ":" + (cfg.fk - form.prime) +
        " · 大小 " + form.low + ":" + (cfg.fk - form.low) + " · 区间 " + zoneCounts.join(":") + " · 和值 " + sum[0] + "–" + sum[1],
      "走势结构：含重号 " + form.repeat + " 个、邻号 " + form.neighbor + " 个",
      "合成方法：形态约束下按「综合 / 热号 / 回补 / 均衡」四种评分取最优组合，另附纯随机对照",
      "⚠ 所有推荐均为统计整理输出，与随机对照的中奖概率完全相同",
    ], cand: { f: new Set(fMain), b: cfg.bk ? new Set(bMain) : new Set() }, why: "形态约束 + 多视角评分合成" });
    out.ms = Date.now() - t0;
    out.gd = { fc: ts.fc, fom: ts.fom, window: ts.D };
    return out;
  }

  /* ---------- 数字型：3D / 排列五 ---------- */
  function buildDigitStats(cfg, draws) {
    const D = draws.length;
    const P = cfg.pos;
    const freq = [], fom = [];
    for (let p = 0; p < P; p++) {
      const f = new Array(10).fill(0), m = new Array(10).fill(D);
      for (let t = D - 1; t >= 0; t--) { const d2 = draws[t].nums[p]; f[d2]++; if (m[d2] === D) m[d2] = D - 1 - t; }
      freq.push(f); fom.push(m);
    }
    const sums = draws.map((d) => d.nums.reduce((a, b) => a + b, 0));
    const spans = draws.map((d) => Math.max.apply(null, d.nums) - Math.min.apply(null, d.nums));
    const oddDist = new Array(P + 1).fill(0);
    const bigDist = new Array(P + 1).fill(0);
    const roadDist = new Array(P + 1).fill(0); // 0路(3的倍数)个数
    draws.forEach((d) => {
      oddDist[d.nums.filter((x) => x % 2 === 1).length]++;
      bigDist[d.nums.filter((x) => x >= 5).length]++;
      roadDist[d.nums.filter((x) => x % 3 === 0).length]++;
    });
    let zu = null;
    if (P === 3) {
      zu = { bz: 0, zs: 0, zl: 0 };
      draws.forEach((d) => { const n = d.nums; const u = new Set(n).size;
        if (u === 1) zu.bz++; else if (u === 2) zu.zs++; else zu.zl++; });
    }
    return { D, freq, fom, sums, spans, oddDist, bigDist, roadDist, zu };
  }

  function analyzeDigits(key) {
    const cfg = GAMES[key];
    const all = DATA[key];
    if (!all || all.length < 30) throw new Error(cfg.name + " 历史数据不足 30 期");
    const draws = all.slice(-WINDOW);
    const ts = buildDigitStats(cfg, draws);
    const sumMax = cfg.pos * 9;
    const avg50 = mean(ts.sums), avg10 = mean(ts.sums.slice(-10)), sd = sdOf(ts.sums);
    const center = 0.65 * avg10 + 0.35 * avg50;
    const bh = Math.max(3, Math.round(sd * 0.8));
    const sumBand = [Math.max(0, Math.round(center - bh)), Math.min(sumMax, Math.round(center + bh))];
    const spanMode = modeOf(ts.spans);
    const oddMode = modeOf(ts.oddDist);
    const bigMode = modeOf(ts.bigDist);
    const out = {
      name: cfg.name,
      upto: { issue: draws[draws.length - 1].issue, date: String(draws[draws.length - 1].date).slice(0, 10), count: draws.length, stock: all.length },
      sections: [],
      form: { sum: sumBand, odd: oddMode, big: bigMode, span: spanMode },
    };
    const t0 = Date.now();
    out.sections.push({ title: "第一节 · 和值分析（近 50 期）", lines: [
      "近 " + ts.D + " 期和值：均值 " + avg50.toFixed(1) + "，σ=" + sd.toFixed(1) + "，范围 " + Math.min.apply(null, ts.sums) + "–" + Math.max.apply(null, ts.sums) + "（理论 0–" + sumMax + "）",
      "近 10 期均值 " + avg10.toFixed(1) + (avg10 >= avg50 ? "（走势偏大）" : "（走势偏小）"),
      "预测下期和值带：[" + sumBand[0] + " ~ " + sumBand[1] + "]",
      "⚠ 和值无预测力，仅供约束选号",
    ], cand: null, why: "形态维度：和值" });
    out.sections.push({ title: "第二节 · 奇偶与大小形态", lines: [
      "奇数个数分布：" + distLine(ts.oddDist, ts.D, (i) => i + "奇" + (cfg.pos - i) + "偶") + " → 预测 " + oddMode + " 奇",
      "大数(5-9)个数分布：" + distLine(ts.bigDist, ts.D, (i) => i + "大" + (cfg.pos - i) + "小") + " → 预测 " + bigMode + " 大",
    ], cand: null, why: "形态维度：奇偶/大小" });
    out.sections.push({ title: "第三节 · 012路（除3余数）", lines: [
      "0路(0,3,6,9)个数分布：" + distLine(ts.roadDist, ts.D, (i) => i + "个") + " → 参考 " + modeOf(ts.roadDist) + " 个",
      "012路是数字型经典维度：各位按除3余数统计走势",
    ], cand: null, why: "形态维度：012路" });
    {
      const L = ["跨度（最大-最小）分布：" + distLine(ts.spans, ts.D, (i) => "跨" + i) + " → 预测跨度 " + spanMode];
      if (ts.zu) L.push("组选形态（近 50 期）：组六 " + ts.zu.zl + " 次(" + Math.round(ts.zu.zl / ts.D * 100) + "%) · 组三 " + ts.zu.zs + " 次 · 豹子 " + ts.zu.bz + " 次 → 组六为常态");
      L.push("⚠ 跨度与组选形态无预测力，仅供约束选号");
      out.sections.push({ title: "第四节 · 跨度" + (ts.zu ? "与组选形态" : ""), lines: L, cand: null, why: "形态维度：跨度/组选" });
    }
    {
      const L = [];
      const cycle = 10;
      for (let p = 0; p < cfg.pos; p++) {
        const f = ts.freq[p];
        let topI = 0;
        for (let d2 = 1; d2 < 10; d2++) if (f[d2] > f[topI]) topI = d2;
        const due = [];
        for (let d2 = 0; d2 < 10; d2++) if (ts.fom[p][d2] >= 18) due.push(d2 + "(遗漏" + ts.fom[p][d2] + ")");
        L.push(cfg.posNames[p] + "：最热 " + topI + "（" + f[topI] + " 次）· 超期回补：" + (due.length ? due.join(" ") : "无"));
      }
      L.push("⚠ 各位冷热无预测力");
      out.sections.push({ title: "第五节 · 各位冷热与遗漏（近 50 期）", lines: L, cand: null, why: "形态维度：各位冷热" });
    }

    function digitScores(mode) {
      const s = [];
      for (let p = 0; p < cfg.pos; p++) {
        const a = new Array(10).fill(0);
        for (let d2 = 0; d2 < 10; d2++) {
          const sFreq = ts.freq[p][d2] / Math.max.apply(null, ts.freq[p].concat([1]));
          const sDueI = Math.min(1.5, ts.fom[p][d2] / 10) / 1.5;
          if (mode === "hot") a[d2] = sFreq;
          else if (mode === "due") a[d2] = sDueI;
          else if (mode === "bal") a[d2] = 0.5 * sFreq + 0.5 * sDueI;
          else a[d2] = 0.4 * sFreq + 0.35 * sDueI + 0.25 * (1 - Math.abs(d2 % 3 - modeOf(ts.roadDist)) / 3 * 0 + 0);
        }
        s.push(a);
      }
      return s;
    }
    function pickDigits(scoreArr) {
      // 贪心：和值带 + 奇偶/大小模式容差
      const target = { sum: [(sumBand[0] + sumBand[1]) / 2, (sumBand[1] - sumBand[0]) / 2 + 1], odd: oddMode, big: bigMode };
      const picked = [];
      for (let p = 0; p < cfg.pos; p++) {
        const ranked = [];
        for (let d2 = 0; d2 < 10; d2++) ranked.push(d2);
        ranked.sort((a, b) => scoreArr[p][b] - scoreArr[p][a]);
        const remaining = cfg.pos - p - 1;
        let chosen = null, bestPen = 1e9;
        for (const d2 of ranked) {
          if (picked.indexOf(d2) >= 0 && mode !== "strict") {
            // 数字型允许同位不同位重复；不同位允许相同数字（3D 直选允许重号）
          }
          const ns = picked.reduce((a, b) => a + b, 0) + d2;
          const minRest = remaining * 0, maxRest = remaining * 9;
          if (ns + minRest > sumBand[1] + 2 || ns + maxRest < sumBand[0] - 2) continue;
          const pen = Math.abs(ns - target.sum[0]) / (target.sum[1] + 1) * 0.5 - scoreArr[p][d2];
          if (pen < bestPen) { bestPen = pen; chosen = d2; }
        }
        if (chosen == null) {
          // 回退：取和值可达的最高分
          for (const d2 of ranked) { const ns = picked.reduce((a, b) => a + b, 0) + d2;
            if (ns <= sumBand[1] + 3) { chosen = d2; break; } }
          if (chosen == null) chosen = ranked[0];
        }
        picked.push(chosen);
      }
      return picked;
    }
    let mode = "main";
    function mk(modeName) {
      const sArr = digitScores(modeName);
      return pickDigits(sArr);
    }
    const fMain = mk("main");
    out.final = { f: fMain.slice(), b: null };
    const rs = mulberry32(20261109);
    const randDigits = () => { const a = []; for (let p = 0; p < cfg.pos; p++) a.push(Math.floor(rs() * 10)); return a; };
    out.sets = [
      { tag: "主推 · 形态合成直选", f: fMain.slice(), b: null },
      { tag: "热号 · 各位取热", f: mk("hot"), b: null },
      { tag: "回补 · 各位取遗漏", f: mk("due"), b: null },
      { tag: "均衡 · 热度遗漏各半", f: mk("bal"), b: null },
      { tag: "随机对照 · 纯随机", f: randDigits(), b: null },
    ];
    const seen = new Set();
    for (const s of out.sets) {
      let k2 = s.f.join("");
      let guard = 0;
      while (seen.has(k2) && guard < 8) { guard++; s.f = randDigits(); k2 = s.f.join(""); }
      seen.add(k2);
    }
    out.sections.push({ title: "第六节 · 形态合成推荐", lines: [
      "预测形态：和值 " + sumBand[0] + "–" + sumBand[1] + " · " + oddMode + " 奇" + (cfg.pos - oddMode) + "偶 · " + bigMode + " 大" + (cfg.pos - bigMode) + "小 · 跨度 " + spanMode + (ts.zu ? " · 组六为主" : ""),
      "合成方法：各位在「综合 / 热号 / 回补 / 均衡」四种评分下取最优数字，满足和值带约束；直选允许各位重号",
      "3D 提示：主推一注直选 + 对应组选（号码排序后即组选）；排列五同思路",
      "⚠ 所有推荐均为统计整理输出，与随机对照的中奖概率完全相同",
    ], cand: { f: new Set(fMain), b: null }, why: "形态约束 + 多视角评分合成" });
    out.ms = Date.now() - t0;
    out.digitStats = ts;
    return out;
  }

  function analyzeGame(key) {
    const cfg = GAMES[key];
    if (!cfg) throw new Error("未知彩种");
    return cfg.type === "digits" ? analyzeDigits(key) : analyzePick(key);
  }

  global.Engine = { GAMES, WINDOW, analyzeGame, pad2, fmtArr, fmtS, pct: (x, nd) => (x * 100).toFixed(nd === undefined ? 1 : nd) + "%" };
  Object.defineProperty(global, "DATA", {
    get() { return DATA; },
    set(v) { DATA = v; },
    configurable: true,
  });
})(window);
