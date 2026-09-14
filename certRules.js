/* =========================================================================
 * certRules.js — 인허가·인증 항목 적용판정 로직
 * ========================================================================= */

const fmtNum = (n) =>
  Number(n || 0).toLocaleString("ko-KR", { maximumFractionDigits: 1 });

const compactUse = (s) => String(s ?? "").replace(/\s+/g, "");

const sumUse = (rows, names) =>
  (rows || [])
    .filter(r => names.includes(r.use))
    .reduce((s, r) => s + r.area, 0);

const HOUSING_SUBTYPES = new Set([
  "공동주택(사업계획승인)",
  "도시형생활주택",
  "주상복합아파트"
]);

const isHousingSubtype = (houseSubtype) => HOUSING_SUBTYPES.has(houseSubtype);

const NEWLIKE_PROJECT_TYPES = new Set(["신축", "재축", "개축", "별동증축"]);

const RE_EXCLUDED_USES = new Set([
  "공동주택",
  "주거",
  "단독주택",
  "제1종근린생활시설",
  "제2종근린생활시설",
  "위험물저장및처리시설",
  "자동차관련시설",
  "동물및식물관련시설",
  "자원순환관련시설",
  "발전시설",
  "공장",
  "창고시설"
]);

const renewableEligibleRows = (rows = []) =>
  rows.filter(r => !RE_EXCLUDED_USES.has(compactUse(r.use)));

/* ---------------------------------------------------------------------- */

export const CERT_RULES = {
  GREEN_HOME_ENERGY(ctx) {
    const { houseSubtype, unitsTotal } = ctx;

    if (!isHousingSubtype(houseSubtype)) {
      return { status: "not_apply", reasons: ["비주거·기타 → 사업계획승인 대상 공동주택이 아님"] };
    }

    const need = {
      "공동주택(사업계획승인)": 30,
      "도시형생활주택": 50,
      "주상복합아파트": 300
    }[houseSubtype];

    if (unitsTotal >= need) {
      return { status: "apply", reasons: [`${houseSubtype} ${unitsTotal}세대 ≥ ${need}세대 기준 충족`] };
    }

    return { status: "not_apply", reasons: [`${houseSubtype} ${unitsTotal}세대 < ${need}세대 기준 미달`] };
  },

  HEALTHY_HOME(ctx) {
    const { houseSubtype, unitsTotal } = ctx;

    if (!isHousingSubtype(houseSubtype)) {
      return { status: "not_apply", reasons: ["비주거·기타 → 공동주택 아님"] };
    }

    if (unitsTotal >= 500) {
      return { status: "apply", reasons: [`${unitsTotal}세대 ≥ 500세대`] };
    }

    return { status: "not_apply", reasons: [`${unitsTotal}세대 < 500세대`] };
  },

  CPTED(ctx) {
    const { rows, houseSubtype, cptedNeighborhood, cptedLodging } = ctx;
    const hits = [];
    const ambiguous = [];

    if (isHousingSubtype(houseSubtype)) {
      hits.push("공동주택계열(다세대·아파트·연립·다가구주택 등)");
    }

    if (cptedNeighborhood) hits.push("제1·2종 근린생활시설(일용품 소매점·다중생활시설)");
    if (cptedLodging) hits.push("숙박시설(다중생활시설)");

    if (sumUse(rows, ["문화 및 집회시설"]) > 0) ambiguous.push("문화 및 집회시설(동·식물원 제외 — 세부 확인 필요)");
    if (sumUse(rows, ["교육연구시설"]) > 0) ambiguous.push("교육연구시설(연구소·도서관 제외 — 세부 확인 필요)");
    if (sumUse(rows, ["노유자시설"]) > 0) hits.push("노유자시설");
    if (sumUse(rows, ["수련시설"]) > 0) hits.push("수련시설");
    if (sumUse(rows, ["업무시설"]) > 0) ambiguous.push("업무시설(오피스텔인 경우만 해당 — 세부 확인 필요)");
    if (sumUse(rows, ["숙박시설"]) > 0) ambiguous.push("숙박시설(다중생활시설인 경우만 해당 — 세부 확인 필요)");

    if (hits.length) {
      return {
        status: "apply",
        reasons: [
          `해당 용도: ${hits.join(", ")}`,
          ...(ambiguous.length ? [`추가 확인: ${ambiguous.join(" / ")}`] : [])
        ]
      };
    }

    if (ambiguous.length) {
      return { status: "check", reasons: [`용도 세부조건 확인 필요: ${ambiguous.join(" / ")}`] };
    }

    return {
      status: "not_apply",
      reasons: ["대상 용도(공동주택계열·근린생활시설·문화집회·교육연구·노유자·수련·업무(오피스텔)·숙박(다중생활시설)) 미해당"]
    };
  },

  LONGLIFE_HOUSING(ctx) {
    const { houseSubtype, unitsTotal } = ctx;

    if (!isHousingSubtype(houseSubtype)) {
      return { status: "not_apply", reasons: ["비주거·기타 → 공동주택 아님"] };
    }

    if (unitsTotal >= 1000) {
      return {
        status: "apply",
        reasons: [`${unitsTotal}세대 ≥ 1,000세대 → 일반등급 이상 의무(상위등급 목표는 STEP4에서 선택)`]
      };
    }

    return { status: "not_apply", reasons: [`${unitsTotal}세대 < 1,000세대`] };
  },

  CONDENSATION(ctx) {
    const { houseSubtype, unitsTotal } = ctx;

    if (!isHousingSubtype(houseSubtype)) {
      return { status: "not_apply", reasons: ["비주거·기타 → 공동주택 아님"] };
    }

    if (unitsTotal >= 500) {
      return { status: "apply", reasons: [`${unitsTotal}세대 ≥ 500세대`] };
    }

    return { status: "not_apply", reasons: [`${unitsTotal}세대 < 500세대`] };
  },

  RE_MANDATORY(ctx) {
    const { isPublicOwner, gfaTotal, parkingStallArea, parkingKindAny, rows } = ctx;
    const reasons = [];
    let apply = false;
    let needsCheck = false;

    const eligibleRows = renewableEligibleRows(rows);

    if (isPublicOwner && gfaTotal >= 1000 && eligibleRows.length > 0) {
      apply = true;
      reasons.push(`공공(발주주체: ${ctx.ownerType}) · 연면적 ${fmtNum(gfaTotal)}㎡ ≥ 1,000㎡ · 제외대상이 아닌 용도 포함`);
      reasons.push("※ 주택·공동주택·근생1·2종·위험물저장처리·자동차관련·동식물관련·자원순환·발전·공장·창고·국방군사시설은 제외대상이므로 use_code_list 세부 재확인 필요");
    } else if (isPublicOwner && gfaTotal >= 1000 && eligibleRows.length === 0) {
      reasons.push(`공공 · 연면적 ${fmtNum(gfaTotal)}㎡ ≥ 1,000㎡이나, 입력 용도가 주거/제외대상으로 보입니다.`);
      needsCheck = true;
    }

    if (parkingKindAny && parkingStallArea >= 1000) {
      apply = true;
      reasons.push(`주차구획 면적 ${fmtNum(parkingStallArea)}㎡ ≥ 1,000㎡ (노상·노외·부설 주차장)`);
    } else if (!parkingKindAny && parkingStallArea >= 1000) {
      needsCheck = true;
      reasons.push(`주차구획 면적 ${fmtNum(parkingStallArea)}㎡ ≥ 1,000㎡이나 주차장 종류가 선택되지 않았습니다.`);
    }

    if (ctx.applyPreviousLaw) {
      reasons.push(`경과규정 적용 신청 — ${ctx.previousLawVersion || "적용 법령 버전 미기재"}(date_permit_apply 재검토 필요)`);
    }

    if (apply) return { status: "apply", reasons };

    if (needsCheck) {
      return {
        status: "check",
        reasons: reasons.length ? reasons : ["공공건축물/대형주차장 조건 세부 확인 필요"]
      };
    }

    return {
      status: "not_apply",
      reasons: reasons.length ? reasons : ["공공·연면적 1,000㎡ 이상 및 대형주차장(1,000㎡ 이상) 조건 모두 미해당"]
    };
  },

  EPI(ctx) {
    const { gfaHvac, isPermitChange, originalPermitGfa } = ctx;
    const gfaForThreshold = isPermitChange && originalPermitGfa > 0 ? originalPermitGfa : ctx.gfaTotal;
    const greenHome = CERT_RULES.GREEN_HOME_ENERGY(ctx);
    const zeb = CERT_RULES.ZEB(ctx);

    if (gfaForThreshold < 500) {
      return {
        status: "not_apply",
        reasons: [`${isPermitChange ? "당초 허가 연면적(is_permit_change)" : "연면적"} ${fmtNum(gfaForThreshold)}㎡ < 500㎡`]
      };
    }

    if (greenHome.status === "apply") {
      if (ctx.exemptEpiByEcohouse) {
        return {
          status: "not_apply",
          reasons: ["에너지절약형 친환경주택 건설기준 적합 확인(STEP5 exempt_epi_by_ecohouse) → EPI 제출 면제"]
        };
      }

      return {
        status: "check",
        reasons: ["친환경주택 건설기준 의무대상 → EPI 제출 면제 가능성 있음. STEP5에서 exempt_epi_by_ecohouse(근거 성능평가 결과) 확인 필요"]
      };
    }

    if (zeb.status === "apply" || (zeb.status === "check" && ctx.epiReplacedByZeb)) {
      if (ctx.epiReplacedByZeb) {
        return {
          status: "not_apply",
          reasons: ["ZEB 인증 취득 확인(STEP5 epi_replaced_by_zeb) → EPI 별도 제출 갈음"]
        };
      }
    }

    const reasons = [`연면적 ${fmtNum(gfaForThreshold)}㎡ ≥ 500㎡`];

    if (gfaHvac != null && gfaHvac < 500) {
      reasons.push(`냉난방 공간 연면적 ${fmtNum(gfaHvac)}㎡ < 500㎡ — 별표1 제1호·제3호아목·제5호·제13호·제16~17호 해당 시 제출 제외 가능(용도 확인 필요)`);
    }

    reasons.push("단독주택·동·식물원은 제외 대상 (use_code_list로 확인)");

    return { status: "apply", reasons };
  },

  ZEB(ctx) {
    const {
      isPublicOwner,
      projectType,
      houseSubtype,
      unitsTotal,
      gfaTotal,
      rows,
      dormitory,
      zebGrade4Uses
    } = ctx;

    const isNewLike = NEWLIKE_PROJECT_TYPES.has(projectType);
    const hasGrade4Use = (rows || []).some(r => zebGrade4Uses.includes(r.use));

    if (isNewLike && !dormitory) {
      if (isPublicOwner && gfaTotal >= 1000 && hasGrade4Use) {
        return {
          status: "apply",
          reasons: ["공공건축물 신축·재축·개축·별동증축 · 연면적 1,000㎡ 이상 · 17개 대상용도 해당 → 4등급 의무"]
        };
      }

      if (isHousingSubtype(houseSubtype) && unitsTotal >= 30) {
        return {
          status: "apply",
          reasons: [`공동주택계열 ${unitsTotal}세대 ≥ 30세대 · ${projectType} → ZEB 의무`]
        };
      }

      if (isPublicOwner && (unitsTotal >= 30 || gfaTotal >= 500)) {
        return {
          status: "apply",
          reasons: [`공공(${ctx.ownerType}) ${projectType} · 30세대 이상 공동주택 또는 연면적 500㎡ 이상, 기숙사 제외`]
        };
      }
    }

    if (dormitory && isPublicOwner) {
      return { status: "not_apply", reasons: ["기숙사(STEP5 dormitory) → 공공 ZEB 의무 제외"] };
    }

    let checkResult;

    if (!isHousingSubtype(houseSubtype) && !isPublicOwner) {
      checkResult = {
        status: "check",
        reasons: [
          "민간 비주거 → 의무대상은 아니나 지자체별 녹색건축 설계기준 확인 필요",
          "참고: 민간 비주거는 2025.12.31 이후 에너지절약설계기준 개정으로 ZEB5 수준 요구"
        ]
      };
    } else if (isHousingSubtype(houseSubtype) && !isPublicOwner) {
      checkResult = {
        status: "check",
        reasons: [
          "민간 공동주택 → 지자체별 녹색건축 설계기준 확인 필요",
          "참고: 2025.06.30 이후 에너지절약형 친환경주택 건설기준으로 ZEB5 수준 요구"
        ]
      };
    } else {
      return { status: "not_apply", reasons: ["의무 요건(행위유형·세대수·연면적·용도) 미해당"] };
    }

    if (ctx.localOrdinanceApplied) {
      return {
        status: "apply",
        reasons: [
          ...checkResult.reasons,
          `지자체 조례 강화 적용(STEP2 local_ordinance_applied): ${ctx.ordinanceName || "조례명 미기재"} → ${ctx.ordinanceValue || "강화기준 미기재"} → 사실상 의무`
        ]
      };
    }

    return checkResult;
  },

  GSEED(ctx) {
    const { isPublicOwner, gfaTotal, unitsTotal, houseSubtype, rows, militaryExclude } = ctx;

    if (militaryExclude) {
      return { status: "not_apply", reasons: ["국방·군사시설(군부대주둔지 내, STEP5 militaryExclude) → 적용 제외"] };
    }

    const reasons = [];
    let apply = false;

    if (isPublicOwner && sumUse(rows, ["업무시설"]) > 0) {
      apply = true;
      reasons.push(`공공업무시설(${ctx.ownerType}) → 그린 우수(그린2)등급 이상 의무`);
    }

    if (isHousingSubtype(houseSubtype) && unitsTotal >= 500) {
      apply = true;
      reasons.push(`공동주택 ${unitsTotal}세대 ≥ 500세대 → 공동주택성능등급 의무`);
    }

    if (isPublicOwner && gfaTotal >= 3000) {
      apply = true;
      reasons.push(`공공건축물 연면적 ${fmtNum(gfaTotal)}㎡ ≥ 3,000㎡ 의무`);
    }

    if (apply) return { status: "apply", reasons };

    if (!isPublicOwner) {
      const checkReasons = ["민간건축물 → 각 지자체별 녹색건축 설계기준 확인 필요"];

      if (ctx.localOrdinanceApplied) {
        return {
          status: "apply",
          reasons: [
            ...checkReasons,
            `지자체 조례 강화 적용(STEP2 local_ordinance_applied): ${ctx.ordinanceName || "조례명 미기재"} → ${ctx.ordinanceValue || "강화기준 미기재"} → 사실상 의무`
          ]
        };
      }

      return { status: "check", reasons: checkReasons };
    }

    return { status: "not_apply", reasons: ["공공 의무요건(업무시설/3,000㎡ 이상/500세대 이상) 미해당"] };
  },

  BF(ctx) {
    const { projectSiteArea, isPublicOwner, projectType, isHighRiseComplex, transportFacility } = ctx;
    const reasons = [];
    let apply = false;

    if (projectSiteArea >= 100000) {
      apply = true;
      reasons.push(`사업지역 면적 ${fmtNum(projectSiteArea)}㎡ ≥ 100,000㎡ → 지역인증 대상`);
    }

    if (isPublicOwner && NEWLIKE_PROJECT_TYPES.has(projectType)) {
      apply = true;
      reasons.push(`공공주체(${ctx.ownerType}) 신축 등 공공건물/공중이용시설 → 개별시설인증 대상 가능(세부 용도 확인 필요)`);
    }

    if (isHighRiseComplex) {
      apply = true;
      reasons.push("초고층·준초고층 또는 지하연계 복합건축물 해당");
    }

    if (transportFacility) {
      apply = true;
      reasons.push("여객터미널·철도·도시철도·광역철도·환승·공항·항만시설 해당");
    }

    if (apply) return { status: "apply", reasons };

    return {
      status: "check",
      reasons: [
        "사업지역 면적·공공시설 여부·초고층/교통시설 해당여부를 추가 확인하세요",
        "(위 입력만으로 단정하기 어려운 항목입니다)"
      ]
    };
  },

  EDU_ENV(ctx) {
    const { redevDistrict, eduWithin200m, gfaTotal, floorsAbove } = ctx;
    const reasons = [];
    let apply = false;

    if (redevDistrict && eduWithin200m) {
      apply = true;
      reasons.push("도시정비법 정비구역(redev_district) + 교육시설 200m 이내(edu_within_200m)");
    }

    if (gfaTotal >= 100000) {
      apply = true;
      reasons.push(`연면적 ${fmtNum(gfaTotal)}㎡ ≥ 100,000㎡`);
    }

    if (floorsAbove >= 21) {
      apply = true;
      reasons.push(`지상층수 ${floorsAbove}층 ≥ 21층`);
    }

    if (!apply) {
      return { status: "not_apply", reasons: ["정비구역·교육시설 인접, 연면적 10만㎡ 이상, 21층 이상 조건 모두 미해당"] };
    }

    if (ctx.localBldgCommitteeReviewed) {
      return {
        status: "not_apply",
        reasons: [
          ...reasons,
          `지방건축위원회 심의로 갈음(STEP5 local_bldg_committee_reviewed) — 심의일자 ${ctx.committeeReviewDate || "미기재"} / 심의번호 ${ctx.committeeReviewNo || "미기재"} (법제처 유권해석 17-0145 근거) → 평가 대상 제외`
        ]
      };
    }

    return { status: "apply", reasons };
  },

  WATER_TMDL(ctx) {
    const { redevDistrict, unitsTotal, houseSubtype, rows, tmdlBasin, isSpecialArea, eiaTarget } = ctx;
    const reasons = [];
    let apply = false;

    if (redevDistrict) {
      apply = true;
      reasons.push("도시관리계획/농어촌생활환경정비사업 해당(redev_district)");
    }

    if (isHousingSubtype(houseSubtype) && unitsTotal >= 30) {
      apply = true;
      reasons.push(`공동주택·주상복합 ${unitsTotal}세대 ≥ 30세대`);
    }

    const saleArea = sumUse(rows, ["판매 및 영업시설"]);
    if (saleArea >= 15000) {
      apply = true;
      reasons.push(`판매용 연면적 ${fmtNum(saleArea)}㎡ ≥ 15,000㎡`);
    }

    const officeMixArea = sumUse(rows, ["업무시설"]);
    if (officeMixArea >= 25000) {
      apply = true;
      reasons.push(`업무용·복합 연면적 ${fmtNum(officeMixArea)}㎡ ≥ 25,000㎡`);
    }

    if (tmdlBasin) {
      apply = true;
      reasons.push("오염총량관리 수계·지역(tmdl_basin) 해당");
    }

    if (isSpecialArea) {
      apply = true;
      reasons.push("특별대책지역(is_special_area) 해당");
    }

    if (eiaTarget) {
      apply = true;
      reasons.push("환경영향평가 등의 대상사업(eia_target) 해당");
    }

    if (!apply) {
      return {
        status: "not_apply",
        reasons: ["정비사업·세대수·판매/업무 연면적·특정유역·특별대책지역·환경영향평가 조건 모두 미해당"]
      };
    }

    if (ctx.tmdlCoveredByEia) {
      reasons.push("환경영향평가 협의로 갈음 여부 검토 필요(STEP5 tmdl_covered_by_eia) — 별도 제출 갈음 여부는 관할 지자체 확인 필요");
    }

    return { status: "apply", reasons };
  },

  INTELLIGENT_BLDG() {
    return {
      status: "check",
      reasons: ["법적 의무대상이 아닌 자발적 인증입니다. 인센티브(용적률 완화 등) 필요 시 신청 검토"]
    };
  }
};

function appendCommonNotes(id, result, ctx) {
  const baseReasons = Array.isArray(result?.reasons) ? result.reasons : [];
  const extra = [];

  if (ctx.priorCertExists && ["ZEB", "GSEED", "BF", "LONGLIFE_HOUSING", "INTELLIGENT_BLDG"].includes(id)) {
    extra.push(`기존 인증 유효기간 내 재인증 면제 검토(prior_cert_id: ${ctx.priorCertId || "미기재"}, 만료 ${ctx.priorCertExpiry || "미기재"})`);
  }

  if (ctx.applyPreviousLaw && ["ZEB", "RE_MANDATORY"].includes(id)) {
    extra.push(`경과규정 구법 적용 검토(apply_previous_law): ${ctx.previousLawVersion || "적용 법령 버전 미기재"}`);
  }

  return {
    ...result,
    reasons: [...baseReasons, ...extra]
  };
}

export function evaluateCert(id, ctx) {
  const fn = CERT_RULES[id];
  if (!fn) return { status: "check", reasons: ["판정 로직 미구현"] };

  try {
    const base = fn(ctx) || { status: "check", reasons: ["판정 결과 없음"] };
    const safeBase = ["apply", "not_apply", "check"].includes(base.status)
      ? base
      : { status: "check", reasons: [`판정 상태값 오류: ${base.status}`] };

    return appendCommonNotes(id, safeBase, ctx);
  } catch (e) {
    return { status: "check", reasons: [`판정 오류: ${e.message}`] };
  }
}

export default { CERT_RULES, evaluateCert };
