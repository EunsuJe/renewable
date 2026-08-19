/* ============================================================
   engine.js  —  판정 · 산출 · 최적화 · 민감도
   ============================================================ */

class MissingRuleError extends Error {
  constructor(m){ super(m); this.name="MissingRuleError"; }
}

/* ---------- 공통 헬퍼 ---------- */
const ctx = {
  pickByDate(rows, d){
    return rows.find(r => r.from<=d && (!r.to || r.to>=d)) || null;
  },
  totalGfa(p){ return p.buildings.reduce((s,b)=>s+b.gfa_total,0); },
  netGfa(p){   return p.buildings.reduce((s,b)=>s+(b.gfa_total-(b.gfa_parking||0)),0); },
  totalHouseholds(p){ return p.buildings.reduce((s,b)=>s+(b.households||0),0); },
  allUses(p){ return [...new Set(p.buildings.flatMap(b=>b.uses.map(u=>u.code)))]; },
  espReportRequired(p){ return ctx.totalGfa(p) >= 500; },
  isResidentialDominant(p){
    let res=0, non=0;
    p.buildings.forEach(b=>b.uses.forEach(u=>{
      (u.sector==="주거" ? (res+=u.gfa) : (non+=u.gfa));
    }));
    return res > non;
  },
  unitEnergy(use, sector, d){
    const rows = UNIT_ENERGY.filter(r=>r.use===use && r.sector===sector && r.from<=d);
    if(!rows.length) throw new MissingRuleError(`단위에너지사용량 없음: ${sector}/${use} @ ${d}`);
    return rows.sort((a,b)=>b.from.localeCompare(a.from))[0];
  },
  coeff(key, d){
    const r = COEFF.find(c=>c.key===key && c.from<=d && (!c.to||c.to>=d));
    if(!r) throw new MissingRuleError(`보정계수 없음: ${key} @ ${d}`);
    return r;
  },
  regionFactor(sido){
    const v = REGION_FACTOR[sido];
    if(v==null) throw new MissingRuleError(`지역계수 없음: ${sido}`);
    return v;
  }
};

/* ---------- 수요량 산정 ---------- */
function computeDemand(p){
  const d  = p.project.permit_expected_date;
  const rf = ctx.regionFactor(p.location.sido);
  const lines = [];
  let total = 0;

  p.buildings.forEach(b=>{
    // 주차장 면적을 용도별 면적 비례로 차감
    const gross = b.uses.reduce((s,u)=>s+u.gfa,0);
    const park  = b.gfa_parking||0;
    b.uses.forEach(u=>{
      const net = u.gfa - park*(u.gfa/gross);
      const ue  = ctx.unitEnergy(u.code, u.sector, d);
      const e   = net * ue.v * rf;
      total += e;
      lines.push({ bldg:b.bldg_id, use:u.code, sector:u.sector,
                   gross:u.gfa, net:+net.toFixed(1), unitEnergy:ue.v,
                   region:rf, energy:+e.toFixed(0),
                   prov:`단위에너지사용량 ${ue.v} (${ue.from}~)`+(ue.verified?"":" ※미검증") });
    });
  });

  const e = p.energy_forecast;
  const demandToe = e.elec_kwh_y*(p.options?.useElecPrimary ? TOE.KWH_ELEC_PRIMARY : TOE.KWH_FINAL)
                  + e.fuel_toe_y;

  return { kwh: total, toe: demandToe, lines,
           note:"주차장 면적은 용도별 면적 비례 차감됨" };
}

/* ---------- 제도 판정 매트릭스 ---------- */
function evaluateRegulations(p){
  const out=[];
  REGULATIONS.forEach(r=>{
    let t, req=null, extra=null, err=null;
    try{
      t = r.test(p, ctx);
      if(t.apply){
        req   = r.required(p, ctx, t);
        extra = r.extra ? r.extra(p, ctx, req) : null;
      }
    }catch(e){ err = e.message; }
    out.push({ id:r.id, name:r.name, basis:r.basis, authority:r.authority,
               calc:r.calc, blocksPermit:r.blocksPermit, leadDays:r.leadDays,
               apply:!!(t&&t.apply), unknown:!!(t&&t.unknown),
               why:t?t.why:"", required:req, extra, error:err });
  });
  return out;
}

/* ============================================================
   LP 솔버 (2단계 심플렉스)
   minimize c·x  s.t.  A x (op) b,  0 ≤ x
   ============================================================ */
function simplex(c, A, b, ops){
  const m=A.length, n=c.length;
  const rows = A.map((r,i)=>({a:[...r], b:b[i], op:ops[i]}));
  rows.forEach(r=>{ if(r.b<0){ r.a=r.a.map(v=>-v); r.b=-r.b;
    r.op = r.op==="<="?">=":(r.op===">="?"<=":"="); }});

  let col=n; const slack=[],surp=[],art=[];
  rows.forEach((r,i)=>{
    if(r.op==="<=") slack.push({r:i,c:col++});
    else if(r.op===">="){ surp.push({r:i,c:col++}); art.push({r:i,c:col++}); }
    else art.push({r:i,c:col++});
  });
  const N=col;
  const T = rows.map(()=>new Array(N+1).fill(0));
  rows.forEach((r,i)=>{ for(let j=0;j<n;j++)T[i][j]=r.a[j]; T[i][N]=r.b; });
  slack.forEach(s=>T[s.r][s.c]=1);
  surp .forEach(s=>T[s.r][s.c]=-1);
  art  .forEach(s=>T[s.r][s.c]=1);

  const basis=new Array(m).fill(-1);
  slack.forEach(s=>basis[s.r]=s.c);
  art  .forEach(s=>basis[s.r]=s.c);

  const isArt=new Array(N).fill(false); art.forEach(s=>isArt[s.c]=true);

  const pivot=(l,e)=>{
    const pv=T[l][e];
    for(let j=0;j<=N;j++) T[l][j]/=pv;
    for(let i=0;i<m;i++){
      if(i===l) continue;
      const f=T[i][e];
      if(Math.abs(f)>1e-12) for(let j=0;j<=N;j++) T[i][j]-=f*T[l][j];
    }
    basis[l]=e;
  };

  const run=(cost, mask)=>{
    for(let it=0; it<8000; it++){
      const z=new Array(N+1).fill(0);
      for(let j=0;j<=N;j++){ let s=0; for(let i=0;i<m;i++) s+=cost[basis[i]]*T[i][j]; z[j]=s; }
      let e=-1, best=1e-9;
      for(let j=0;j<N;j++){
        if(mask && !mask[j]) continue;
        const rc=z[j]-cost[j];
        if(rc>best){best=rc; e=j;}
      }
      if(e<0) return {ok:true, obj:z[N]};
      let l=-1, mn=Infinity;
      for(let i=0;i<m;i++) if(T[i][e]>1e-9){
        const r=T[i][N]/T[i][e]; if(r<mn-1e-12){mn=r; l=i;}
      }
      if(l<0) return {ok:false, reason:"unbounded"};
      pivot(l,e);
    }
    return {ok:false, reason:"iteration limit"};
  };

  // Phase 1
  const c1=new Array(N).fill(0); art.forEach(s=>c1[s.c]=1);
  const r1=run(c1,null);
  if(!r1.ok) return {status:r1.reason};
  if(r1.obj>1e-6) return {status:"infeasible"};

  // 인공변수를 기저에서 축출
  for(let i=0;i<m;i++){
    if(isArt[basis[i]]){
      let e=-1;
      for(let j=0;j<N;j++) if(!isArt[j] && Math.abs(T[i][j])>1e-9){e=j;break;}
      if(e>=0) pivot(i,e);
    }
  }
  // Phase 2
  const c2=new Array(N).fill(0); for(let j=0;j<n;j++) c2[j]=c[j];
  const mask=new Array(N).fill(true); art.forEach(s=>mask[s.c]=false);
  const r2=run(c2,mask);
  if(!r2.ok) return {status:r2.reason};

  const x=new Array(n).fill(0);
  for(let i=0;i<m;i++) if(basis[i]<n) x[basis[i]]=T[i][N];
  return {status:"optimal", x, obj:r2.obj};
}

/* ---------- 제약조건 생성 ---------- */
function buildProblem(p, regs, demand, opts={}){
  const d = p.project.permit_expected_date;
  const sys = (p.systems_enabled || COEFF.map(c=>c.key))
                .map(k=>ctx.coeff(k,d))
                .filter(s=>opts.excludeSources ? !opts.excludeSources.includes(s.key) : true);

  const c=[], A=[], b=[], ops=[], labels=[];
  sys.forEach(s=>c.push(s.cost));

  const add=(coefs, sign, rhs, label)=>{ A.push(coefs); ops.push(sign); b.push(rhs); labels.push(label); };

  // (1) 보정계수 기반 의무비율 — 적용 제도 중 최대값 하나만
  const corrected = regs.filter(r=>r.apply && r.calc==="RATIO_CORRECTED" && r.required?.pct>0);
  if(corrected.length){
    const gov = corrected.reduce((a,x)=>x.required.pct>a.required.pct?x:a);
    add(sys.map(s=>s.gen*s.cf), ">=", gov.required.pct/100*demand.kwh,
        `${gov.name} ${gov.required.pct}% (보정계수 기준)`);

    // 서울 재생열 부가의무
    const eh = corrected.map(r=>r.extra).find(Boolean);
    if(eh) add(sys.map(s=>HEAT_SOURCES.includes(s.key)? s.gen*s.cf : 0), ">=",
               eh.shareOfRequired * gov.required.pct/100*demand.kwh,
               `${eh.name} (의무량의 ${eh.shareOfRequired*100}%)`);
  }

  // (2) toe 실물 기준
  const toeReg = regs.find(r=>r.apply && r.calc==="RATIO_TOE_RAW");
  if(toeReg) add(sys.map(s=>s.gen*TOE.KWH_FINAL), ">=",
                 toeReg.required.pct/100*demand.toe,
                 `${toeReg.name} ${toeReg.required.pct}% (toe 실물 기준)`);

  // (3) ZEB 자립률 (1차에너지소요량 입력 시)
  const zeb = regs.find(r=>r.apply && r.calc==="RATIO_ZEB");
  if(zeb && p.energy_forecast.primary_kwh_y)
    add(sys.map(s=>s.gen), ">=", zeb.required.pct/100*p.energy_forecast.primary_kwh_y,
        `ZEB ${zeb.required.zebGrade}등급 자립률 ${zeb.required.pct}%`);

  // (4) 면적 제약
  const sc = p.site_capacity;
  const roof = sc.roof_available_m2/SAFETY_AREA;
  const fac  = (sc.facade_south_m2+sc.facade_east_m2+sc.facade_west_m2)/SAFETY_AREA;
  if(sys.some(s=>s.mount==="roof"))
    add(sys.map(s=>s.mount==="roof"?s.area:0), "<=", roof,
        `옥상 가용면적 ${roof.toFixed(0)}㎡ (여유율 ${SAFETY_AREA})`);
  if(sys.some(s=>s.mount==="facade"))
    add(sys.map(s=>s.mount==="facade"?s.area:0), "<=", fac,
        `입면 가용면적 ${fac.toFixed(0)}㎡ (여유율 ${SAFETY_AREA})`);

  // (5) 물리적 불가 설비 차단
  if(!sc.geothermal_feasible)
    sys.forEach((s,i)=>{ if(s.key.startsWith("GEO")){
      const r=new Array(sys.length).fill(0); r[i]=1; add(r,"<=",0,`${s.name} 설치 불가`); }});
  if(!sc.gas_capacity_ok)
    sys.forEach((s,i)=>{ if(s.key.startsWith("FC")){
      const r=new Array(sys.length).fill(0); r[i]=1; add(r,"<=",0,`${s.name} 가스용량 부족`); }});
  if(!sc.water_source)
    sys.forEach((s,i)=>{ if(s.key.startsWith("HYDRO")){
      const r=new Array(sys.length).fill(0); r[i]=1; add(r,"<=",0,`${s.name} 수원 없음`); }});

  return {sys, c, A, b, ops, labels};
}

/* ---------- 최적화 실행 + 민감도 ---------- */
function optimize(p, regs, demand, opts={}){
  const pr = buildProblem(p, regs, demand, opts);
  const r  = simplex(pr.c, pr.A, pr.b, pr.ops);
  if(r.status!=="optimal")
    return {status:r.status, constraints:pr.labels,
            hint:"면적 제약 완화, 설비 추가 허용, 목표비율 재확인 필요"};

  const mix = pr.sys.map((s,i)=>({
    key:s.key, name:s.name, unit:s.unit,
    capacity:+r.x[i].toFixed(2),
    area:+(r.x[i]*s.area).toFixed(1),
    cost:+(r.x[i]*s.cost).toFixed(0),
    genCorrected:+(r.x[i]*s.gen*s.cf).toFixed(0),
    genRaw:+(r.x[i]*s.gen).toFixed(0),
    prov:`${s.src} / ${s.from}~`
  })).filter(m=>m.capacity>1e-4);

  // 민감도: 각 제약 RHS +5% 시 비용 증가
  const sens=[];
  pr.A.forEach((_,k)=>{
    if(pr.ops[k]!==">=") return;
    const b2=[...pr.b]; b2[k]*=1.05;
    const r2=simplex(pr.c,pr.A,b2,pr.ops);
    sens.push({ constraint:pr.labels[k],
                deltaCost: r2.status==="optimal" ? +(r2.obj-r.obj).toFixed(0) : null,
                status:r2.status });
  });

  return { status:"optimal", mix,
           totalCost:+r.obj.toFixed(0),
           constraints:pr.labels,
           sensitivity:sens.sort((a,b)=>(b.deltaCost||0)-(a.deltaCost||0)),
           binding: sens.filter(s=>s.deltaCost>1).map(s=>s.constraint) };
}

/* ---------- toe 목표 스윕 ---------- */
function sweepToeTarget(p, regs, demand, from=0.35, to=0.55, step=0.05){
  const out=[];
  for(let t=from; t<=to+1e-9; t+=step){
    const cp = JSON.parse(JSON.stringify(p));
    cp.overrides = {...(cp.overrides||{}), esp_review_target_pct:+t.toFixed(2)};
    const rg = evaluateRegulations(cp);
    const r  = optimize(cp, rg, demand);
    out.push({ target:+t.toFixed(2),
               cost: r.status==="optimal"? r.totalCost : null,
               status:r.status });
  }
  return out;
}

/* ---------- 대안 시나리오 ---------- */
function scenarios(p, regs, demand){
  return [
    { name:"Option#1 최소비용", ...optimize(p,regs,demand) },
    { name:"Option#2 연료전지 배제(유지관리 최소)",
      ...optimize(p,regs,demand,{excludeSources:["FC_PEM","FC_SOFC"]}) },
    { name:"Option#3 BIPV 배제(입면 보존)",
      ...optimize(p,regs,demand,{excludeSources:["BIPV"]}) }
  ];
}

/* ---------- 전체 실행 ---------- */
function runReview(p){
  const warnings=[];
  if(!REGION_FACTOR._verified) warnings.push("⚠ 지역계수 미검증 — 전 지역 1.00 임시값. 지침 별표 확인 필요.");
  COEFF.filter(c=>!c.verified).forEach(c=>warnings.push(`⚠ 보정계수 미검증: ${c.name}`));
  UNIT_ENERGY.filter(u=>!u.verified).forEach(u=>warnings.push(`⚠ 단위에너지사용량 미검증: ${u.sector}/${u.use}`));

  const demand = computeDemand(p);
  const regs   = evaluateRegulations(p);
  regs.filter(r=>r.unknown).forEach(r=>warnings.push(`⚠ ${r.name}: ${r.why}`));
  regs.filter(r=>r.error).forEach(r=>warnings.push(`✖ ${r.name}: ${r.error}`));

  const opt   = optimize(p, regs, demand);
  const alts  = scenarios(p, regs, demand);
  const sweep = regs.some(r=>r.apply && r.calc==="RATIO_TOE_RAW")
                ? sweepToeTarget(p, regs, demand) : null;

  // 일정 역산
  const lead = Math.max(0, ...regs.filter(r=>r.apply).map(r=>r.leadDays));
  const permit = new Date(p.project.permit_expected_date);
  const start  = new Date(permit.getTime() - lead*864e5);

  return {
    meta:{ dataVersion:DATA_VERSION, reviewedAt:new Date().toISOString(),
           basisDate:p.project.permit_expected_date },
    demand, regulations:regs, optimum:opt, alternatives:alts, toeSweep:sweep,
    schedule:{ maxLeadDays:lead, startBy:start.toISOString().slice(0,10),
               blockers:regs.filter(r=>r.apply&&r.blocksPermit).map(r=>r.name) },
    warnings
  };
}
