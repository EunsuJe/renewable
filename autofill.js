/* =========================================================================
 * autofill.js — "설계개요" 표(텍스트/OCR) → 입력폼 값 자동 인식
 * 순수 파싱 로직만 포함 (DOM 접근 없음, Node에서도 단위테스트 가능)
 *
 * 국내 건축 설계개요 표는 대체로 다음 라벨을 공통으로 씁니다:
 *   대지위치 / 지역지구 / 대지면적 / 도로현황 / 용도 / 층수 / 높이 /
 *   건축면적 / 지상연면적 / 지하연면적 / 전체연면적 / 용적률산정연면적 /
 *   건폐율 / 용적률 / 조경면적 / 주차(계획/법정)
 * 라벨 뒤에 값이 오는 "라벨 값" 줄 구조를 전제로 정규식을 만듭니다.
 * OCR 특성상 글자 사이에 공백이 끼는 경우(예: "높 이")도 허용합니다.
 * ========================================================================= */

const KNOWN_SIDO = [
  "서울특별시", "부산광역시", "대구광역시", "인천광역시", "광주광역시",
  "대전광역시", "울산광역시", "세종특별자치시", "경기도",
  "강원특별자치도", "강원도", "충청북도", "충청남도",
  "전북특별자치도", "전라북도", "전라남도",
  "경상북도", "경상남도", "제주특별자치도"
];

/** 라벨 글자 사이 공백을 허용하는 정규식 소스 생성 */
function labelSrc(label) {
  return label.split("").map(ch => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*");
}

/** 텍스트에서 "라벨 ... 값" 패턴 1개를 찾아 원문 캡처(줄 단위)
 *  라벨 바로 뒤에 한글이 이어지면(예: "용적률산정") 다른 라벨의 일부이므로 제외 */
function findLine(text, label) {
  const re = new RegExp(labelSrc(label) + "(?![가-힣])\\s*[:：]?\\s*(.+)", "m");
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

/** 문자열에서 숫자(콤마 포함) + 단위(㎡/m²/m2/%) 를 파싱 */
function firstNumber(str) {
  if (!str) return null;
  const m = str.match(/[\d][\d,]*\.?\d*/);
  if (!m) return null;
  const v = parseFloat(m[0].replace(/,/g, ""));
  return isNaN(v) ? null : v;
}

function extractNumericField(text, label) {
  const line = findLine(text, label);
  if (!line) return null;
  return { raw: line, value: firstNumber(line) };
}

/* ---------- 개별 필드 추출기 ---------- */

function extractSiteLocation(text) {
  const line = findLine(text, "대지위치") || findLine(text, "대지 위치");
  if (!line) return null;
  const sido = KNOWN_SIDO.find(s => line.includes(s));
  if (!sido) return { raw: line, sido: null, sigungu: null };
  const rest = line.slice(line.indexOf(sido) + sido.length);
  const m = rest.match(/\s*([가-힣]{1,10}(?:시|군|구))/);
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
  const line = findLine(text, "용도");
  if (!line) return null;
  // "방송통신시설 중 '마목 데이터센터" 같은 부가설명 제거 시도
  let guess = line.split(/\s*(?:중|,|\()/)[0].trim();
  // "~데이터센터" 형태처럼 뒷부분에 더 구체적인 용도명이 있으면 그것을 우선
  const specific = line.match(/(데이터센터|IDC|오피스텔|기숙사|공동주택)/);
  if (specific) guess = specific[1];
  return { raw: line, guess };
}

function extractParking(text) {
  const idx = text.search(/주\s*차/);
  if (idx < 0) return null;
  const tail = text.slice(idx, idx + 400);
  const plan = tail.match(/계\s*획\s*[:：]?\s*([^\n]+)/);
  const legal = tail.match(/법\s*정\s*[:：]?\s*([^\n]+)/);
  return {
    plan: plan ? plan[1].trim() : null,
    legal: legal ? legal[1].trim() : null
  };
}

/** 층별 면적표 행 파싱: "지상10층 729.56㎡ 데이터센터 (서버실)" 등 */
function extractFloorTable(text) {
  const re = /(지상|지하)\s*(\d+)\s*층\s+([\d,\.]+)\s*(?:㎡|m2|m²|m\^2)?\s+([^\n]+)/g;
  const rows = [];
  let m;
  while ((m = re.exec(text))) {
    rows.push({
      side: m[1], floor: parseInt(m[2], 10),
      area: parseFloat(m[3].replace(/,/g, "")),
      use: m[4].trim()
    });
  }
  return rows;
}

function extractTitle(text) {
  // "영등포 금융전산센터 | 도면명 : 설계개요 | 축 척 : NONE | A-007" 형태 하단 타이틀바
  const re = /^(.{2,40}?)\s*(?:\||\t| {2,})\s*도\s*면\s*명/m;
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

/** proj_name(사업명·공사명) — "공사명"/"사업명" 라벨 우선, 없으면 타이틀바 사용 */
function extractProjName(text) {
  const line = findLine(text, "공사명") || findLine(text, "사업명") || findLine(text, "사업 명");
  if (line) return { raw: line, value: line };
  return null;
}

/** owner_name(건축주·시행자) — "건축주"/"시행자"/"사업주체" 라벨 */
function extractOwnerName(text) {
  const line = findLine(text, "건축주") || findLine(text, "시행자") || findLine(text, "사업주체");
  if (!line) return null;
  // 뒷부분에 괄호로 대표자 등이 붙는 경우가 있어 앞부분만 취함
  const value = line.split(/[\(\uff08]/)[0].trim();
  return { raw: line, value };
}

/** units_total(총 세대수) — "세대수" 라벨 또는 "총 ○○세대" 패턴 */
function extractUnitsTotal(text) {
  const line = findLine(text, "세대수") || findLine(text, "세 대 수");
  if (line) {
    const n = firstNumber(line);
    if (n != null) return { raw: line, value: n };
  }
  const m = text.match(/총\s*([\d,]+)\s*세대/);
  if (m) return { raw: m[0], value: parseFloat(m[1].replace(/,/g, "")) };
  return null;
}

/** permit_hint(인허가 문구) — "사업계획승인"/"건축허가" 원문 라벨 존재 여부 */
function extractPermitHint(text) {
  const m = text.match(/(사업계획\s*승인|건축\s*허가)[^\n]{0,40}/);
  return m ? { raw: m[0].trim(), value: m[0].trim() } : null;
}

/** date_start/date_comp(착공·준공예정일) — "공사기간 2026.03 ~ 2028.09" 패턴 */
function extractConstructionPeriod(text) {
  const line = findLine(text, "공사기간") || findLine(text, "공사 기간");
  if (!line) return null;
  const m = line.match(/(\d{4}[.\-]\d{1,2})\s*[~\-]\s*(\d{4}[.\-]\d{1,2})/);
  if (!m) return { raw: line, start: null, comp: null };
  const toIso = (s) => {
    const mm = s.match(/(\d{4})[.\-](\d{1,2})/);
    return mm ? `${mm[1]}-${String(mm[2]).padStart(2, "0")}-01` : null;
  };
  return { raw: line, start: toIso(m[1]), comp: toIso(m[2]) };
}

/* ---------- 메인 파서 ---------- */
/* 필드ID는 design doc "STEP1. 공사개요 OCR 추출값" 표의 필드ID를 그대로 따른다.
 * target은 index.html STEP2 입력 요소의 #id. */

/**
 * @param {string} text 설계개요 표를 복사(또는 OCR)한 원문 텍스트
 * @returns {{ fields: Array<{key,label,target,value,raw,confidence}>, infoOnly: Array, floorTable: Array, warnings: string[] }}
 */
export function parseOverviewText(text) {
  const t = String(text || "").replace(/\r/g, "");
  const fields = [];
  const infoOnly = [];
  const warnings = [];

  /* proj_name: "공사명/사업명" 라벨 우선, 없으면 도면 타이틀바 */
  const projName = extractProjName(t);
  if (projName)
    fields.push({ key: "proj_name", label: "사업명·공사명 (proj_name)", target: "#proj_name", value: projName.value, raw: projName.raw, confidence: "high" });
  else {
    const title = extractTitle(t);
    if (title) fields.push({ key: "proj_name", label: "사업명·공사명 (proj_name, 도면 타이틀 추정)", target: "#proj_name", value: title, raw: title, confidence: "mid" });
  }

  /* site_addr: 대지위치 → sido/sigungu 자동 분리 */
  const loc = extractSiteLocation(t);
  if (loc) {
    if (loc.sido) fields.push({ key: "sido", label: "시·도 (site_addr 분리)", target: "#sido", value: loc.sido, raw: loc.raw, confidence: "high" });
    if (loc.sigungu) fields.push({ key: "sigungu", label: "시·군·구 (site_addr 분리)", target: "#sigungu", value: loc.sigungu, raw: loc.raw, confidence: "high" });
    if (!loc.sido) warnings.push(`"대지위치"는 찾았지만 시·도명을 인식하지 못했습니다: "${loc.raw}"`);
  }

  /* site_area → project_site_area(사업지역 면적, BF 지역인증 판정용) 참고 프리필 */
  const siteArea = extractNumericField(t, "대지면적");
  if (siteArea && siteArea.value != null)
    fields.push({ key: "site_area", label: "대지면적 (site_area → 사업지역 면적 참고)", target: "#project_site_area", value: siteArea.value, raw: siteArea.raw, confidence: "high" });

  /* floors_above / floors_below */
  const floors = extractFloorsRange(t);
  if (floors) {
    if (floors.above != null)
      fields.push({ key: "floors_above", label: "지상 층수 (floors_above)", target: "#floors_above", value: floors.above, raw: floors.raw, confidence: "high" });
    if (floors.below != null)
      infoOnly.push({ label: "지하 층수 (floors_below)", value: `${floors.below}층`, note: "입력폼에 별도 필드 없음(참고용)" });
  }

  /* gfa_total(연면적 합계) — 지상+지하 합산을 우선 사용, 없으면 지상연면적만 */
  const aboveArea = extractNumericField(t, "지상연면적");
  const belowArea = extractNumericField(t, "지하연면적");
  const totalArea = extractNumericField(t, "전체연면적") || extractNumericField(t, "연면적");
  const gfaFar = extractNumericField(t, "용적률산정연면적") || extractNumericField(t, "용적률 산정용 연면적");
  const floorRows = extractFloorTable(t);
  const sumBySide = (side) => floorRows.filter(r => r.side === side).reduce((s, r) => s + r.area, 0);

  const aboveVal = (aboveArea && aboveArea.value) ?? (sumBySide("지상") || null);
  const belowVal = (belowArea && belowArea.value) ?? (sumBySide("지하") || null);
  const gfaTotalVal = (totalArea && totalArea.value) ?? (aboveVal != null && belowVal != null ? aboveVal + belowVal : aboveVal);

  if (gfaTotalVal != null)
    fields.push({
      key: "gfa_total", label: "연면적 합계 (gfa_total)", target: "#gfa_total", value: gfaTotalVal,
      raw: totalArea ? totalArea.raw : `지상 ${aboveVal ?? "-"} + 지하 ${belowVal ?? "-"}`,
      confidence: totalArea ? "high" : (aboveVal != null ? "mid" : "low"),
      note: "gfa_hvac(냉난방면적)에도 동일 값이 기본 제시됩니다. 설계값으로 보정하세요."
    });
  if (belowVal != null)
    fields.push({
      key: "basementArea", label: "지하연면적 (basementArea, 지하개발 참고)", target: "#basementArea", value: belowVal,
      raw: belowArea ? belowArea.raw : `층별표 지하 합계 ${belowVal}`, confidence: "mid"
    });
  if (gfaFar && gfaFar.value != null)
    infoOnly.push({ label: "용적률 산정 연면적 (gfa_far)", value: `${gfaFar.value.toLocaleString()}㎡`,
      note: "임계치 판정에는 gfa_total을 사용합니다. gfa_far은 참고용." });

  /* use_main: 용도 → use_code_list(용도구성) 프리필 */
  const use = extractUse(t);
  if (use) {
    fields.push({ key: "useMixGuess", label: "주용도 (use_main → use_code_list)", target: "#useMix", value: use.guess, raw: use.raw, confidence: "mid",
      note: "실행 시 자동으로 표준 용도명(별표1)으로 보정을 시도합니다. 복합용도는 직접 줄을 추가하세요." });
    fields.push({ key: "units_total_guess", label: "총 세대수 (units_total, 비주거 추정 0)", target: "#units_total", value: 0, raw: use.raw, confidence: "low" });
    fields.push({ key: "house_subtype_guess", label: "주택 세부유형 (house_subtype, 비주거 추정)", target: "#house_subtype", value: "비주거/기타", raw: use.raw, confidence: "low" });
  }

  /* units_total: "세대수" 라벨 또는 "총 ○○세대" 패턴 — use보다 신뢰도 높으므로 뒤에서 덮어쓰기 */
  const units = extractUnitsTotal(t);
  if (units && units.value != null) {
    fields.push({ key: "units_total", label: "총 세대수 (units_total)", target: "#units_total", value: units.value, raw: units.raw, confidence: "high",
      note: "세대·호실 혼용 주의(오피스텔은 호실일 수 있음)" });
    fields.push({ key: "house_subtype_hint", label: "주택 세부유형 (house_subtype, 세대수 인식으로 추정)", target: "#house_subtype", value: "공동주택(사업계획승인)", raw: units.raw, confidence: "low",
      note: "도시형생활주택/주상복합 여부는 직접 확인·수정하세요." });
  }

  /* owner_name: 건축주·시행자·사업주체 */
  const owner = extractOwnerName(t);
  if (owner)
    fields.push({ key: "owner_name", label: "건축주·시행자 (owner_name)", target: "#owner_name", value: owner.value, raw: owner.raw, confidence: "high",
      note: "발주주체 구분(owner_type)은 이 값을 참고해 추정되며, STEP2에서 반드시 확정하세요." });

  /* permit_hint: 인허가 문구 → permit_track 추정 */
  const permitHint = extractPermitHint(t);
  if (permitHint) {
    const track = /사업계획\s*승인/.test(permitHint.value) ? "주택법" : "건축법";
    fields.push({ key: "permit_track", label: "인허가 유형 (permit_track, permit_hint 기반 추정)", target: "#permit_track", value: track, raw: permitHint.raw, confidence: "mid",
      note: "반드시 사용자가 확정해야 합니다." });
  }

  /* project_type: 사업명 문구의 신축/증축/재축/리모델링 키워드 */
  if (projName || extractTitle(t)) {
    const nameForGuess = (projName && projName.value) || extractTitle(t) || "";
    let guessType = null;
    if (/리모델링|대수선/.test(nameForGuess)) guessType = "전면 대수선(리모델링)";
    else if (/별동\s*증축/.test(nameForGuess)) guessType = "별동증축";
    else if (/재축/.test(nameForGuess)) guessType = "재축";
    else if (/증축/.test(nameForGuess)) guessType = "수평증축";
    else if (/개축/.test(nameForGuess)) guessType = "개축";
    else if (/신축/.test(nameForGuess)) guessType = "신축";
    if (guessType)
      fields.push({ key: "project_type", label: "사업유형 (project_type, proj_name 키워드 추정)", target: "#project_type", value: guessType, raw: nameForGuess, confidence: "mid",
        note: "반드시 사용자가 확정해야 합니다." });
  }

  /* date_start / date_comp: 공사기간 "2026.03 ~ 2028.09" */
  const period = extractConstructionPeriod(t);
  if (period) {
    if (period.start)
      fields.push({ key: "date_start", label: "착공예정일 (date_start)", target: "#date_start", value: period.start, raw: period.raw, confidence: "mid" });
    if (period.comp)
      fields.push({ key: "date_use_inspect", label: "사용검사 신청예정일 (date_use_inspect, 준공예정일 추정)", target: "#date_use_inspect", value: period.comp, raw: period.raw, confidence: "low",
        note: "준공예정일과 사용검사 신청예정일은 다를 수 있습니다. 확인 후 보정하세요." });
  }

  /* parking_count → parking_count 필드, parking_stall_area는 STEP2에서 추정치 자동 계산 */
  const bcr = extractNumericField(t, "건폐율");
  const far = extractNumericField(t, "용적률");
  const landscape = extractNumericField(t, "조경면적");
  const zoning = findLine(t, "지역지구") || findLine(t, "용도지역") || findLine(t, "지역·지구");
  const road = findLine(t, "도로현황");
  const parking = extractParking(t);

  if (parking && parking.plan) {
    const n = firstNumber(parking.plan);
    if (n != null)
      fields.push({ key: "parking_count", label: "주차대수 계획 (parking_count)", target: "#parking_count", value: n, raw: parking.plan, confidence: "mid" });
  }

  if (bcr && bcr.value != null) infoOnly.push({ label: "건폐율", value: `${bcr.value}%`, note: "입력폼에 필드 없음(참고용)" });
  if (far && far.value != null) infoOnly.push({ label: "용적률", value: `${far.value}%`, note: "입력폼에 필드 없음(참고용)" });
  if (landscape && landscape.value != null) infoOnly.push({ label: "조경면적", value: `${landscape.value}㎡`, note: "입력폼에 필드 없음(참고용)" });
  if (zoning) infoOnly.push({ label: "용도지역·지구 (zone_district)", value: zoning, note: "정비구역·지구단위계획 문구는 STEP2 C.입지에서 별도 확인하세요." });
  if (road) infoOnly.push({ label: "도로현황", value: road, note: "입력폼에 필드 없음(참고용)" });
  if (parking && (parking.plan || parking.legal))
    infoOnly.push({ label: "주차계획/법정 원문", value: `계획 ${parking.plan ?? "-"} / 법정 ${parking.legal ?? "-"}`,
      note: "주차구획 면적(㎡)은 OCR로 채워지지 않습니다 — parking_stall_area는 STEP2에서 대수×12.5㎡ 추정 후 실측값으로 보정하세요." });

  if (!fields.length)
    warnings.push("인식된 항목이 없습니다. 라벨(대지위치/대지면적/층수/지상연면적/세대수/건축주 등)이 포함된 텍스트인지 확인하세요.");

  warnings.push("owner_type(발주주체 구분)·gfa_hvac(냉난방면적)·parking_stall_area(주차구획 면적)·입지(교육환경보호구역 등 외부조회)·행위유형 확정은 OCR로 채워지지 않아 STEP2에서 직접 확인·입력해야 합니다.");

  return { fields, infoOnly, floorTable: floorRows, warnings };
}

export default { parseOverviewText };
