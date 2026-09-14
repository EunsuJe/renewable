/* =========================================================================
 * autofill.js — "설계개요" 표(텍스트/OCR) → 입력폼 값 자동 인식
 * 순수 파싱 로직만 포함 (DOM 접근 없음, Node에서도 단위테스트 가능)
 * ========================================================================= */

const CANONICAL_SIDO = {
  "서울특별시": "서울특별시", "서울시": "서울특별시", "서울": "서울특별시",
  "부산광역시": "부산광역시", "부산시": "부산광역시", "부산": "부산광역시",
  "대구광역시": "대구광역시", "대구시": "대구광역시", "대구": "대구광역시",
  "인천광역시": "인천광역시", "인천시": "인천광역시", "인천": "인천광역시",
  "광주광역시": "광주광역시", "광주시": "광주광역시", "광주": "광주광역시",
  "대전광역시": "대전광역시", "대전시": "대전광역시", "대전": "대전광역시",
  "울산광역시": "울산광역시", "울산시": "울산광역시", "울산": "울산광역시",
  "세종특별자치시": "세종특별자치시", "세종시": "세종특별자치시", "세종": "세종특별자치시",
  "경기도": "경기도", "경기": "경기도",
  "강원특별자치도": "강원특별자치도", "강원도": "강원특별자치도", "강원": "강원특별자치도",
  "충청북도": "충청북도", "충북": "충청북도",
  "충청남도": "충청남도", "충남": "충청남도",
  "전북특별자치도": "전북특별자치도", "전라북도": "전북특별자치도", "전북": "전북특별자치도",
  "전라남도": "전라남도", "전남": "전라남도",
  "경상북도": "경상북도", "경북": "경상북도",
  "경상남도": "경상남도", "경남": "경상남도",
  "제주특별자치도": "제주특별자치도", "제주도": "제주특별자치도", "제주": "제주특별자치도"
};

const KNOWN_SIDO = Object.keys(CANONICAL_SIDO).sort((a, b) => b.length - a.length);

const KNOWN_LABELS = [
  "사업명", "사업 명", "공사명",
  "대지위치", "대지 위치", "지역지구", "지역·지구", "용도지역",
  "대지면적", "도로현황", "도로 현황",
  "주용도", "용도", "층수", "층 수", "높이",
  "건축면적", "지상연면적", "지하연면적", "전체연면적", "합계연면적", "연면적 합계", "연면적",
  "용적률산정연면적", "용적률 산정용 연면적",
  "건폐율", "용적률", "조경면적",
  "주차", "주차대수", "주차 대수",
  "건축주", "시행자", "사업주체",
  "세대수", "세 대 수",
  "공사기간", "공사 기간"
];

function normalizeSido(sido) {
  return CANONICAL_SIDO[String(sido ?? "").trim()] ?? sido;
}

/** 라벨 글자 사이 공백 허용. 라벨 자체의 공백은 제거 */
function labelSrc(label) {
  return String(label)
    .replace(/\s+/g, "")
    .split("")
    .map(ch => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s*");
}

const NEXT_LABEL_RE = new RegExp(
  `\\s+(?=(?:${KNOWN_LABELS.map(labelSrc).sort((a, b) => b.length - a.length).join("|")})(?![가-힣A-Za-z]))`
);

function trimAtNextLabel(value) {
  return String(value ?? "").split(NEXT_LABEL_RE)[0].trim();
}

/** 라벨 앞뒤 경계를 확인해서 "지상연면적" 안의 "연면적" 오인식을 방지 */
function findLine(text, label) {
  const re = new RegExp(
    `(?:^|[^가-힣A-Za-z0-9])${labelSrc(label)}(?![가-힣A-Za-z])\\s*[:：]?\\s*([^\\n]+)`,
    "m"
  );
  const m = String(text ?? "").match(re);
  return m ? trimAtNextLabel(m[1]) : null;
}

/** 문자열에서 첫 숫자 파싱 */
function firstNumber(str) {
  if (!str) return null;
  const m = String(str).match(/[-+]?\d[\d,]*(?:\.\d+)?/);
  if (!m) return null;
  const v = parseFloat(m[0].replace(/,/g, ""));
  return Number.isFinite(v) ? v : null;
}

function extractNumericField(text, label) {
  const line = findLine(text, label);
  if (!line) return null;
  return { raw: line, value: firstNumber(line) };
}

function findSidoInLine(line) {
  const hits = KNOWN_SIDO
    .map(s => ({ s, idx: line.indexOf(s) }))
    .filter(x => x.idx >= 0)
    .sort((a, b) => a.idx - b.idx || b.s.length - a.s.length);
  return hits[0]?.s ?? null;
}

/* ---------- 개별 필드 추출기 ---------- */

function extractSiteLocation(text) {
  const line = findLine(text, "대지위치") || findLine(text, "대지 위치");
  if (!line) return null;

  const rawSido = findSidoInLine(line);
  if (!rawSido) return { raw: line, sido: null, sigungu: null };

  const sido = normalizeSido(rawSido);
  const rest = line.slice(line.indexOf(rawSido) + rawSido.length);
  const m = rest.match(/\s*([가-힣]{1,12}(?:특례시|시|군|구))/);
  const sigungu = m ? m[1] : null;

  return { raw: line, sido, sigungu };
}

function extractFloorsRange(text) {
  const line = findLine(text, "층수") || findLine(text, "층 수");
  if (!line) return null;

  const above = line.match(/지상\s*(\d+)\s*층/);
  const below = line.match(/지하\s*(\d+)\s*층/);

  return {
    raw: line,
    above: above ? parseInt(above[1], 10) : null,
    below: below ? parseInt(below[1], 10) : null
  };
}

function extractUse(text) {
  const line = findLine(text, "주용도") || findLine(text, "용도");
  if (!line) return null;

  let guess = line.split(/\s*(?:중|,|\()/)[0].trim();

  const specific = line.match(/(데이터센터|IDC|오피스텔|기숙사|도시형생활주택|주상복합아파트|주상복합|공동주택|아파트|연립주택|다세대주택)/);
  if (specific) {
    const v = specific[1];
    if (/아파트|연립주택|다세대주택/.test(v) && !/주상복합/.test(v)) guess = "공동주택";
    else guess = v;
  }

  return { raw: line, guess };
}

function inferHouseSubtype(useGuess) {
  const s = String(useGuess ?? "");
  if (/도시형생활주택/.test(s)) return "도시형생활주택";
  if (/주상복합/.test(s)) return "주상복합아파트";
  if (/공동주택|아파트|연립|다세대/.test(s)) return "공동주택(사업계획승인)";
  return "비주거/기타";
}

function extractParking(text) {
  const direct = findLine(text, "주차대수") || findLine(text, "주차 대수");
  if (direct) return { plan: direct, legal: null };

  const idx = String(text).search(/주\s*차/);
  if (idx < 0) return null;

  const tail = String(text).slice(idx, idx + 500);
  const plan = tail.match(/계\s*획\s*[:：]?\s*([^\n]+)/);
  const legal = tail.match(/법\s*정\s*[:：]?\s*([^\n]+)/);

  return {
    plan: plan ? trimAtNextLabel(plan[1]) : null,
    legal: legal ? trimAtNextLabel(legal[1]) : null
  };
}

/** 층별 면적표 행 파싱 */
function extractFloorTable(text) {
  const re = /(지상|지하)\s*(\d+)\s*층\s+([\d,\.]+)\s*(?:㎡|m2|m²|m\^2)?\s*([^\n]*)/g;
  const rows = [];
  let m;

  while ((m = re.exec(text))) {
    const area = parseFloat(m[3].replace(/,/g, ""));
    if (!Number.isFinite(area)) continue;

    rows.push({
      side: m[1],
      floor: parseInt(m[2], 10),
      area,
      use: (m[4] || "").trim()
    });
  }

  return rows;
}

function extractTitle(text) {
  const re = /^(.{2,40}?)\s*(?:\||\t| {2,})\s*도\s*면\s*명/m;
  const m = String(text).match(re);
  return m ? m[1].trim() : null;
}

function extractProjName(text) {
  const line = findLine(text, "공사명") || findLine(text, "사업명") || findLine(text, "사업 명");
  if (line) return { raw: line, value: line };
  return null;
}

function extractOwnerName(text) {
  const line = findLine(text, "건축주") || findLine(text, "시행자") || findLine(text, "사업주체");
  if (!line) return null;

  const value = line.split(/[\(\uff08]/)[0].trim();
  return { raw: line, value };
}

function extractUnitsTotal(text) {
  const line = findLine(text, "세대수") || findLine(text, "세 대 수");
  if (line) {
    const n = firstNumber(line);
    if (n != null) return { raw: line, value: n };
  }

  const m = String(text).match(/총\s*([\d,]+)\s*세대/);
  if (m) return { raw: m[0], value: parseFloat(m[1].replace(/,/g, "")) };

  return null;
}

function extractPermitHint(text) {
  const m = String(text).match(/(사업계획\s*승인|건축\s*허가)[^\n]{0,40}/);
  return m ? { raw: m[0].trim(), value: m[0].trim() } : null;
}

function extractConstructionPeriod(text) {
  const line = findLine(text, "공사기간") || findLine(text, "공사 기간");
  if (!line) return null;

  const dateRe = /(\d{4})\s*(?:[.\-/년])\s*(\d{1,2})(?:\s*(?:[.\-/월])\s*(\d{1,2}))?/g;
  const matches = [...line.matchAll(dateRe)];

  if (matches.length < 2) return { raw: line, start: null, comp: null };

  const toIso = (m) => {
    const y = m[1];
    const mo = String(m[2]).padStart(2, "0");
    const d = String(m[3] || "1").padStart(2, "0");
    return `${y}-${mo}-${d}`;
  };

  return {
    raw: line,
    start: toIso(matches[0]),
    comp: toIso(matches[1])
  };
}

/* ---------- 메인 파서 ---------- */

export function parseOverviewText(text) {
  const t = String(text || "").replace(/\r/g, "");
  const fields = [];
  const infoOnly = [];
  const warnings = [];

  const title = extractTitle(t);

  const projName = extractProjName(t);
  if (projName) {
    fields.push({
      key: "proj_name",
      label: "사업명·공사명 (proj_name)",
      target: "#proj_name",
      value: projName.value,
      raw: projName.raw,
      confidence: "high"
    });
  } else if (title) {
    fields.push({
      key: "proj_name",
      label: "사업명·공사명 (proj_name, 도면 타이틀 추정)",
      target: "#proj_name",
      value: title,
      raw: title,
      confidence: "mid"
    });
  }

  const loc = extractSiteLocation(t);
  if (loc) {
    if (loc.sido) {
      fields.push({
        key: "sido",
        label: "시·도 (site_addr 분리)",
        target: "#sido",
        value: loc.sido,
        raw: loc.raw,
        confidence: "high"
      });
    }

    if (loc.sigungu) {
      fields.push({
        key: "sigungu",
        label: "시·군·구 (site_addr 분리)",
        target: "#sigungu",
        value: loc.sigungu,
        raw: loc.raw,
        confidence: "high"
      });
    }

    if (!loc.sido) warnings.push(`"대지위치"는 찾았지만 시·도명을 인식하지 못했습니다: "${loc.raw}"`);
  }

  const siteArea = extractNumericField(t, "대지면적");
  if (siteArea && siteArea.value != null) {
    fields.push({
      key: "site_area",
      label: "대지면적 (site_area → 사업지역 면적 참고)",
      target: "#project_site_area",
      value: siteArea.value,
      raw: siteArea.raw,
      confidence: "high"
    });
  }

  const floors = extractFloorsRange(t);
  if (floors) {
    if (floors.above != null) {
      fields.push({
        key: "floors_above",
        label: "지상 층수 (floors_above)",
        target: "#floors_above",
        value: floors.above,
        raw: floors.raw,
        confidence: "high"
      });
    }

    if (floors.below != null) {
      infoOnly.push({
        label: "지하 층수 (floors_below)",
        value: `${floors.below}층`,
        note: "입력폼에 별도 필드 없음(참고용)"
      });
    }
  }

  const aboveArea = extractNumericField(t, "지상연면적");
  const belowArea = extractNumericField(t, "지하연면적");
  const totalArea =
    extractNumericField(t, "전체연면적") ||
    extractNumericField(t, "합계연면적") ||
    extractNumericField(t, "연면적 합계") ||
    extractNumericField(t, "연면적");

  const gfaFar =
    extractNumericField(t, "용적률산정연면적") ||
    extractNumericField(t, "용적률 산정용 연면적");

  const floorRows = extractFloorTable(t);
  const sumBySide = (side) =>
    floorRows.filter(r => r.side === side).reduce((s, r) => s + r.area, 0);

  const aboveSum = sumBySide("지상");
  const belowSum = sumBySide("지하");

  const aboveVal = aboveArea?.value != null ? aboveArea.value : (aboveSum || null);
  const belowVal = belowArea?.value != null ? belowArea.value : (belowSum || null);
  const gfaTotalVal =
    totalArea?.value != null
      ? totalArea.value
      : (aboveVal != null && belowVal != null ? aboveVal + belowVal : aboveVal);

  if (gfaTotalVal != null) {
    fields.push({
      key: "gfa_total",
      label: "연면적 합계 (gfa_total)",
      target: "#gfa_total",
      value: gfaTotalVal,
      raw: totalArea ? totalArea.raw : `지상 ${aboveVal ?? "-"} + 지하 ${belowVal ?? "-"}`,
      confidence: totalArea ? "high" : (aboveVal != null ? "mid" : "low"),
      note: "gfa_hvac(냉난방면적)에도 동일 값이 기본 제시됩니다. 설계값으로 보정하세요."
    });
  }

  if (belowVal != null) {
    fields.push({
      key: "basementArea",
      label: "지하연면적 (basementArea, 지하개발 참고)",
      target: "#basementArea",
      value: belowVal,
      raw: belowArea ? belowArea.raw : `층별표 지하 합계 ${belowVal}`,
      confidence: "mid"
    });
  }

  if (gfaFar && gfaFar.value != null) {
    infoOnly.push({
      label: "용적률 산정 연면적 (gfa_far)",
      value: `${gfaFar.value.toLocaleString()}㎡`,
      note: "임계치 판정에는 gfa_total을 사용합니다. gfa_far은 참고용."
    });
  }

  const use = extractUse(t);
  let houseGuessFromUse = null;

  if (use) {
    fields.push({
      key: "useMixGuess",
      label: "주용도 (use_main → use_code_list)",
      target: "#useMix",
      value: use.guess,
      raw: use.raw,
      confidence: "mid",
      note: "실행 시 자동으로 표준 용도명(별표1)으로 보정을 시도합니다. 복합용도는 직접 줄을 추가하세요."
    });

    houseGuessFromUse = inferHouseSubtype(use.guess);

    if (houseGuessFromUse === "비주거/기타") {
      fields.push({
        key: "units_total_guess",
        label: "총 세대수 (units_total, 비주거 추정 0)",
        target: "#units_total",
        value: 0,
        raw: use.raw,
        confidence: "low"
      });
    }

    fields.push({
      key: "house_subtype_guess",
      label: "주택 세부유형 (house_subtype, 용도 기반 추정)",
      target: "#house_subtype",
      value: houseGuessFromUse,
      raw: use.raw,
      confidence: houseGuessFromUse === "비주거/기타" ? "low" : "mid",
      note: "도시형생활주택/주상복합 여부는 직접 확인·수정하세요."
    });
  }

  const units = extractUnitsTotal(t);
  if (units && units.value != null) {
    fields.push({
      key: "units_total",
      label: "총 세대수 (units_total)",
      target: "#units_total",
      value: units.value,
      raw: units.raw,
      confidence: "high",
      note: "세대·호실 혼용 주의(오피스텔은 호실일 수 있음)"
    });

    fields.push({
      key: "house_subtype_hint",
      label: "주택 세부유형 (house_subtype, 세대수 인식으로 추정)",
      target: "#house_subtype",
      value: houseGuessFromUse && houseGuessFromUse !== "비주거/기타"
        ? houseGuessFromUse
        : "공동주택(사업계획승인)",
      raw: units.raw,
      confidence: "low",
      note: "도시형생활주택/주상복합 여부는 직접 확인·수정하세요."
    });
  }

  const owner = extractOwnerName(t);
  if (owner) {
    fields.push({
      key: "owner_name",
      label: "건축주·시행자 (owner_name)",
      target: "#owner_name",
      value: owner.value,
      raw: owner.raw,
      confidence: "high",
      note: "발주주체 구분(owner_type)은 이 값을 참고해 추정되며, STEP2에서 반드시 확정하세요."
    });
  }

  const permitHint = extractPermitHint(t);
  if (permitHint) {
    const track = /사업계획\s*승인/.test(permitHint.value) ? "주택법" : "건축법";
    fields.push({
      key: "permit_track",
      label: "인허가 유형 (permit_track, permit_hint 기반 추정)",
      target: "#permit_track",
      value: track,
      raw: permitHint.raw,
      confidence: "mid",
      note: "반드시 사용자가 확정해야 합니다."
    });
  }

  const nameForGuess = (projName && projName.value) || title || "";
  if (nameForGuess) {
    let guessType = null;

    if (/리모델링|대수선/.test(nameForGuess)) guessType = "전면 대수선(리모델링)";
    else if (/별동\s*증축/.test(nameForGuess)) guessType = "별동증축";
    else if (/재축/.test(nameForGuess)) guessType = "재축";
    else if (/증축/.test(nameForGuess)) guessType = "수평증축";
    else if (/개축/.test(nameForGuess)) guessType = "개축";
    else if (/신축/.test(nameForGuess)) guessType = "신축";

    if (guessType) {
      fields.push({
        key: "project_type",
        label: "사업유형 (project_type, proj_name 키워드 추정)",
        target: "#project_type",
        value: guessType,
        raw: nameForGuess,
        confidence: "mid",
        note: "반드시 사용자가 확정해야 합니다."
      });
    }
  }

  const period = extractConstructionPeriod(t);
  if (period) {
    if (period.start) {
      fields.push({
        key: "date_start",
        label: "착공예정일 (date_start)",
        target: "#date_start",
        value: period.start,
        raw: period.raw,
        confidence: "mid"
      });
    }

    if (period.comp) {
      fields.push({
        key: "date_use_inspect",
        label: "사용검사 신청예정일 (date_use_inspect, 준공예정일 추정)",
        target: "#date_use_inspect",
        value: period.comp,
        raw: period.raw,
        confidence: "low",
        note: "준공예정일과 사용검사 신청예정일은 다를 수 있습니다. 확인 후 보정하세요."
      });
    }
  }

  const bcr = extractNumericField(t, "건폐율");
  const far = extractNumericField(t, "용적률");
  const landscape = extractNumericField(t, "조경면적");
  const zoning = findLine(t, "지역지구") || findLine(t, "용도지역") || findLine(t, "지역·지구");
  const road = findLine(t, "도로현황") || findLine(t, "도로 현황");
  const parking = extractParking(t);

  if (parking && parking.plan) {
    const n = firstNumber(parking.plan);
    if (n != null) {
      fields.push({
        key: "parking_count",
        label: "주차대수 계획 (parking_count)",
        target: "#parking_count",
        value: n,
        raw: parking.plan,
        confidence: "mid"
      });
    }
  }

  if (bcr && bcr.value != null) infoOnly.push({ label: "건폐율", value: `${bcr.value}%`, note: "입력폼에 필드 없음(참고용)" });
  if (far && far.value != null) infoOnly.push({ label: "용적률", value: `${far.value}%`, note: "입력폼에 필드 없음(참고용)" });
  if (landscape && landscape.value != null) infoOnly.push({ label: "조경면적", value: `${landscape.value}㎡`, note: "입력폼에 필드 없음(참고용)" });
  if (zoning) infoOnly.push({ label: "용도지역·지구 (zone_district)", value: zoning, note: "정비구역·지구단위계획 문구는 STEP2 C.입지에서 별도 확인하세요." });
  if (road) infoOnly.push({ label: "도로현황", value: road, note: "입력폼에 필드 없음(참고용)" });
  if (parking && (parking.plan || parking.legal)) {
    infoOnly.push({
      label: "주차계획/법정 원문",
      value: `계획 ${parking.plan ?? "-"} / 법정 ${parking.legal ?? "-"}`,
      note: "주차구획 면적(㎡)은 OCR로 채워지지 않습니다 — parking_stall_area는 STEP2에서 대수×12.5㎡ 추정 후 실측값으로 보정하세요."
    });
  }

  if (!fields.length) {
    warnings.push("인식된 항목이 없습니다. 라벨(대지위치/대지면적/층수/지상연면적/세대수/건축주 등)이 포함된 텍스트인지 확인하세요.");
  }

  warnings.push("owner_type(발주주체 구분)·gfa_hvac(냉난방면적)·parking_stall_area(주차구획 면적)·입지(교육환경보호구역 등 외부조회)·행위유형 확정은 OCR로 채워지지 않아 STEP2에서 직접 확인·입력해야 합니다.");

  return { fields, infoOnly, floorTable: floorRows, warnings };
}

export default { parseOverviewText };
