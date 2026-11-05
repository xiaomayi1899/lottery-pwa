/* engine.js — 双彩 12 步概率模型引擎（移植自「双彩智投」桌面版/手机版，纯计算、无 DOM 依赖）
   与桌面版同构：相同的随机序列（mulberry32, SEED）与统计口径，两端口径与结果一致。
   数据格式：DATA[g] = [{issue, date, nums:[前区..., 后区...]}]（nums 已排序，前区在前） */
(function (global) {
  "use strict";

  const GAMES = {
    dlt: { name: "大乐透", full: "超级大乐透", fn: 35, fk: 5, bn: 12, bk: 2, price: 2,
      tiers: [[5,2,"一等奖",null],[5,1,"二等奖",null],[5,0,"三等奖",5000],[4,2,"三等奖",5000],
        [4,1,"四等奖",300],[4,0,"五等奖",150],[3,2,"五等奖",150],[3,1,"六等奖",15],[2,2,"六等奖",15],
        [3,0,"七等奖",5],[2,1,"七等奖",5],[1,2,"七等奖",5],[0,2,"七等奖",5]],
      jp: 10000000, se: 200000 },
    ssq: { name: "双色球", full: "双色球", fn: 33, fk: 6, bn: 16, bk: 1, price: 2,
      tiers: [[6,1,"一等奖",null],[6,0,"二等奖",null],[5,1,"三等奖",3000],[5,0,"四等奖",200],
        [4,1,"四等奖",200],[4,0,"五等奖",10],[3,1,"五等奖",10],
        [2,1,"六等奖",5],[1,1,"六等奖",5],[0,1,"六等奖",5]],
      jp: 10000000, se: 400000 },
  };
  const SEED = 20261019;
  const WINDOW = 100; // 分析窗口：只用最近 100 期

  var DATA = null; // 由 app.js 注入：{dlt:[...], ssq:[...]}

  function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);
    t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
  function comb(n,k){if(k<0||k>n)return 0;k=Math.min(k,n-k);let r=1;
    for(let i=1;i<=k;i++)r=r*(n-k+i)/i;return Math.round(r);}
  function hyperPmf(N,k,j){return comb(k,j)*comb(N-k,k-j)/comb(N,k);}
  function lgamma(x){const g=[76.18009172947146,-86.50532032941677,24.01409824083091,
    -1.231739572450155,0.1208650973866179e-2,-0.5395239384953e-5];
    let y=x,tmp=x+5.5;tmp-=(x+0.5)*Math.log(tmp);let ser=1.000000000190015;
    for(let j=0;j<6;j++){y+=1;ser+=g[j]/y;}
    return -tmp+Math.log(2.5066282746310005*ser/x);}
  function _gser(a,x){let ap=a,s=1/a,d=1/a;
    for(let i=0;i<600;i++){ap+=1;d*=x/ap;s+=d;
      if(Math.abs(d)<Math.abs(s)*1e-13)break;}
    return s*Math.exp(-x+a*Math.log(x)-lgamma(a));}
  function _gcf(a,x){let b=x+1-a,c=1e300,d=1/b,h=d;
    for(let i=1;i<600;i++){const an=-i*(i-a);b+=2;d=an*d+b;
      if(Math.abs(d)<1e-300)d=1e-300;
      c=b+an/c;if(Math.abs(c)<1e-300)c=1e-300;
      d=1/d;const de=d*c;h*=de;
      if(Math.abs(de-1)<1e-13)break;}
    return Math.exp(-x+a*Math.log(x)-lgamma(a))*h;}
  function gammaincc(a,x){if(!(a>0)||x<0)return NaN;if(x===0)return 1;
    return x<a+1?1-_gser(a,x):_gcf(a,x);}
  function chi2sf(x,df){return gammaincc(df/2,x/2);}
  function pad2(n){return String(n).padStart(2,"0");}
  function fmtS(set){return [...set].sort((a,b)=>a-b).map(pad2).join(" ");}
  function fmtArr(a){return a.slice().sort((x,y)=>x-y).map(pad2).join(" ");}
  function pct(x,nd){nd=(nd===undefined)?2:nd;return (x*100).toFixed(nd)+"%";}
  function oneIn(p){return p>0?("1 / "+Math.round(1/p).toLocaleString("en-US")):"-";}
  function topN(arr,N,key){const idx=[];
    for(let i=1;i<arr.length;i++)idx.push(i);
    idx.sort((a,b)=>(key(b)-key(a))||(a-b));return idx.slice(0,N);}
  function normal(rng){let u=0,v=0;while(u===0)u=rng();while(v===0)v=rng();
    return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}

  function makeGD(cfg,draws){
    const D=draws.length;
    const fSets=draws.map(d=>new Set(d.nums.slice(0,cfg.fk)));
    const bSets=draws.map(d=>new Set(d.nums.slice(cfg.fk)));
    const fc=new Array(cfg.fn+1).fill(0), bc=new Array(cfg.bn+1).fill(0);
    const fom=new Array(cfg.fn+1).fill(0), bom=new Array(cfg.bn+1).fill(0);
    for(let i=1;i<=cfg.fn;i++){let last=-1;
      for(let t=D-1;t>=0;t--)if(fSets[t].has(i)){last=t;break;}
      fom[i]=last>=0?D-1-last:D;
      for(const s of fSets)if(s.has(i))fc[i]++;}
    for(let i=1;i<=cfg.bn;i++){let last=-1;
      for(let t=D-1;t>=0;t--)if(bSets[t].has(i)){last=t;break;}
      bom[i]=last>=0?D-1-last:D;
      for(const s of bSets)if(s.has(i))bc[i]++;}
    const thetaF=[0],thetaB=[0],aF=[0],aB=[0],rF=[0],rB=[0];
    for(let i=1;i<=cfg.fn;i++){aF.push(1+fc[i]);
      thetaF.push((1+fc[i])/(cfg.fn+D*cfg.fk));rF.push(fc[i]/D);}
    for(let i=1;i<=cfg.bn;i++){aB.push(1+bc[i]);
      thetaB.push((1+bc[i])/(cfg.bn+D*cfg.bk));rB.push(bc[i]/D);}
    return {cfg,draws,D,fSets,bSets,fc,bc,fom,bom,thetaF,thetaB,aF,aB,rF,rB};
  }
  function buildTiers(gd){
    const c=gd.cfg;const pf=[],pb=[];
    for(let j=0;j<=c.fk;j++)pf.push(hyperPmf(c.fn,c.fk,j));
    for(let j=0;j<=c.bk;j++)pb.push(hyperPmf(c.bn,c.bk,j));
    const agg=new Map();let total=0;
    for(const t of c.tiers){
      const p=pf[t[0]]*pb[t[1]];
      const prize=(t[3]===null)?(t[2]==="一等奖"?c.jp:c.se):t[3];
      const a=agg.get(t[2])||[0,prize];a[0]+=p;agg.set(t[2],a);total+=p;}
    return {agg,miss:1-total,pf,pb};
  }
  function payoutMap(gd){const m=new Map();
    for(const t of gd.cfg.tiers){
      const prize=(t[3]===null)?(t[2]==="一等奖"?gd.cfg.jp:gd.cfg.se):t[3];
      m.set(t[0]+","+t[1],prize);}
    return m;}
  function winSet(gd){const s=new Set();
    for(const t of gd.cfg.tiers)s.add(t[0]+","+t[1]);return s;}
  function postDraw(alpha,k,rng){const w=alpha.slice(),out=[];
    for(let n=0;n<k;n++){let tot=0;
      for(const v of w)tot+=v;
      let x=rng()*tot,acc=0,pick=w.length-1;
      for(let i=0;i<w.length;i++){acc+=w[i];if(x<=acc){pick=i;break;}}
      out.push(pick);w[pick]=0;}
    return out;}
  function buildSim(gd,S,rng){
    const aF=gd.aF.slice(1),aB=gd.aB.slice(1),sF=[],sB=[];
    for(let i=0;i<S;i++){
      sF.push(new Set(postDraw(aF,gd.cfg.fk,rng).map(x=>x+1)));
      sB.push(new Set(postDraw(aB,gd.cfg.bk,rng).map(x=>x+1)));}
    return [sF,sB];}
  function candPool(gd,rng,nF,nB){
    nF=nF||240;nB=nB||40;
    const aF=gd.aF.slice(1),aB=gd.aB.slice(1),pf=[],pb=[];
    for(let i=0;i<nF;i++)pf.push(new Set(postDraw(aF,gd.cfg.fk,rng).map(x=>x+1)));
    for(let i=0;i<nB;i++)pb.push(new Set(postDraw(aB,gd.cfg.bk,rng).map(x=>x+1)));
    const tickets=[];
    for(let i=0;i<nF;i++)tickets.push([pf[i],pb[i%nB]]);
    tickets.push([new Set(topN(gd.thetaF,gd.cfg.fk,i=>gd.thetaF[i])),
                  new Set(topN(gd.thetaB,gd.cfg.bk,i=>gd.thetaB[i]))]);
    const seen=new Set(),uniq=[];
    for(const t of tickets){const k=fmtS(t[0])+"|"+fmtS(t[1]);
      if(!seen.has(k)){seen.add(k);uniq.push(t);}}
    return uniq;}

  function m1(gd){const c=gd.cfg;const L=[];
    const pf=comb(c.fn,c.fk)*comb(c.bn,c.bk);
    L.push("模型: 命中数服从超几何分布 P(X=j)=C(k,j)C(N-k,k-j)/C(N,k)");
    L.push("一等奖概率 = 1/(C("+c.fn+","+c.fk+")×C("+c.bn+","+c.bk+")) = 1/"+pf.toLocaleString("en-US"));
    let row=[];
    for(let j=0;j<=c.fk;j++)row.push("中"+j+"个 "+pct(hyperPmf(c.fn,c.fk,j)));
    L.push("前区命中分布: "+row.join(" | "));
    row=[];
    for(let j=0;j<=c.bk;j++)row.push("中"+j+"个 "+pct(hyperPmf(c.bn,c.bk,j)));
    L.push("后区命中分布: "+row.join(" | "));
    const tf=topN(gd.thetaF,c.fk,i=>gd.fc[i]),tb=topN(gd.thetaB,c.bk,i=>gd.bc[i]);
    return {lines:L,cand:{f:new Set(tf),b:new Set(tb)},why:"历史出现频次最高的组合(经验分布众数)"};}

  function m2(gd){const c=gd.cfg;const r=buildTiers(gd);const L=[];
    L.push("模型: 前后区命中独立,联合为多元超几何 P=P_f(i)×P_b(j)");
    L.push("奖级 | 单注概率 | 约合 | 奖金(元)");
    const names=["一等奖","二等奖","三等奖","四等奖","五等奖","六等奖","七等奖","八等奖","九等奖"];
    for(const nm of names){
      if(!r.agg.has(nm))continue;
      const a=r.agg.get(nm);
      L.push(nm+" | "+pct(a[0],6)+" | "+oneIn(a[0])+" | "+a[1].toLocaleString("en-US")+
        ((nm==="一等奖"||nm==="二等奖")?"(浮动≈)":""));}
    L.push("不中奖: "+pct(r.miss,4));
    let ev=0;for(const a of r.agg.values())ev+=a[0]*a[1];
    L.push("命中任意奖级概率 = "+pct(1-r.miss,4)+";单注期望奖金≈"+ev.toFixed(2)+"元");
    const th=gd.thetaF;const top=topN(th,12,i=>th[i]);
    const lo=c.fk*(c.fk+1)/2, hi=c.fk*(2*c.fn-c.fk+1)/2;
    const sL=lo+0.35*(hi-lo), sH=lo+0.65*(hi-lo);
    const oL=Math.ceil(c.fk*0.4), oH=Math.floor(c.fk*0.6);
    let best=null,bw=-1;
    (function rec(s,cur){
      if(cur.length===c.fk){
        const sm=cur.reduce((a,b)=>a+b,0);
        const odd=cur.filter(x=>x%2===1).length;
        const low=cur.filter(x=>x<=Math.floor(c.fn/2)).length;
        if(sm>=sL&&sm<=sH&&odd>=oL&&odd<=oH&&low>=Math.ceil(c.fk*0.4)&&low<=Math.floor(c.fk*0.6)){
          const w=cur.reduce((a,x)=>a+th[x],0);
          if(w>bw){bw=w;best=cur.slice();}}
        return;}
      for(let i=s;i<top.length;i++){cur.push(top[i]);rec(i+1,cur);cur.pop();}})(0,[]);
    const f=new Set(best||top.slice(0,c.fk));
    const tb=topN(gd.thetaB,6,i=>gd.thetaB[i]);
    let bb=null;
    if(c.bk===2){for(let i=0;i<tb.length&&!bb;i++)for(let j=i+1;j<tb.length&&!bb;j++)
      if((tb[i]+tb[j])%2===1)bb=[tb[i],tb[j]];}
    const b=new Set(c.bk===1?tb.slice(0,1):(bb||tb.slice(0,c.bk)));
    return {lines:L,cand:{f,b},why:"小奖覆盖导向: 奇偶/大小/和值中央带,后验权重最大"};}

  function m3(gd){const c=gd.cfg;const L=[];
    L.push("模型: Dirichlet(1,...,1) 先验 + 出现计数 → 共轭后验");
    const tf=topN(gd.thetaF,c.fk,i=>gd.thetaF[i]);
    for(const i of tf)
      L.push("前区 "+pad2(i)+": 出现"+gd.fc[i]+"次, 后验θ均值 "+(gd.thetaF[i]*100).toFixed(3)+"%");
    const tb=topN(gd.thetaB,c.bk,i=>gd.thetaB[i]);
    return {lines:L,cand:{f:new Set(tf),b:new Set(tb)},why:"贝叶斯后验均值最高的组合"};}

  function m4(gd){const c=gd.cfg;const L=[];
    L.push("模型: 后区多项-Dirichlet 共轭,后验可解析抽样");
    const tb=topN(gd.thetaB,c.bk+4,i=>gd.thetaB[i]);
    for(const i of tb)
      L.push("后区 "+pad2(i)+": 出现"+gd.bc[i]+"次, 后验θ均值 "+(gd.thetaB[i]*100).toFixed(3)+"%");
    const rng=mulberry32(SEED+4);
    const tf=postDraw(gd.aF.slice(1),c.fk,rng).map(x=>x+1);
    return {lines:L,cand:{f:new Set(tf),b:new Set(tb.slice(0,c.bk))},
      why:"前区 Thompson 式后验预测抽样 + 后区后验 Top"};}

  function m5(gd){const c=gd.cfg;const L=[];
    L.push("模型: 遗漏期数服从几何分布,生存函数 P(O≥m)=(1-p)^m");
    L.push("⚠ 赌徒谬误视角: 开奖独立,『该出了』并无统计效力,仅供对照");
    const rowsF=[];
    for(let i=1;i<=c.fn;i++)rowsF.push([Math.pow(1-gd.rF[i],gd.fom[i]),i]);
    rowsF.sort((a,b)=>a[0]-b[0]);
    const tf=rowsF.slice(0,c.fk).map(r=>r[1]);
    for(const r of rowsF.slice(0,c.fk))
      L.push("前区 "+pad2(r[1])+": 遗漏"+gd.fom[r[1]]+"期, 出现"+gd.fc[r[1]]+"次, P(O≥m)="+pct(r[0],1));
    const rowsB=[];
    for(let i=1;i<=c.bn;i++)rowsB.push([Math.pow(1-gd.rB[i],gd.bom[i]),i]);
    rowsB.sort((a,b)=>a[0]-b[0]);
    const tb=rowsB.slice(0,c.bk).map(r=>r[1]);
    return {lines:L,cand:{f:new Set(tf),b:new Set(tb)},why:"生存函数最小(遗漏回补,仅供对照)"};}

  function m6(gd){const c=gd.cfg;const L=[];
    L.push("模型: 卡方拟合优度 χ²=Σ(c-E)²/E,p 值由不完全 Gamma 求出");
    const stats={};
    for(const t of [["前区",gd.fc,c.fn,c.fk],["后区",gd.bc,c.bn,c.bk]]){
      const E=gd.D*t[3]/t[2];let chi=0;
      for(let i=1;i<=t[2];i++)chi+=Math.pow(t[1][i]-E,2)/E;
      const p=chi2sf(chi,t[2]-1);
      stats[t[0]]=[E,p,t[1]];
      L.push(t[0]+": χ²="+chi.toFixed(2)+", df="+(t[2]-1)+", p="+p.toFixed(4)+
        (p>0.05?" → 不能拒绝均匀性":" → 偏离均匀(0.05水平)"));}
    const Ef=stats["前区"][0], cf=stats["前区"][2];
    const Eb=stats["后区"][0], cb=stats["后区"][2];
    const tf=topN(gd.fc,c.fk,i=>(cf[i]-Ef)/Math.sqrt(Ef));
    const tb=topN(gd.bc,c.bk,i=>(cb[i]-Eb)/Math.sqrt(Eb));
    return {lines:L,cand:{f:new Set(tf),b:new Set(tb)},why:"标准化残差最大(相对均匀的超频号)"};}

  function m7(gd){const c=gd.cfg;const L=[];
    L.push("模型: 0/1 出现序列的两两皮尔逊相关 r;独立时 r≈0");
    function corr(sets,N){
      const cols=[];
      for(let i=1;i<=N;i++){const col=new Array(sets.length);
        for(let t=0;t<sets.length;t++)col[t]=sets[t].has(i)?1:0;cols.push(col);}
      const means=cols.map(col=>col.reduce((a,b)=>a+b,0)/col.length);
      const cen=cols.map((col,ci)=>col.map(v=>v-means[ci]));
      const norms=cen.map(c2=>Math.sqrt(c2.reduce((a,v)=>a+v*v,0)));
      const cm=new Map();let sAbs=0,np=0,best=[0,0,0];
      for(let a=0;a<N;a++)for(let b=a+1;b<N;b++){
        let dot=0;const ca=cen[a],cb=cen[b];
        for(let t=0;t<ca.length;t++)dot+=ca[t]*cb[t];
        const rr=norms[a]*norms[b]>0?dot/(norms[a]*norms[b]):0;
        cm.set((a+1)+"_"+(b+1),rr);sAbs+=Math.abs(rr);np++;
        if(Math.abs(rr)>Math.abs(best[0]))best=[rr,a+1,b+1];}
      return [cm,best,sAbs/np];}
    const rF2=corr(gd.fSets,c.fn), rB2=corr(gd.bSets,c.bn);
    L.push("前区平均|r|="+rF2[2].toFixed(4)+", 最强对 "+pad2(rF2[1][1])+"-"+pad2(rF2[1][2])+" r="+rF2[1][0].toFixed(3));
    L.push("后区平均|r|="+rB2[2].toFixed(4)+", 最强对 "+pad2(rB2[1][1])+"-"+pad2(rB2[1][2])+" r="+rB2[1][0].toFixed(3));
    const picked=[topN(gd.fc,1,i=>gd.fc[i])[0]];
    while(picked.length<c.fk){let bi=-1,bv=1e9;
      for(let i=1;i<=c.fn;i++){
        if(picked.includes(i))continue;
        let m=0;
        for(const j of picked){const a=Math.min(i,j),b=Math.max(i,j);m+=Math.abs(rF2[0].get(a+"_"+b));}
        m/=picked.length;
        if(m<bv-1e-12||(Math.abs(m-bv)<1e-12&&gd.fc[i]>gd.fc[bi])){bv=m;bi=i;}}
      picked.push(bi);}
    const pb2=[topN(gd.bc,1,i=>gd.bc[i])[0]];
    while(pb2.length<c.bk){let bi=-1,bv=1e9;
      for(let i=1;i<=c.bn;i++){
        if(pb2.includes(i))continue;
        let m=0;
        for(const j of pb2){const a=Math.min(i,j),b=Math.max(i,j);m+=Math.abs(rB2[0].get(a+"_"+b));}
        m/=picked.length;
        if(m<bv-1e-12||(Math.abs(m-bv)<1e-12&&gd.bc[i]>gd.bc[bi])){bv=m;bi=i;}}
      pb2.push(bi);}
    return {lines:L,cand:{f:new Set(picked),b:new Set(pb2)},why:"热号种子 + 最小平均|r|(最大分散)"};}

  function m8(gd){const c=gd.cfg;const L=[];
    L.push("模型: 以『上期是否出现』为状态的一步转移概率(Laplace 平滑)");
    function build(sets,N){
      const n11=new Array(N+1).fill(0),n10=new Array(N+1).fill(0),
            n01=new Array(N+1).fill(0),n00=new Array(N+1).fill(0);
      for(let t=1;t<sets.length;t++)for(let i=1;i<=N;i++){
        const a=sets[t-1].has(i)?1:0,b=sets[t].has(i)?1:0;
        if(a&&b)n11[i]++;else if(a)n10[i]++;else if(b)n01[i]++;else n00[i]++;}
      return {n11,n10,n01,n00};}
    const nf=build(gd.fSets,c.fn), nb=build(gd.bSets,c.bn);
    let s11=0,s10=0,s01=0,s00=0;
    for(let i=1;i<=c.fn;i++){s11+=nf.n11[i];s10+=nf.n10[i];s01+=nf.n01[i];s00+=nf.n00[i];}
    const g11=s11/(s11+s10), g01=s01/(s01+s00);
    L.push("前区整体: P(出现|上期出现)="+g11.toFixed(4)+" vs P(出现|上期未出)="+g01.toFixed(4));
    L.push("(几乎相等 → 无热手效应,链近似平稳)");
    const lastF=gd.fSets[gd.fSets.length-1], lastB=gd.bSets[gd.bSets.length-1];
    const orderF=[];
    for(let i=1;i<=c.fn;i++){
      const p=lastF.has(i)?((nf.n11[i]+1)/(nf.n11[i]+nf.n10[i]+2)):((nf.n01[i]+1)/(nf.n01[i]+nf.n00[i]+2));
      orderF.push([p,i]);}
    orderF.sort((a,b)=>b[0]-a[0]||a[1]-b[1]);
    const tf=orderF.slice(0,c.fk).map(r=>r[1]);
    for(const r of orderF.slice(0,c.fk))
      L.push("前区 "+pad2(r[1])+(lastF.has(r[1])?"(上期出现)":"(上期未出)")+": P≈"+r[0].toFixed(3));
    const orderB=[];
    for(let i=1;i<=c.bn;i++){
      const p=lastB.has(i)?((nb.n11[i]+1)/(nb.n11[i]+nb.n10[i]+2)):((nb.n01[i]+1)/(nb.n01[i]+nb.n00[i]+2));
      orderB.push([p,i]);}
    orderB.sort((a,b)=>b[0]-a[0]||a[1]-b[1]);
    const tb=orderB.slice(0,c.bk).map(r=>r[1]);
    return {lines:L,cand:{f:new Set(tf),b:new Set(tb)},why:"给定上期状态下最可能出现者"};}

  function m9(gd,simF,simB,pool){const L=[];const wins=winSet(gd);
    L.push("模型: 后验预测抽样 "+simF.length.toLocaleString("en-US")+" 期模拟未来开奖,选平均覆盖最优组合");
    let best=null,bs=-1,ba=0;
    for(const t of pool){const f=t[0],b=t[1];let acc=0,any=0;
      for(let s=0;s<simF.length;s++){
        let jf=0;for(const x of f)if(simF[s].has(x))jf++;
        let jb=0;for(const x of b)if(simB[s].has(x))jb++;
        acc+=jf+jb;if(wins.has(jf+","+jb))any++;}
      const sc=acc/simF.length;
      if(sc>bs){bs=sc;best=t;ba=any/simF.length;}}
    L.push("覆盖最优: 平均总命中 "+bs.toFixed(3)+" 个, 命中任意奖级频率 "+pct(ba));
    return {lines:L,cand:{f:best[0],b:best[1]},why:"模拟下的最大平均覆盖组合"};}

  function m10(gd){const c=gd.cfg;const r=buildTiers(gd);const L=[];
    let ev=0,e2=0;
    for(const t of c.tiers){
      const prize=(t[3]===null)?(t[2]==="一等奖"?c.jp:c.se):t[3];
      const p=r.pf[t[0]]*r.pb[t[1]];
      ev+=prize*p;e2+=Math.pow(prize-c.price,2)*p;}
    e2+=c.price*c.price*r.miss;
    const evx=ev-c.price, sd=Math.sqrt(Math.max(e2-evx*evx,0));
    L.push("模型: E[X]=Σ概率×奖金-2(浮动按估计值)");
    L.push("单注期望净收益 E[X]≈"+evx.toFixed(3)+" 元, σ≈"+Math.round(sd).toLocaleString("en-US")+
      " 元, CV="+(sd/Math.abs(evx)).toFixed(0));
    L.push("期望为负且方差巨大 —— 数学上的负和游戏");
    const tf=topN(gd.thetaF,c.fk,i=>gd.thetaF[i]),tb=topN(gd.thetaB,c.bk,i=>gd.thetaB[i]);
    return {lines:L,cand:{f:new Set(tf),b:new Set(tb)},why:"负期望下无『正EV组』,取后验权重最大组"};}

  function m11(gd,simF,simB,pool){const c=gd.cfg;const r=buildTiers(gd);const L=[];
    const pAny=1-r.miss;let ePay=0;
    for(const a of r.agg.values())ePay+=a[0]*a[1];
    const b=(ePay/pAny-c.price)/c.price, q=1-pAny;
    const fStar=(pAny*b-q)/b;
    L.push("模型: 凯利仓位 f*=(p·b-q)/b; p="+pct(pAny)+", b≈"+b.toFixed(1));
    L.push(fStar<0?("f*="+fStar.toFixed(4)+" < 0 → 数学最优仓位为 0:不应投注"):("f*="+fStar.toFixed(4)));
    L.push("破产模拟: 本金200元/每期1注,1500条路径×至多1000期");
    const rng=mulberry32(SEED+11);
    const prizes=[],cums=[];let acc=0;
    for(const t of c.tiers){
      const prize=(t[3]===null)?(t[2]==="一等奖"?c.jp:c.se):t[3];
      const p=r.pf[t[0]]*r.pb[t[1]];
      prizes.push(prize);acc+=p;cums.push(acc);}
    prizes.push(0);cums.push(1);
    let ruined=0;const times=[];
    for(let pth=0;pth<1500;pth++){let bank=200;
      for(let t=1;t<=1000;t++){
        if(bank<c.price){ruined++;times.push(t);break;}
        bank-=c.price;
        const x=rng();let lo=0,hi=cums.length-1;
        while(lo<hi){const mid=(lo+hi)>>1;if(x<=cums[mid])hi=mid;else lo=mid+1;}
        bank+=prizes[lo];}}
    const med=times.length?times.slice().sort((a,b2)=>a-b2)[Math.floor(times.length/2)]:null;
    L.push("1000期内破产概率≈"+pct(ruined/1500,1)+(med?", 中位破产时间≈"+med+"期":""));
    L.push("无限期购彩破产概率→100%(负期望+大数定律)。若购彩: 只花娱乐预算,不加仓不借钱");
    const pay=payoutMap(gd);
    let best=null,bu=-1e18;
    for(const t of pool){const f=t[0],b2=t[1];let u=0;
      for(let s=0;s<simF.length;s++){
        let jf=0;for(const x of f)if(simF[s].has(x))jf++;
        let jb=0;for(const x of b2)if(simB[s].has(x))jb++;
        u+=Math.log(((pay.get(jf+","+jb)||0)+1.0)/c.price);}
      u/=simF.length;
      if(u>bu){bu=u;best=t;}}
    return {lines:L,cand:{f:best[0],b:best[1]},why:"期望对数效用最大(稳定型组合)"};}

  function m12(gd){const c=gd.cfg;const r=buildTiers(gd);const L=[];
    let ev=0;for(const a of r.agg.values())ev+=a[0]*a[1];
    const evx=ev-c.price;
    L.push("模型: 大数定律 —— 独立重复购买平均净收益几乎必然收敛到 E[X]");
    L.push("理论极限 E[X]≈"+evx.toFixed(3)+" 元/注(含浮动头奖估计)");
    const fixed=[];let pFix=0;
    for(const t of c.tiers){
      if(t[2]==="一等奖"||t[2]==="二等奖")continue;
      const prize=(t[3]===null)?c.jp:c.se;
      fixed.push([prize,r.pf[t[0]]*r.pb[t[1]]]);pFix+=r.pf[t[0]]*r.pb[t[1]];}
    const eFix=fixed.reduce((a,x)=>a+x[0]*x[1],0)-c.price;
    let e2fix=0;
    for(const x of fixed)e2fix+=Math.pow(x[0]-c.price,2)*x[1];
    e2fix+=c.price*c.price*(1-pFix);
    const sdFix=Math.sqrt(Math.max(e2fix-eFix*eFix,0));
    L.push("固定奖金部分单独模拟1,000,000注(不含浮动头奖): 理论均值≈"+eFix.toFixed(3)+"元, σ≈"+sdFix.toFixed(1)+"元");
    const rng=mulberry32(SEED+12);
    const prizes=fixed.map(x=>x[0]).concat([0]),cums=[];let acc=0;
    for(const x of fixed){acc+=x[1];cums.push(acc);}
    cums.push(1);
    const marks={};const mlist=[10,100,1000,10000,100000,1000000];
    let run=0,i=0;
    for(const n of mlist){
      while(i<n){
        const x=rng();let lo=0,hi=cums.length-1;
        while(lo<hi){const mid=(lo+hi)>>1;if(x<=cums[mid])hi=mid;else lo=mid+1;}
        run+=prizes[lo]-c.price;i++;}
      marks[n]=run/n;}
    L.push(mlist.map(n=>"n="+n.toLocaleString("en-US")+":"+marks[n].toFixed(2)+"元").join(" | "));
    L.push("百万注后均值稳定在理论值附近 —— 长期必亏是定律而非运气");
    L.push("浮动头奖期望贡献另计,但其 σ 高达千万元级,均值要数百万注才收敛");
    L.push("理性购彩: ①娱乐消费非投资 ②冷热遗漏无预测力 ③量力而行 ④未成年人不得购彩");
    const Ef=gd.D*c.fk/c.fn, Eb=gd.D*c.bk/c.bn;
    const tf=topN(gd.fc,c.fk,i=>-(gd.fc[i]-Ef));
    const tb=topN(gd.bc,c.bk,i=>-(gd.bc[i]-Eb));
    return {lines:L,cand:{f:new Set(tf),b:new Set(tb)},why:"均值回归对照组(同样无统计效力)"};}

  /* ---------- 新增模型 13~16（与原 12 步并列，参与加权投票） ---------- */

  function m13(gd){const c=gd.cfg;const L=[];
    L.push("模型: 指数衰减加权频率(半衰期 30 期)——近期出现权重更大");
    L.push("⚠ 仍是频率统计,近期偏好无预测力,仅供对照");
    const half=30;const D=gd.D;
    const wf=new Array(c.fn+1).fill(0),wb=new Array(c.bn+1).fill(0);
    for(let t=0;t<D;t++){const w=Math.pow(0.5,(D-1-t)/half);
      for(const x of gd.fSets[t])wf[x]+=w;
      for(const x of gd.bSets[t])wb[x]+=w;}
    const tf=topN(wf,c.fk,i=>wf[i]),tb=topN(wb,c.bk,i=>wb[i]);
    return {lines:L,cand:{f:new Set(tf),b:new Set(tb)},why:"近期加权热度 Top(时间衰减)"};}

  function m14(gd){const c=gd.cfg;const L=[];
    L.push("模型: 形态匹配——从历史(和值带/奇偶/大小)经验分布采样目标形态,在后验权重下选号");
    const rng=mulberry32(SEED+14);
    const D=gd.D,half=Math.floor(c.fn/2);
    const lo=c.fk*(c.fk+1)/2,hi=c.fk*(2*c.fn-c.fk+1)/2,band=(hi-lo+1)/5;
    const forms=gd.draws.map(d=>{const f=d.nums.slice(0,c.fk),b=d.nums.slice(c.fk);
      const s=f.reduce((a,x)=>a+x,0);
      return {band:Math.max(0,Math.min(4,Math.floor((s-lo)/band))),
        odd:f.filter(x=>x%2===1).length,low:f.filter(x=>x<=half).length,
        bodd:b.filter(x=>x%2===1).length};});
    const target=forms[Math.floor(rng()*D)];
    L.push("采样形态: 和值第"+(target.band+1)+"档, 奇偶 "+target.odd+":"+(c.fk-target.odd)+
      ", 大小 "+target.low+":"+(c.fk-target.low));
    const order=topN(gd.thetaF,14,i=>gd.thetaF[i]);
    let no=target.odd,ne=c.fk-target.odd,nl=target.low,nb=c.fk-target.low;
    const pick=[];
    for(const i of order){
      if(pick.length>=c.fk)break;
      const odd=i%2===1,lowc=i<=half;
      if(((odd&&no>0)||(!odd&&ne>0))&&((lowc&&nl>0)||(!lowc&&nb>0))){
        pick.push(i);if(odd)no--;else ne--;if(lowc)nl--;else nb--;}}
    for(const i of order){
      if(pick.length>=c.fk)break;
      if(!pick.includes(i))pick.push(i);}
    // 和值落带修正：用未选号里的最大后验者替换偏离最远的号
    let sum=pick.reduce((a,b)=>a+b,0);
    const bL=lo+target.band*band, bH=lo+(target.band+1)*band, bandMid=(bL+bH)/2;
    if(sum<bL||sum>bH){
      const cand2=order.filter(i=>!pick.includes(i));
      for(const ni of cand2){
        if(sum>=bL&&sum<=bH)break;
        let wi=pick[0],wd=1e9;
        for(const p of pick){const ns=sum-p+ni;
          if(Math.abs(ns-bandMid)<wd){wd=Math.abs(ns-bandMid);wi=p;}}
        const idx=pick.indexOf(wi);pick[idx]=ni;sum+=ni-wi;}}
    let tf=topN(gd.thetaB,c.bk+2,i=>gd.thetaB[i]);
    let tb;
    if(c.bk===1)tb=[tf[0]];
    else{tb=null;
      for(let i=0;i<tf.length&&!tb;i++)for(let j=i+1;j<tf.length&&!tb;j++)
        if(((tf[i]%2)+(tf[j]%2))===target.bodd)tb=[tf[i],tf[j]];
      if(!tb)tb=tf.slice(0,c.bk);}
    return {lines:L,cand:{f:new Set(pick),b:new Set(tb)},why:"历史形态经验采样+后验选号"};}

  function m15(gd){const c=gd.cfg;const L=[];
    L.push("模型: 共现聚类——同期高频共现的号码抱团(与相关分散模型方向相反)");
    const co=new Map();
    function addCo(sets,N,k){
      for(const s of sets){const a=[...s];
        for(let x=0;x<a.length;x++)for(let y=x+1;y<a.length;y++){
          const key=Math.min(a[x],a[y])+"_"+Math.max(a[x],a[y]);
          co.set(key,(co.get(key)||0)+1);}}}
    addCo(gd.fSets);addCo(gd.bSets);
    function cluster(sets,N,k,seedArr){
      const seed=topN(seedArr,1,i=>seedArr[i])[0];
      const picked=[seed];
      while(picked.length<k){let bi=-1,bv=-1;
        for(let i=1;i<=N;i++){
          if(picked.includes(i))continue;
          let m=0;
          for(const j of picked){const key=Math.min(i,j)+"_"+Math.max(i,j);m+=(co.get(key)||0);}
          m/=picked.length;
          if(m>bv-1e-12||(Math.abs(m-bv)<1e-12&&seedArr[i]>seedArr[bi])){bv=m;bi=i;}}
        picked.push(bi);}
      return picked;}
    const tf=cluster(gd.fSets,c.fn,c.fk,gd.fc);
    const tb=cluster(gd.bSets,c.bn,c.bk,gd.bc);
    L.push("种子=出现最多的号,逐步加入平均共现次数最高的号");
    return {lines:L,cand:{f:new Set(tf),b:new Set(tb)},why:"高频共现抱团(聚类视角)"};}

  function m16(gd,simF,simB){const c=gd.cfg;const L=[];
    L.push("模型: 模拟退火——在「模拟命中+和值贴近+分散度」合成适应度上迭代优化 300 轮");
    const rng=mulberry32(SEED+16);
    const S=Math.min(400,simF.length);
    function fit(set){
      let hit=0;for(let s=0;s<S;s++){for(const x of set)if(simF[s].has(x))hit++;}
      hit/=(S*c.fk);
      const sum=set.reduce((a,b)=>a+b,0),mid=c.fk*(c.fn+1)/2;
      const formF=Math.exp(-Math.pow(sum-mid,2)/(2*Math.pow(c.fn*0.6,2)));
      const sorted=[...set].sort((a,b)=>a-b);let gap=0;
      for(let i=1;i<sorted.length;i++)gap+=sorted[i]-sorted[i-1]-1;
      const disp=Math.min(1,gap/(c.fn/2));
      return hit*(c.fk*c.fk/c.fn)*0.5+formF*0.3+disp*0.2;}
    let cur=topN(gd.thetaF,c.fk,i=>gd.thetaF[i]);
    let best=cur.slice(),bf=fit(cur),T=1.0;
    for(let it=0;it<300;it++){
      const cand2=cur.slice();
      const nmut=1+((rng()*2)|0);
      for(let k=0;k<nmut;k++){
        const pos=(rng()*c.fk)|0;
        let nv=1+((rng()*c.fn)|0);
        while(cand2.includes(nv))nv=1+((rng()*c.fn)|0);
        cand2[pos]=nv;}
      const f=fit(cand2);
      if(f>bf||rng()<Math.exp((f-bf)/Math.max(T,1e-9))){cur=cand2;
        if(f>bf){bf=f;best=cand2.slice();}}
      T*=0.985;}
    L.push("适应度=0.5×模拟命中(相对随机基准)+0.3×和值贴近+0.2×分散度");
    const tb=topN(gd.thetaB,c.bk,i=>gd.thetaB[i]);
    return {lines:L,cand:{f:new Set(best),b:new Set(tb)},why:"元启发式多目标优化"};}

  /* ---------- 逐期回测加权：近 30 期每期用「此前 100 期」训练,按实际命中/随机基准定权 ---------- */
  const MODEL_NAMES={m1:"经验众数",m2:"小奖覆盖",m3:"贝叶斯后验",m4:"后验抽样",m5:"遗漏回补",
    m6:"卡方残差",m7:"相关分散",m8:"马尔科夫",m9:"蒙特卡洛覆盖",m10:"期望收益",
    m11:"凯利风险",m12:"均值回归对照",m13:"衰减热度",m14:"形态匹配",m15:"共现聚类",m16:"模拟退火"};

  function backtest(key){
    const draws=DATA[key],cfg=GAMES[key];
    const total=draws.length;
    let N=Math.min(30,total-WINDOW);
    if(N<5)N=Math.max(0,N);
    const defs=[["m1",gd=>m1(gd)],["m2",gd=>m2(gd)],["m3",gd=>m3(gd)],["m4",gd=>m4(gd)],
      ["m5",gd=>m5(gd)],["m6",gd=>m6(gd)],["m7",gd=>m7(gd)],["m8",gd=>m8(gd)],
      ["m10",gd=>m10(gd)],["m12",gd=>m12(gd)],["m13",gd=>m13(gd)],["m14",gd=>m14(gd)],["m15",gd=>m15(gd)]];
    const baseF=cfg.fk*cfg.fk/cfg.fn, baseB=cfg.bk*cfg.bk/cfg.bn;
    const raw={};
    for(const d of defs)raw[d[0]]=1;
    if(N>=5){
      const acc={};for(const d of defs)acc[d[0]]={f:0,b:0,n:0};
      const start=Math.max(WINDOW,total-N);
      for(let t=start;t<total;t++){
        const gd=makeGD(cfg,draws.slice(t-WINDOW,t));
        const actual=draws[t].nums;
        const fA=new Set(actual.slice(0,cfg.fk)),bA=new Set(actual.slice(cfg.fk));
        for(const d of defs){
          try{const cand=d[1](gd);
            let hf=0;for(const x of cand.cand.f)if(fA.has(x))hf++;
            let hb=0;for(const x of cand.cand.b)if(bA.has(x))hb++;
            acc[d[0]].f+=hf;acc[d[0]].b+=hb;acc[d[0]].n++;}catch(e){}}}
      for(const d of defs){const a=acc[d[0]];
        if(a.n>0){const avgF=a.f/a.n,avgB=a.b/a.n;
          raw[d[0]]=Math.max(0.3,((avgF/baseF)+(avgB/baseB))/2);
          d.avgF=avgF;d.avgB=avgB;}
        else raw[d[0]]=1;}}
    const sumW=Object.values(raw).reduce((a,b)=>a+b,0);
    const rows=Object.keys(raw).map(k=>({key:k,name:MODEL_NAMES[k],w:raw[k]/sumW,
      ratio:raw[k],avgF:defs.find(d=>d[0]===k)?(defs.find(d=>d[0]===k).avgF||null):null,
      avgB:defs.find(d=>d[0]===k)?(defs.find(d=>d[0]===k).avgB||null):null}));
    rows.sort((a,b)=>b.w-a.w);
    return {rows:rows,baseF:baseF,baseB:baseB,n:N,
      note:"蒙特卡洛/凯利/退火等重模型不参与回测,按中性权重计;历史回测不代表未来"};
  }

  /* ---------- 策略五注：同一批模型结果的不同合成视角 ---------- */
  function formConstrainedPick(scoreF,cfg){
    const half=Math.floor(cfg.fn/2);
    const order=[];for(let i=1;i<=cfg.fn;i++)order.push(i);
    order.sort((a,b)=>scoreF[b]-scoreF[a]);
    const lo=cfg.fk*(cfg.fk+1)/2,hi=cfg.fk*(2*cfg.fn-cfg.fk+1)/2;
    const sL=lo+0.35*(hi-lo),sH=lo+0.65*(hi-lo);
    const oL=Math.ceil(cfg.fk*0.4),oH=Math.floor(cfg.fk*0.6);
    let best=null,bw=-1;
    (function rec(s,cur){
      if(cur.length===cfg.fk){
        const sm=cur.reduce((a,b)=>a+b,0);
        const odd=cur.filter(x=>x%2===1).length;
        const low=cur.filter(x=>x<=half).length;
        if(sm>=sL&&sm<=sH&&odd>=oL&&odd<=oH&&low>=Math.ceil(cfg.fk*0.4)&&low<=Math.floor(cfg.fk*0.6)){
          const w=cur.reduce((a,x)=>a+scoreF[x],0);
          if(w>bw){bw=w;best=cur.slice();}}
        return;}
      for(let i=s;i<Math.min(order.length,12);i++){cur.push(order[i]);rec(i+1,cur);cur.pop();}})(0,[]);
    if(best)return best.sort((a,b)=>a-b);
    return order.slice(0,cfg.fk).sort((a,b)=>a-b);}

  function dispersionPick(gd,scoreF,cfg,zone){
    const sets=zone==="f"?gd.fSets:gd.bSets;
    const N=zone==="f"?cfg.fn:cfg.bn;
    const k=zone==="f"?cfg.fk:cfg.bk;
    const cols=[];
    for(let i=1;i<=N;i++){const col=new Array(sets.length);
      for(let t=0;t<sets.length;t++)col[t]=sets[t].has(i)?1:0;cols.push(col);}
    const means=cols.map(col=>col.reduce((a,b)=>a+b,0)/col.length);
    const cen=cols.map((col,ci)=>col.map(v=>v-means[ci]));
    const norms=cen.map(c2=>Math.sqrt(c2.reduce((a,v)=>a+v*v,0)));
    const cm=new Map();
    for(let a=0;a<N;a++)for(let b=a+1;b<N;b++){
      let dot=0;const ca=cen[a],cb=cen[b];
      for(let t=0;t<ca.length;t++)dot+=ca[t]*cb[t];
      const rr=norms[a]*norms[b]>0?dot/(norms[a]*norms[b]):0;
      cm.set((a+1)+"_"+(b+1),rr);}
    const order=[];for(let i=1;i<=N;i++)order.push(i);
    order.sort((a,b)=>scoreF[b]-scoreF[a]);
    const picked=[order[0]];
    while(picked.length<k){let bi=-1,bv=1e9;
      for(let i=1;i<=N;i++){
        if(picked.includes(i))continue;
        let m=0;
        for(const j of picked){const key=Math.min(i,j)+"_"+Math.max(i,j);m+=Math.abs(cm.get(key)||0);}
        m/=picked.length;
        if(m<bv-1e-12||(Math.abs(m-bv)<1e-12&&scoreF[i]>scoreF[bi])){bv=m;bi=i;}}
      picked.push(bi);}
    return picked.sort((a,b)=>a-b);}

  function buildSets(cfg,gd,models,final){
    const scoreF=new Array(cfg.fn+1).fill(0),scoreB=new Array(cfg.bn+1).fill(0);
    for(const m of models){
      for(const x of m.cand.f)scoreF[x]+=m.w;
      for(const x of m.cand.b)scoreB[x]+=m.w;}
    const sets=[{tag:"主推 · 加权投票",f:final.f.slice(),b:final.b.slice()}];
    const rng2=mulberry32(SEED+21);
    const f2=postDraw(scoreF.slice(1).map(v=>v+0.15),cfg.fk,rng2).map(x=>x+1);
    const b2=postDraw(scoreB.slice(1).map(v=>v+0.15),cfg.bk,rng2).map(x=>x+1);
    sets.push({tag:"加权采样 · 按综合得分",f:f2.sort((a,b)=>a-b),b:b2.sort((a,b)=>a-b)});
    sets.push({tag:"保守 · 形态约束下取最高综合分",f:formConstrainedPick(scoreF,cfg),
      b:topN(scoreB,cfg.bk,i=>scoreB[i]).sort((a,b)=>a-b)});
    sets.push({tag:"分散 · 低相关组合",f:dispersionPick(gd,scoreF,cfg,"f"),
      b:dispersionPick(gd,scoreB,cfg,"b")});
    const rng3=mulberry32(SEED+25);
    const f5=postDraw(new Array(cfg.fn).fill(1),cfg.fk,rng3).map(x=>x+1);
    const b5=postDraw(new Array(cfg.bn).fill(1),cfg.bk,rng3).map(x=>x+1);
    sets.push({tag:"随机对照 · 纯随机",f:f5.sort((a,b)=>a-b),b:b5.sort((a,b)=>a-b)});
    const seen=new Set();
    for(const s of sets){let key=fmtS(new Set(s.f))+"|"+fmtS(new Set(s.b));
      while(seen.has(key)){
        const order=[];for(let i=1;i<=cfg.fn;i++)order.push(i);
        order.sort((a,b)=>scoreF[b]-scoreF[a]);
        for(const cand of order){
          if(!s.f.includes(cand)){
            let wi=0;for(const p of s.f)if(scoreF[p]<scoreF[wi]||wi===0)wi=p;
            s.f[s.f.indexOf(wi)]=cand;break;}}
        s.f.sort((a,b)=>a-b);s.b.sort((a,b)=>a-b);
        key=fmtS(new Set(s.f))+"|"+fmtS(new Set(s.b));}
      seen.add(key);}
    return sets;}

  function analyzeGame(key){
    const cfg=GAMES[key];
    const stock=DATA[key].length;
    const draws=DATA[key].slice(-WINDOW);
    const gd=makeGD(cfg,draws);
    const out={name:cfg.name,
      upto:{issue:draws[draws.length-1].issue,date:String(draws[draws.length-1].date).slice(0,10),count:draws.length,stock:stock},
      sections:[]};
    const rng=mulberry32(SEED);
    const sim=buildSim(gd,2000,rng);
    const pool=candPool(gd,mulberry32(SEED+9));
    const bt=backtest(key);
    const raw={};
    for(const r of bt.rows)raw[r.key]=Math.max(0.3,r.ratio);
    for(const k of ["m9","m11","m16"])raw[k]=1;
    const sumW=Object.values(raw).reduce((a,b)=>a+b,0);
    const wMap={};for(const k of Object.keys(raw))wMap[k]=raw[k]/sumW;
    const steps=[
      ["步骤一 · 一等奖概率(超几何分布)","m1",function(){return m1(gd);}],
      ["步骤二 · 奖级概率(多元超几何分布)","m2",function(){return m2(gd);}],
      ["步骤三 · 前区热度(贝叶斯后验估计)","m3",function(){return m3(gd);}],
      ["步骤四 · 后区热度(Dirichlet-多项共轭)","m4",function(){return m4(gd);}],
      ["步骤五 · 遗漏分析(几何分布与生存函数)","m5",function(){return m5(gd);}],
      ["步骤六 · 号码独立性(卡方检验)","m6",function(){return m6(gd);}],
      ["步骤七 · 号码相关性(皮尔逊相关系数)","m7",function(){return m7(gd);}],
      ["步骤八 · 时间演化(马尔科夫链)","m8",function(){return m8(gd);}],
      ["步骤九 · 组合覆盖(蒙特卡洛模拟)","m9",function(){return m9(gd,sim[0],sim[1],pool);}],
      ["步骤十 · 期望收益(数学期望与方差)","m10",function(){return m10(gd);}],
      ["步骤十一 · 风险管理(凯利准则与破产概率)","m11",function(){return m11(gd,sim[0],sim[1],pool);}],
      ["步骤十二 · 极限定理(大数定律与理性购彩)","m12",function(){return m12(gd);}],
      ["步骤十三 · 衰减热度(指数加权频率)","m13",function(){return m13(gd);}],
      ["步骤十四 · 形态匹配(和值/奇偶/大小采样)","m14",function(){return m14(gd);}],
      ["步骤十五 · 共现聚类(高频抱团)","m15",function(){return m15(gd);}],
      ["步骤十六 · 模拟退火(多目标合成优化)","m16",function(){return m16(gd,sim[0],sim[1]);}],
    ];
    const votesF=new Map(),votesB=new Map();const cands=[];const modelResults=[];
    for(const st of steps){
      const r=st[2]();
      const w=wMap[st[1]]||0;
      for(const x of r.cand.f)votesF.set(x,(votesF.get(x)||0)+w);
      for(const x of r.cand.b)votesB.set(x,(votesB.get(x)||0)+w);
      out.sections.push({title:st[0],lines:r.lines,cand:r.cand,why:r.why});
      cands.push(r.cand);
      modelResults.push({key:st[1],cand:r.cand,w:w});}
    function rankTop(votes,theta,N,k){
      const idx=[];for(let i=1;i<=N;i++)idx.push(i);
      idx.sort(function(a,b){
        const va=votes.get(a)||0,vb=votes.get(b)||0;
        if(vb!==va)return vb-va;
        if(theta[b]!==theta[a])return theta[b]-theta[a];
        return a-b;});
      return idx.slice(0,k).sort(function(a,b){return a-b;});}
    out.final={f:rankTop(votesF,gd.thetaF,cfg.fn,cfg.fk),
               b:rankTop(votesB,gd.thetaB,cfg.bn,cfg.bk)};
    out.votes={f:out.final.f.map(i=>pad2(i)+" "+Math.round((votesF.get(i)||0)*100)).join("  "),
               b:out.final.b.map(i=>pad2(i)+" "+Math.round((votesB.get(i)||0)*100)).join("  ")};
    out.votesF={};votesF.forEach(function(v,k){out.votesF[k]=v;});
    out.votesB={};votesB.forEach(function(v,k){out.votesB[k]=v;});
    out.gd={fc:gd.fc,bc:gd.bc,fom:gd.fom,bom:gd.bom};
    out.weights={rows:bt.rows,baseF:bt.baseF,baseB:bt.baseB,n:bt.n,note:bt.note};
    out.sets=buildSets(cfg,gd,modelResults,out.final); // 频率与遗漏，供统计图使用
    const combo=new Map();
    for(const c2 of cands){const k=fmtS(c2.f)+"|"+fmtS(c2.b);combo.set(k,(combo.get(k)||0)+1);}
    let mx=0,mk="";
    for(const en of combo)if(en[1]>mx){mx=en[1];mk=en[0];}
    out.consensus=mx>=2?("共识: "+mx+" 个模型给出完全相同的组合 "+mk.replace("|"," + ")):null;
    return out;
  }

  global.Engine = { GAMES, SEED, WINDOW, analyzeGame, makeGD, pad2, fmtArr, fmtS, pct };
  Object.defineProperty(global, "DATA", {
    get(){ return DATA; },
    set(v){ DATA = v; },
    configurable: true,
  });
})(window);
