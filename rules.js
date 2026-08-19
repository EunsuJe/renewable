/* ============================================================
   rules.js  —  제도별 적용 판정
   ※ 판정 "논리"는 자주 안 바뀝니다. 숫자는 tables.js에 있습니다.
   ============================================================ */

const PUBLIC_CLIENT_TYPES = ["gov","local_gov","public_agency",
                             "gov_funded","gov_invested","special_law"];

const REGULATIONS = [

/* --- R1. 공공기관 신재생에너지 설치의무화 ------------------- */
{
  id:"PUB_MANDATORY",
  name:"공공기관 신재생에너지 설치의무화",
  basis:"신에너지 및 재생에너지 개발·이용·보급 촉진법 §12②, 시행령 §15",
  authority:"한국에너지공단 신재생에너지센터 (052-920-0764)",
  calc:"RATIO_CORRECTED",
  blocksPermit:true,
  leadDays:30,

  test(p, ctx){
    const reasons=[];
    const isPublic = PUBLIC_CLIENT_TYPES.includes(p.client.type);
    if(!isPublic) return {apply:false, why:"공공 대상기관 아님"};
    reasons.push("공공 대상기관 해당");

    if(!["new","extension","reconstruction"].includes(p.action.primary))
      return {apply:false, why:`행위유형(${p.action.primary})이 신축·증축·개축 아님`};
    reasons.push("신축/증축/개축 해당");

    const bigEnough = p.buildings.some(b=>b.gfa_total>=1000);
    if(!bigEnough) return {apply:false, why:"각 건축물 연면적 1,000㎡ 미만"};
    reasons.push("연면적 1,000㎡ 이상 동 존재");

    const uses = ctx.allUses(p);
    const ok = uses.some(u=>PUBLIC_ELIGIBLE_USES.includes(u) &&
                            !PUBLIC_EXCLUDED_USES.includes(u));
    if(!ok) return {apply:false, why:"대상용도 미해당(주거·창고·발전 등 제외)"};
    reasons.push("대상용도 해당");

    return {apply:true, why:reasons.join(" / ")};
  },

  required(p, ctx){
    const d = p.filing.plan_submission_date || p.project.permit_expected_date;
    const row = ctx.pickByDate(PUBLIC_SCHEDULE, d);
    if(!row) throw new MissingRuleError(`공급의무비율 규칙 없음 @ ${d}`);
    return { pct: row.pct, basisDate:d,
             prov:`신재생법 시행령 §15 / 기준일 ${d}` };
  }
},

/* --- R2. 지자체 녹색건축물 설계기준 ------------------------- */
{
  id:"LOCAL_GREEN",
  name:"지자체 녹색건축물 설계기준",
  basis:"시·도 고시",
  calc:"RATIO_CORRECTED",
  blocksPermit:true,
  leadDays:0,

  test(p, ctx){
    const std = LOCAL_STANDARDS[p.location.sido];
    if(!std) return {apply:false, unknown:true,
      why:`${p.location.sido} 규칙 미등록 — 수동 검토 필요`};
    if(!ctx.espReportRequired(p))
      return {apply:false, why:"에너지절약계획서 제출대상 아님(연면적 500㎡ 미만 등)"};
    return {apply:true, why:`${std.name} 적용 / 에너지절약계획서 제출대상`};
  },

  required(p, ctx){
    const std = LOCAL_STANDARDS[p.location.sido];
    const d   = p.project.permit_expected_date;
    const row = ctx.pickByDate(std.ratios, d);
    if(!row) throw new MissingRuleError(`${p.location.sido} 비율 규칙 없음 @ ${d}`);

    const isPublic = PUBLIC_CLIENT_TYPES.includes(p.client.type);
    const resMode  = ctx.isResidentialDominant(p);
    const key      = resMode ? "res" : "non";

    if(isPublic) return { pct: row.public[key], grade:"공공", basisDate:d,
                          prov:`${std.basis} / 기준일 ${d}` };

    /* 등급 산정 */
    const size  = resMode ? ctx.totalHouseholds(p) : ctx.totalGfa(p);
    const table = resMode ? std.gradeBySize.residential
                          : std.gradeBySize.nonResidential;
    let grade = table.find(g=>size>=g.min).grade;
    const trace = [`기본등급 [${grade}] (규모 ${size})`];

    /* 행위유형에 따른 등급 조정 */
    const A = p.action.primary;
    if(A==="full_renovation"){
      const i = std.grades.indexOf(grade);
      grade = std.grades[Math.min(i+1, std.grades.length-1)];
      trace.push(`전면대수선 → 1단계 하향 → [${grade}]`);
    } else if(["partial_extension","use_change","minor_alteration",
               "partial_reconstruction","register_change"].includes(A)){
      grade = "라";
      trace.push(`${A} → 규모 무관 [라]등급 적용`);
    }

    if(grade==="라" || row[grade]===null)
      return { pct:0, grade, basisDate:d, trace,
               note:"[라]등급 — 신재생 의무비율 없음. 단열·창호·LED·대기전력차단 등 항목만 적용.",
               prov:`${std.basis} / 기준일 ${d}` };

    return { pct: row[grade][key], grade, basisDate:d, trace,
             prov:`${std.basis} / 기준일 ${d}` };
  },

  /* 서울 재생열 부가의무 */
  extra(p, ctx, req){
    const std = LOCAL_STANDARDS[p.location.sido];
    if(!std || !std.renewableHeat) return null;
    const rh = std.renewableHeat;
    if(ctx.isResidentialDominant(p)) return null;
    if(ctx.totalGfa(p) < rh.minGfaNonRes) return null;
    return {
      id:"RENEWABLE_HEAT",
      name:"재생열(지열·수열) 의무",
      rule:`신재생 의무량의 ${rh.ratioOfRequired*100}% 이상을 지열·수열로 공급 ` +
           `(또는 지하개발면적의 ${rh.altUndergroundRatio*100}% 이상 지열 설치)`,
      shareOfRequired: rh.ratioOfRequired
    };
  }
},

/* --- R3. 에너지사용계획 협의 -------------------------------- */
{
  id:"ESP_CONSULT",
  name:"에너지사용계획 협의",
  basis:"에너지이용 합리화법 §10",
  authority:"산업통상자원부 / 한국에너지공단",
  calc:"RATIO_TOE_RAW",          // ★ 보정계수 미적용
  blocksPermit:false,
  leadDays:90,

  test(p, ctx){
    const pub = PUBLIC_CLIENT_TYPES.includes(p.client.type);
    const th  = pub ? ESP_THRESHOLD.public : ESP_THRESHOLD.private;
    const e   = p.energy_forecast;
    const hitToe = e.fuel_toe_y  >= th.toe;
    const hitKwh = e.elec_kwh_y  >= th.kwh;
    if(!hitToe && !hitKwh)
      return {apply:false,
        why:`규모 미달 (연료 ${e.fuel_toe_y}/${th.toe} toe, 전력 ${e.elec_kwh_y}/${th.kwh} kWh)`};
    return {apply:true,
      why:`${pub?"공공":"민간"} 기준 초과 ` +
          `(${hitToe?`연료 ${e.fuel_toe_y}toe`:""}${hitToe&&hitKwh?", ":""}${hitKwh?`전력 ${e.elec_kwh_y}kWh`:""})`};
  },

  required(p, ctx){
    const ov = p.overrides && p.overrides.esp_review_target_pct;
    return {
      pct: ov != null ? ov : ESP_THRESHOLD.defaultTargetPct,
      basisDate: p.project.permit_expected_date,
      overridden: ov != null,
      note: ov != null
        ? `심의 반영값 ${ov}% 적용 (사유: ${p.overrides.override_reason||"미기재"})`
        : ESP_THRESHOLD.note,
      warn: "toe 실물 기준(보정계수 미적용). 이용률 높은 설비(연료전지·지열)가 유리.",
      prov: "에너지이용합리화법 §10 / 협의 검토기준"
    };
  }
},

/* --- R4. ZEB 의무화 ----------------------------------------- */
{
  id:"ZEB",
  name:"제로에너지건축물(ZEB) 의무화",
  basis:"녹색건축물 조성 지원법 / 건축물의 에너지절약설계기준",
  calc:"RATIO_ZEB",
  blocksPermit:true,
  leadDays:0,

  test(p, ctx){
    if(p.action.primary!=="new")
      return {apply:false, why:"신축 아님 (증축·대수선은 원칙적 비대상, 개별 확인 필요)"};
    const pub   = PUBLIC_CLIENT_TYPES.includes(p.client.type);
    const scope = pub ? "public" : "private";
    const d     = p.project.permit_expected_date;
    const gfa   = ctx.totalGfa(p), hh = ctx.totalHouseholds(p);
    const cands = ZEB_MANDATE.filter(m=>m.scope===scope && m.from<=d)
      .filter(m=>(m.minGfa && gfa>=m.minGfa) || (m.minHouse && hh>=m.minHouse));
    if(!cands.length) return {apply:false, why:`${scope} 규모 기준 미달 (연면적 ${gfa}㎡, ${hh}세대)`};
    const best = cands.sort((a,b)=>a.grade-b.grade)[0];
    return {apply:true, why:`${scope} / ${best.grade}등급 ${best.note||""}`.trim(),
            _grade:best.grade};
  },

  required(p, ctx, t){
    const g = ZEB_GRADE.find(x=>x.grade===t._grade);
    return { pct: g.min, zebGrade:t._grade,
             note:`ZEB ${t._grade}등급 = 에너지자립률 ${g.min}%${g.max?`~${g.max}%`:" 이상"}`,
             needsInput:"1차에너지소요량 입력 필요",
             prov:"ZEB 로드맵 / 에너지절약설계기준" };
  }
},

/* --- R5. 환경영향평가 (정보성) ------------------------------ */
{
  id:"EIA",
  name:"환경영향평가 (심의기준 별도 적용)",
  basis:"환경영향평가법 / 시·도 조례",
  calc:"INFO_ONLY",
  blocksPermit:true,
  leadDays:120,

  test(p, ctx){
    if(p.location.sido!=="서울특별시")
      return {apply:false, unknown:true, why:"서울 외 지역 — 해당 시·도 조례 확인 필요"};
    const gfa=ctx.totalGfa(p);
    if(gfa>=EIA_SEOUL.gfa)
      return {apply:true, why:`연면적 ${gfa}㎡ ≥ ${EIA_SEOUL.gfa}㎡`};
    if(p.location.redevelopment_zone && p.location.project_area>=EIA_SEOUL.redevelopArea)
      return {apply:true, why:`정비사업 면적 ${p.location.project_area}㎡ ≥ ${EIA_SEOUL.redevelopArea}㎡`};
    return {apply:false, why:"대상 규모 미달"};
  },
  required(){ return { pct:null,
    note:"심의기준상 신재생·연료전지·비전기식 냉방 등 추가요건 존재. 개별 협의 필요.",
    prov:"서울특별시 환경영향평가 심의기준" }; }
},

/* --- R6. 에너지절약계획서 (정보성) --------------------------- */
{
  id:"ESAVE_REPORT",
  name:"에너지절약계획서 제출",
  basis:"녹색건축물 조성 지원법 §14",
  calc:"INFO_ONLY",
  blocksPermit:true, leadDays:0,
  test(p,ctx){
    return ctx.espReportRequired(p)
      ? {apply:true, why:`연면적 ${ctx.totalGfa(p)}㎡ ≥ 500㎡`}
      : {apply:false, why:"연면적 500㎡ 미만"};
  },
  required(){ return {pct:null, note:"EPI 및 성능기준 별도 검토",
                      prov:"녹색건축물 조성 지원법 §14"}; }
}
];
