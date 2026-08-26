/* =========================================================================
 * certRules.js — 인허가·인증 항목 적용판정 로직
 * certifications.js(Notion "인증개요" DB 원문)를 기반으로,
 * 화면 입력값(ctx)을 받아 각 항목의 대상 여부를 판정합니다.
 *
 * 판정 결과 status:
 *   "apply"     — 조건 충족 확인됨 → 대상
 *   "not_apply" — 조건 불충족 확인됨 → 비대상
 *   "check"     — 자동판정에 필요한 정보가 부족하거나, 세부 조항 확인이
 *                 필요함 → 수동 확인 필요 (임의로 대상/비대상을 단정하지 않음)
 * ========================================================================= */

const sumUse = (rows, names) =>
  rows.filter(r => names.includes(r.use)).reduce((s, r) => s + r.area, 0);

const isHousingType = (housingType) => housingType !== "비주거/기타";

/* ---------------------------------------------------------------------- */

export const CERT_RULES = {

  /* 1. 에너지절약형 친환경주택의 건설기준 */
  GREEN_HOME_ENERGY(ctx) {
    const { housingType, households } = ctx;
    if (!isHousingType(housingType))
      return { status: "not_apply", reasons: ["비주거·기타 → 사업계획승인 대상 공동주택이 아님"] };

    const need = { "공동주택(사업계획승인)": 30, "도시형생활주택": 50, "주상복합아파트": 300 }[housingType];
    if (households >= need)
      return { status: "apply", reasons: [`${housingType} ${households}세대 ≥ ${need}세대 기준 충족`] };
    return { status: "not_apply", reasons: [`${housingType} ${households}세대 < ${need}세대 기준 미달`] };
  },

  /* 2. 건강친화형 주택 건설기준 */
  HEALTHY_HOME(ctx) {
    const { housingType, households } = ctx;
    if (!isHousingType(housingType))
      return { status: "not_apply", reasons: ["비주거·기타 → 공동주택 아님"] };
    if (households >= 500)
      return { status: "apply", reasons: [`${households}세대 ≥ 500세대`] };
    return { status: "not_apply", reasons: [`${households}세대 < 500세대`] };
  },

  /* 3. 범죄예방 건축기준(CPTED) */
  CPTED(ctx) {
    const { rows, housingType, cptedResiTypes, cptedNeighborhood, cptedLodging } = ctx;
    const hits = [];
    if (isHousingType(housingType) || cptedResiTypes)
      hits.push("공동주택계열(다세대·아파트·연립·다가구주택 등)");
    if (cptedNeighborhood) hits.push("제1·2종 근린생활시설(일용품 소매점·다중생활시설)");
    if (cptedLodging) hits.push("숙박시설(다중생활시설)");

    const ambiguous = [];
    if (sumUse(rows, ["문화 및 집회시설"]) > 0) ambiguous.push("문화 및 집회시설(동·식물원 제외 — 세부 확인 필요)");
    if (sumUse(rows, ["교육연구시설"]) > 0) ambiguous.push("교육연구시설(연구소·도서관 제외 — 세부 확인 필요)");
    if (sumUse(rows, ["노유자시설"]) > 0) hits.push("노유자시설");
    if (sumUse(rows, ["수련시설"]) > 0) hits.push("수련시설");
    if (sumUse(rows, ["업무시설"]) > 0) ambiguous.push("업무시설(오피스텔인 경우만 해당 — 세부 확인 필요)");
    if (sumUse(rows, ["숙박시설"]) > 0) ambiguous.push("숙박시설(다중생활시설인 경우만 해당 — 세부 확인 필요)");

    if (hits.length)
      return { status: "apply", reasons: [`해당 용도: ${hits.join(", ")}`, ...(ambiguous.length ? [`추가 확인: ${ambiguous.join(" / ")}`] : [])] };
    if (ambiguous.length)
      return { status: "check", reasons: [`용도 세부조건 확인 필요: ${ambiguous.join(" / ")}`] };
    return { status: "not_apply", reasons: ["대상 용도(공동주택계열·근린생활시설·문화집회·교육연구·노유자·수련·업무(오피스텔)·숙박(다중생활시설)) 미해당"] };
  },

  /* 4. 장수명 주택 건설·인증기준 */
  LONGLIFE_HOUSING(ctx) {
    const { housingType, households } = ctx;
    if (!isHousingType(housingType))
      return { status: "not_apply", reasons: ["비주거·기타 → 공동주택 아님"] };
    if (households >= 1000)
      return { status: "apply", reasons: [`${households}세대 ≥ 1,000세대`] };
    return { status: "not_apply", reasons: [`${households}세대 < 1,000세대`] };
  },

  /* 5. 공동주택 결로 방지를 위한 설계기준 */
  CONDENSATION(ctx) {
    const { housingType, households } = ctx;
    if (!isHousingType(housingType))
      return { status: "not_apply", reasons: ["비주거·기타 → 공동주택 아님"] };
    if (households >= 500)
      return { status: "apply", reasons: [`${households}세대 ≥ 500세대`] };
    return { status: "not_apply", reasons: [`${households}세대 < 500세대`] };
  },

  /* 6. 신·재생에너지 설비 설치의무화 기준 (공공건축물 + 대형주차장) */
  RE_MANDATORY(ctx) {
    const { clientType, totalArea, households, parkingStandalone, parkingArea } = ctx;
    const reasons = [];
    let apply = false;

    if (clientType === "public" && households === 0 && totalArea >= 1000) {
      apply = true;
      reasons.push(`공공 · 비주거 · 연면적 ${totalArea.toLocaleString()}㎡ ≥ 1,000㎡`);
      reasons.push("※ 주택·공동주택·근생1·2종·위험물저장처리·자동차관련·동식물관련·자원순환·발전·공장·창고·국방군사시설은 제외대상이므로 세부 용도 재확인 필요");
    }
    if (parkingStandalone && parkingArea >= 1000) {
      apply = true;
      reasons.push(`주차구획 면적 ${parkingArea.toLocaleString()}㎡ ≥ 1,000㎡ (노상·노외·부설 주차장)`);
    }
    if (!apply)
      return { status: "not_apply", reasons: reasons.length ? reasons : ["공공·비주거·연면적 1,000㎡ 이상 및 대형주차장(1,000㎡ 이상) 조건 모두 미해당"] };
    return { status: "apply", reasons };
  },

  /* 7. 건축물 에너지절약설계기준(EPI) */
  EPI(ctx) {
    const { totalArea } = ctx;
    const greenHome = CERT_RULES.GREEN_HOME_ENERGY(ctx);
    if (totalArea < 500)
      return { status: "not_apply", reasons: [`연면적 ${totalArea.toLocaleString()}㎡ < 500㎡`] };
    if (greenHome.status === "apply")
      return { status: "not_apply", reasons: ["에너지절약형 친환경주택 건설기준 적용대상 → EPI 제출 예외"] };
    return { status: "apply", reasons: [`연면적 ${totalArea.toLocaleString()}㎡ ≥ 500㎡`,
      "단독주택·동식물원 및 건축법시행령 별표1 일부 시설(냉난방 500㎡ 미만)은 제외될 수 있음"] };
  },

  /* 8. 제로에너지건축물 인증(ZEB) */
  ZEB(ctx) {
    const { clientType, actType, housingType, households, totalArea, rows, dormitory, zebGrade4Uses } = ctx;
    const isNewLike = ["신축", "재축", "개축", "별동증축"].includes(actType);
    const reasons = [];
    let apply = false, note = "";

    if (isHousingType(housingType) && households >= 30 && isNewLike && !dormitory) {
      apply = true; note = "공동주택 30세대 이상 (신축·재축·별동증축)";
    } else if (clientType === "public" && (households >= 30 || totalArea >= 500) && isNewLike && !dormitory) {
      apply = true; note = "공공기관 신축·재축·별동증축 (30세대 이상 공동주택 또는 연면적 500㎡ 이상), 기숙사 제외";
    } else if (clientType === "public" && totalArea >= 1000 && rows.some(r => zebGrade4Uses.includes(r.use))) {
      apply = true; note = "공공건축물 연면적 1,000㎡ 이상 · 17개 대상용도 해당 → 4등급 의무";
    }

    if (apply) return { status: "apply", reasons: [note] };
    if (!isHousingType(housingType) && clientType === "private")
      return { status: "check", reasons: ["민간 비주거 → 의무대상은 아니나 지자체별 녹색건축 설계기준(위 3.지자체 설계기준 섹션 참조) 확인 필요",
        "참고: 민간 비주거는 2025.12.31 이후 에너지절약설계기준 개정으로 ZEB5 수준 요구"] };
    if (isHousingType(housingType) && clientType === "private")
      return { status: "check", reasons: ["민간 공동주택 → 지자체별 녹색건축 설계기준 확인 필요",
        "참고: 2025.06.30 이후 에너지절약형 친환경주택 건설기준으로 ZEB5 수준 요구"] };
    return { status: "not_apply", reasons: ["의무 요건(세대수·연면적·용도) 미해당"] };
  },

  /* 9. 녹색건축인증(G-SEED) */
  GSEED(ctx) {
    const { clientType, totalArea, households, housingType, rows, militaryExclude } = ctx;
    if (militaryExclude)
      return { status: "not_apply", reasons: ["국방·군사시설(군부대주둔지 내) → 적용 제외"] };

    const reasons = [];
    let apply = false;

    if (clientType === "public" && sumUse(rows, ["업무시설"]) > 0) {
      apply = true; reasons.push("공공업무시설 → 그린 우수(그린2)등급 이상 의무");
    }
    if (isHousingType(housingType) && households >= 500) {
      apply = true; reasons.push(`공동주택 ${households}세대 ≥ 500세대 → 공동주택성능등급 의무`);
    }
    if (clientType === "public" && totalArea >= 3000) {
      apply = true; reasons.push(`공공건축물 연면적 ${totalArea.toLocaleString()}㎡ ≥ 3,000㎡ 의무`);
    }
    if (apply) return { status: "apply", reasons };

    if (clientType === "private")
      return { status: "check", reasons: ["민간건축물 → 각 지자체별 녹색건축 설계기준 확인 필요(위 3.지자체 설계기준 섹션 참조)"] };
    return { status: "not_apply", reasons: ["공공 의무요건(업무시설/3,000㎡ 이상/500세대 이상) 미해당"] };
  },

  /* 10. 장애물 없는 생활환경 인증(BF인증) */
  BF(ctx) {
    const { siteArea, clientType, actType, ultraHighRise, transportFacility } = ctx;
    const reasons = [];
    let apply = false;

    if (siteArea >= 100000) { apply = true; reasons.push(`사업지역 면적 ${siteArea.toLocaleString()}㎡ ≥ 100,000㎡ → 지역인증 대상`); }
    if (clientType === "public" && ["신축", "재축", "개축", "별동증축"].includes(actType)) {
      apply = true; reasons.push("국가·지자체 신축 등 공공건물/공중이용시설 → 개별시설인증 대상 가능(세부 용도 확인 필요)");
    }
    if (ultraHighRise) { apply = true; reasons.push("초고층·준초고층 또는 지하연계 복합건축물 해당"); }
    if (transportFacility) { apply = true; reasons.push("여객터미널·철도·도시철도·광역철도·환승·공항·항만시설 해당"); }

    if (apply) return { status: "apply", reasons };
    return { status: "check", reasons: ["사업지역 면적·공공시설 여부·초고층/교통시설 해당여부를 추가 확인하세요",
      "(위 입력만으로 단정하기 어려운 항목입니다)"] };
  },

  /* 11. 교육환경평가 */
  EDU_ENV(ctx) {
    const { redevelopmentZone, nearEduFacility, totalArea, floorsAbove } = ctx;
    const reasons = [];
    let apply = false;

    if (redevelopmentZone && nearEduFacility) {
      apply = true; reasons.push("도시정비법 정비구역 + 교육시설 200m 이내");
    }
    if (totalArea >= 100000) { apply = true; reasons.push(`연면적 ${totalArea.toLocaleString()}㎡ ≥ 100,000㎡`); }
    if (floorsAbove >= 21) { apply = true; reasons.push(`지상층수 ${floorsAbove}층 ≥ 21층`); }

    if (apply) return { status: "apply", reasons };
    return { status: "not_apply", reasons: ["정비구역·교육시설 인접, 연면적 10만㎡ 이상, 21층 이상 조건 모두 미해당"] };
  },

  /* 12. 수질오염물질 총량제 */
  WATER_TMDL(ctx) {
    const { redevelopmentZone, households, housingType, rows, watershedTarget } = ctx;
    const reasons = [];
    let apply = false;

    if (redevelopmentZone) { apply = true; reasons.push("도시관리계획/농어촌생활환경정비사업 해당"); }
    if (isHousingType(housingType) && households >= 30) {
      apply = true; reasons.push(`공동주택·주상복합 ${households}세대 ≥ 30세대`);
    }
    const saleArea = sumUse(rows, ["판매 및 영업시설"]);
    if (saleArea >= 15000) { apply = true; reasons.push(`판매용 연면적 ${saleArea.toLocaleString()}㎡ ≥ 15,000㎡`); }
    const officeMixArea = sumUse(rows, ["업무시설"]);
    if (officeMixArea >= 25000) { apply = true; reasons.push(`업무용·복합 연면적 ${officeMixArea.toLocaleString()}㎡ ≥ 25,000㎡`); }
    if (watershedTarget) { apply = true; reasons.push("특정유역 하수배출 시설 또는 환경영향평가 등 대상사업 해당"); }

    if (apply) return { status: "apply", reasons };
    return { status: "not_apply", reasons: ["정비사업·세대수·판매/업무 연면적·특정유역 조건 모두 미해당"] };
  },

  /* 13. 지능형건축물 인증 (자발적) */
  INTELLIGENT_BLDG() {
    return { status: "check", reasons: ["법적 의무대상이 아닌 자발적 인증입니다. 인센티브(용적률 완화 등) 필요 시 신청 검토"] };
  }
};

export function evaluateCert(id, ctx) {
  const fn = CERT_RULES[id];
  if (!fn) return { status: "check", reasons: ["판정 로직 미구현"] };
  try {
    return fn(ctx);
  } catch (e) {
    return { status: "check", reasons: [`판정 오류: ${e.message}`] };
  }
}

export default { CERT_RULES, evaluateCert };
