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

/* ---------- 메인 파서 ---------- */

/**
 * @param {string} text 설계개요 표를 복사(또는 OCR)한 원문 텍스트
 * @returns {{ fields: Array<{key,label,target,value,raw,confidence}>, infoOnly: Array, floorTable: Array, warnings: string[] }}
 */
export function parseOverviewText(text) {
  const t = String(text || "").replace(/\r/g, "");
  const fields = [];
  const infoOnly = [];
  const warnings = [];

  const title = extractTitle(t);
  if (title) fields.push({ key: "pjtName", label: "프로젝트명", target: "#pjtName", value: title, raw: title, confidence: "mid" });

  const loc = extractSiteLocation(t);
  if (loc) {
    if (loc.sido) fields.push({ key: "sido", label: "시·도", target: "#sido", value: loc.sido, raw: loc.raw, confidence: "high" });
    if (loc.sigungu) fields.push({ key: "sigungu", label: "시·군·구", target: "#sigungu", value: loc.sigungu, raw: loc.raw, confidence: "high" });
    if (!loc.sido) warnings.push(`"대지위치"는 찾았지만 시·도명을 인식하지 못했습니다: "${loc.raw}"`);
  }

  const siteArea = extractNumericField(t, "대지면적");
  if (siteArea && siteArea.value != null)
    fields.push({ key: "siteArea", label: "사업부지 면적(대지면적)", target: "#siteArea", value: siteArea.value, raw: siteArea.raw, confidence: "high" });

  const floors = extractFloorsRange(t);
  if (floors) {
    if (floors.above != null)
      fields.push({ key: "floorsAbove", label: "지상 층수", target: "#floorsAbove", value: floors.above, raw: floors.raw, confidence: "high" });
    if (floors.below != null)
      infoOnly.push({ label: "지하 층수", value: `${floors.below}층`, note: "입력폼에 별도 필드 없음(참고용)" });
  }

  const aboveArea = extractNumericField(t, "지상연면적");
  const belowArea = extractNumericField(t, "지하연면적");
  const totalArea = extractNumericField(t, "전체연면적");
  const floorRows = extractFloorTable(t);
  const sumBySide = (side) => floorRows.filter(r => r.side === side).reduce((s, r) => s + r.area, 0);

  const aboveVal = (aboveArea && aboveArea.value) ?? (sumBySide("지상") || null);
  const belowVal = (belowArea && belowArea.value) ?? (sumBySide("지하") || null);

  if (aboveVal != null)
    fields.push({
      key: "totalArea", label: "총 연면적(→지상연면적 기준)", target: "#totalArea", value: aboveVal,
      raw: aboveArea ? aboveArea.raw : `층별표 지상 합계 ${aboveVal}`, confidence: aboveArea ? "high" : "mid"
    });
  if (belowVal != null)
    fields.push({
      key: "basementArea", label: "지하개발 면적(→지하연면적 기준)", target: "#basementArea", value: belowVal,
      raw: belowArea ? belowArea.raw : `층별표 지하 합계 ${belowVal}`, confidence: "mid"
    });

  if (totalArea && totalArea.value != null)
    infoOnly.push({ label: "전체연면적(지상+지하)", value: `${totalArea.value.toLocaleString()}㎡`,
      note: "참고용 — 총 연면적 입력값은 지상연면적을 사용합니다(에너지계산은 지상부만 대상)" });

  const use = extractUse(t);
  if (use) {
    fields.push({ key: "useMixGuess", label: "용도", target: "#useMix", value: use.guess, raw: use.raw, confidence: "mid",
      note: "실행 시 자동으로 표준 용도명으로 보정을 시도합니다. 인식 실패 시 직접 수정하세요." });
    fields.push({ key: "households", label: "세대수(비주거 추정)", target: "#households", value: 0, raw: use.raw, confidence: "mid" });
    fields.push({ key: "housingType", label: "주택유형(비주거 추정)", target: "#housingType", value: "비주거/기타", raw: use.raw, confidence: "mid" });
  }

  const bcr = extractNumericField(t, "건폐율");
  const far = extractNumericField(t, "용적률");
  const landscape = extractNumericField(t, "조경면적");
  const zoning = findLine(t, "지역지구");
  const road = findLine(t, "도로현황");
  const parking = extractParking(t);

  if (bcr && bcr.value != null) infoOnly.push({ label: "건폐율", value: `${bcr.value}%`, note: "입력폼에 필드 없음(참고용)" });
  if (far && far.value != null) infoOnly.push({ label: "용적률", value: `${far.value}%`, note: "입력폼에 필드 없음(참고용)" });
  if (landscape && landscape.value != null) infoOnly.push({ label: "조경면적", value: `${landscape.value}㎡`, note: "입력폼에 필드 없음(참고용)" });
  if (zoning) infoOnly.push({ label: "지역지구", value: zoning, note: "입력폼에 필드 없음(참고용)" });
  if (road) infoOnly.push({ label: "도로현황", value: road, note: "입력폼에 필드 없음(참고용)" });
  if (parking && (parking.plan || parking.legal))
    infoOnly.push({ label: "주차계획/법정", value: `계획 ${parking.plan ?? "-"} / 법정 ${parking.legal ?? "-"}`,
      note: "주차장 면적(㎡) 정보가 없어 자동 입력하지 않았습니다. 필요 시 별도 확인하세요." });

  if (!fields.length)
    warnings.push("인식된 항목이 없습니다. 라벨(대지위치/대지면적/층수/지상연면적 등)이 포함된 텍스트인지 확인하세요.");

  warnings.push("행위유형·발주자유형·옥상가용면적·입면면적·연간 전력/연료는 설계개요만으로 알 수 없어 자동 입력하지 않았습니다. 직접 입력하세요.");

  return { fields, infoOnly, floorTable: floorRows, warnings };
}

export default { parseOverviewText };
