/* =========================================================================
 * tables.js  —  신재생에너지 / ZEB / 녹색건축 기준 데이터
 * 출처: 「제로에너지건축물 및 녹색건축물 설계 가이드라인」(2025.12)
 *       「신·재생에너지 설비의 지원 등에 관한 규정」 별표2
 *       「신·재생에너지 설비 지원 등에 관한 지침」 별표10
 *       「건축물의 에너지절약설계기준」(국토부고시 제2025-738호)
 *       「에너지절약형 친환경주택의 건설기준」(2025.06.30 시행)
 * ========================================================================= */

export const DATA_VERSION   = "2026-08-19";          // 파일 갱신일
export const SOURCE_VERSION = "2025.12 가이드라인";   // 원자료 기준
export const EFFECTIVE = { from: "2025-01-01", to: null };  // to=null → 무기한

/* ---------------------------------------------------------------- 0. 상수 */
export const TOE = {
  KWH_FINAL: 0.000086,        // 최종에너지 kWh → toe
  KWH_ELEC_PRIMARY: 0.000215  // 전력 1차에너지 kWh → toe
};

export const SAFETY_AREA = 1.2;   // 설치면적 여유율

export const PV_SPEC = {          // 개산견적 기준(가이드라인 p.42~46)
  AREA_PER_KW: 5.0,               // 옥상/입면 PV  ㎡/kW
  BIPV_AREA_PER_KW: 6.0,          // BIPV        ㎡/kW
  DEFAULT_MODULE_EFF: 0.20,
  ROOF_USABLE_RATIO: 0.5          // 옥상 PV 설치가능 = 건축면적 × 50% 가정
};

/* --------------------------------------- 1. 용도 → 부문(sector) 매핑 */
/*  단위에너지사용량 표가 부문(공공용/문교사회용/상업용)별로 나뉘므로
 *  '업무시설'처럼 부문에 따라 값이 다른 용도는 clientType으로 해소한다.  */
export const SECTOR = { PUBLIC: "공공용", EDU_SOCIAL: "문교·사회용", COMMERCIAL: "상업용" };

export const USE_SECTOR = {
  "교정 및 군사시설": SECTOR.PUBLIC,
  "방송통신시설":     SECTOR.PUBLIC,
  "업무시설":         { public: SECTOR.PUBLIC, private: SECTOR.COMMERCIAL }, // 발주주체로 분기
  "문화 및 집회시설": SECTOR.EDU_SOCIAL,
  "종교시설":         SECTOR.EDU_SOCIAL,
  "의료시설":         SECTOR.EDU_SOCIAL,
  "교육연구시설":     SECTOR.EDU_SOCIAL,
  "노유자시설":       SECTOR.EDU_SOCIAL,
  "수련시설":         SECTOR.EDU_SOCIAL,
  "운동시설":         SECTOR.EDU_SOCIAL,
  "묘지관련시설":     SECTOR.EDU_SOCIAL,
  "관광휴게시설":     SECTOR.EDU_SOCIAL,
  "장례식장":         SECTOR.EDU_SOCIAL,
  "판매 및 영업시설": SECTOR.COMMERCIAL,
  "운수시설":         SECTOR.COMMERCIAL,
  "숙박시설":         SECTOR.COMMERCIAL,
  "위락시설":         SECTOR.COMMERCIAL
};

/* 입력 표기 흔들림 흡수용 별칭 */
export const USE_ALIAS = {
  "방송·통신시설": "방송통신시설", "방송통신 시설": "방송통신시설",
  "데이터센터": "방송통신시설",
  "교정시설": "교정 및 군사시설", "군사시설": "교정 및 군사시설",
  "문화집회시설": "문화 및 집회시설", "문화 및 집회 시설": "문화 및 집회시설",
  "판매시설": "판매 및 영업시설", "영업시설": "판매 및 영업시설",
  "장례시설": "장례식장",
  "오피스텔": "업무시설", "사무소": "업무시설", "공공청사": "업무시설",
  "학교": "교육연구시설", "연구소": "교육연구시설",
  "병원": "의료시설",
  "그 밖의 건축물": "업무시설"      // 표에 없는 용도는 업무시설로 준용(검토자 확인 필요)
};

/* ------------------------- 2. 용도별 단위에너지사용량 [kWh/㎡·yr] (표1) */
export const UNIT_ENERGY = {
  effective_from: "2025-01-01", effective_to: null,
  data: {
    "공공용": {
      "교정 및 군사시설": 392.07,
      "방송통신시설":     490.18,
      "업무시설":         371.66
    },
    "문교·사회용": {
      "문화 및 집회시설": 412.03,
      "종교시설":         257.49,
      "의료시설":         643.52,
      "교육연구시설":     231.33,
      "노유자시설":       175.58,
      "수련시설":         231.33,
      "운동시설":         235.42,
      "묘지관련시설":     234.99,
      "관광휴게시설":     437.08,
      "장례식장":         234.99
    },
    "상업용": {
      "판매 및 영업시설": 408.45,
      "운수시설":         374.47,
      "업무시설":         374.47,
      "숙박시설":         526.55,
      "위락시설":         400.33
    }
  },
  /* 공동주택은 표1에 없어 실무상 230 kWh/㎡·yr 를 적용(가이드라인 p.32 예시) */
  RESIDENTIAL_DEFAULT: 230
};

/* ------------------------------------------- 3. 지역계수 (표2) */
export const REGION_FACTOR = {
  effective_from: "2025-01-01", effective_to: null,
  data: {
    "서울": 1.00, "인천": 0.97, "경기": 0.99,
    "강원영서": 1.00, "강원영동": 0.97,
    "대전": 1.00, "충북": 1.00, "전북": 1.04,
    "충남": 0.99, "세종": 0.99,
    "광주": 1.01, "대구": 1.04, "부산": 0.93,
    "경남": 1.00, "울산": 0.93, "경북": 0.98,
    "전남": 0.99, "제주": 0.97
  },
  alias: {
    "서울특별시": "서울", "인천광역시": "인천", "경기도": "경기",
    "대전광역시": "대전", "대구광역시": "대구", "부산광역시": "부산",
    "광주광역시": "광주", "울산광역시": "울산",
    "충청북도": "충북", "충청남도": "충남", "세종특별자치시": "세종",
    "전라북도": "전북", "전라남도": "전남",
    "경상북도": "경북", "경상남도": "경남",
    "제주특별자치도": "제주", "강원특별자치도": "강원영서"
  }
};

/* ------- 4. 신재생에너지원별 단위에너지생산량 / 원별보정계수 (표3) */
/*  unit: kW(용량형) | ㎡(면적형) | kg(연료형)                        */
export const RE_SOURCE = {
  effective_from: "2025-01-01", effective_to: null,
  data: {
    "태양광_고정식":      { unit: "kW", prod: 1358, k: 0.95, price: 1_400_000 },
    "태양광_추적식":      { unit: "kW", prod: 1765, k: 1.47, price: 2_000_000 },
    "태양광_입면BAPV":    { unit: "kW", prod: 1358, k: 0.95, price: 2_000_000 },
    "BIPV":               { unit: "kW", prod:  923, k: 6.12, price: 5_000_000 },

    "태양열_평판형":       { unit: "㎡", prod: 596, k: 1.78 },
    "태양열_단일진공관형": { unit: "㎡", prod: 745, k: 1.42 },
    "태양열_이중진공관형": { unit: "㎡", prod: 745, k: 1.42 },
    "태양열_공기식무창형": { unit: "㎡", prod: 487, k: 1.53 },
    "태양열_공기식유창형": { unit: "㎡", prod: 557, k: 2.87 },

    "지열_수직밀폐형":    { unit: "kW", prod: 864, k: 1.26, price: 1_500_000 },
    "지열_개방형":        { unit: "kW", prod: 864, k: 1.00, price: 1_500_000 },

    "집광채광_프리즘":    { unit: "㎡", prod: 132, k: 7.76 },
    "집광채광_광덕트":    { unit: "㎡", prod:  73, k: 7.77 },
    "집광채광_실내루버형":{ unit: "㎡", prod: 184, k: 2.77 },

    "연료전지_PEMFC":     { unit: "kW", prod: 7415, k: 2.20 },
    "연료전지_SOFC":      { unit: "kW", prod: 9198, k: 8.71, price: 100_000_000 },

    "수열_해수":          { unit: "kW", prod: 864, k: 1.30 },
    "수열_하천수":        { unit: "kW", prod: 864, k: 1.30 },
    "목재펠릿":           { unit: "kg", prod: 322, k: 0.32 },
    "소형풍력":           { unit: "kW", prod: 2375, k: 4.50 }
  },
  /* 기준별 인정 여부 */
  eligibility: {
    "공급의무비율":   { 집광채광: true,  비고: "집광채광루버 인정" },
    "녹색건축인증":   { 집광채광: false, 비고: "집광채광루버 불인정" },
    "ZEB인증":        { 비고: "지열·연료전지는 단위세대 적용 시에만 인정(주거)" }
  }
};

/* --------------------- 5. 공공기관 신재생 공급의무비율 (연도별, %) */
export const PUBLIC_RE_RATIO = {
  effective_from: "2022-01-01", effective_to: null,
  data: [
    { from: 2022, to: 2023, ratio: 32 },
    { from: 2024, to: 2025, ratio: 34 },
    { from: 2026, to: 2027, ratio: 36 },
    { from: 2028, to: 2029, ratio: 38 },
    { from: 2030, to: 9999, ratio: 40 }
  ]
};

/* ------------------ 6. 지자체 녹색건축물 설계기준 (2025년, 주거 기준) */
/*  green: 녹색건축인증 / energy: 건축물에너지효율등급(2025.1 이후 폐지지역 null)
 *  re: 신재생 공급의무비율(%)                                            */
export const LOCAL_STANDARD = {
  effective_from: "2025-01-01", effective_to: null,
  source: "2025.12 가이드라인 표1 (주거 기준)",
  scope: "residential",   // ⚠ 비주거에는 세대수 티어 적용 불가
  data: {
    "서울": {
      revision: "2025.01",
      tiers: [
        { tier: "가", hh: 1000, green: "우수", energy: "1++", re: 11.0 },
        { tier: "나", hh:  300, green: "우량", energy: "1+",  re: 10.5 },
        { tier: "다", hh:   30, green: "일반", energy: "1",   re: 10.0 },
        { tier: "라", hh:    0, green: null,   energy: null,  re: null }
      ],
      zebExempt: { re: true, energy: false },
      eiaRule: { green: "최우수", zeb: 5 },
      geoHydroRule: { thresholdArea: 30000, minShareOfObligation: 0.5, sources: ["지열","수열"] },
      notes: ["환경영향평가 대상: 녹색 최우수 + ZEB 5등급 이상",
              "비주거 연면적 30,000㎡ 이상 → 의무비율의 50% 이상 지열·수열"]
    },
    "인천": {
      revision: "2025.05",
      tiers: [
        { tier: "가", hh: 1000, green: "우수", energy: null, re: 9.0 },
        { tier: "나", hh:  300, green: "우량", energy: null, re: 8.5 },
        { tier: "다", hh:   30, green: "일반", energy: null, re: 8.0 },
        { tier: "라", hh:    0, green: null,   energy: null, re: null }
      ],
      zebExempt: { re: true, energy: false },
      pvSiteRule: { siteAreaRatio: 0.01 },
      notes: ["대지면적 1% 태양광 의무설치", "EPI 일부 항목 최소배점 주의"]
    },
    "경기": {
      revision: "2017.09",
      recommend: true,
      tiers: [
        { tier: "나", hh: 500, green: "우량", energy: "2", re: null, capacityRatio: 1.0 },
        { tier: "다", hh:   0, green: "일반", energy: "3", re: null, capacityRatio: null }
      ],
      zebExempt: { re: false, energy: false },
      eiaRule: { green: "최우수", zeb: 5 },
      notes: ["신재생은 비율이 아닌 '전체 설비용량 1%' 기준",
              "권장사항이나 실무상 녹색 일반등급·에너지 1등급 이상으로 진행"]
    },
    "부산": {
      revision: "2024.07",
      tiers: [
        { tier: "가", hh: 1000, green: "우수", energy: "1+", re: 10.0 },
        { tier: "나", hh:  300, green: "우량", energy: "1",  re: 10.0 },
        { tier: "다", hh:   30, green: "일반", energy: "2",  re: 8.0 },
        { tier: "라", hh:    0, green: null,   energy: null, re: null }
      ],
      zebExempt: { re: true, energy: false },
      notes: ["2개 이상 신재생 복합설치 기준 삭제됨"]
    },
    "대전": {
      revision: "2021.12",
      tiers: [
        { tier: "가", hh: 1000, green: "우수", energy: "1+", re: 9.0 },
        { tier: "나", hh:  500, green: "우량", energy: "1",  re: 8.0 },
        { tier: "다", hh:   30, green: "일반", energy: "2",  re: null },
        { tier: "라", hh:    0, green: null,   energy: null, re: null }
      ],
      zebExempt: { re: false, energy: false }, notes: []
    },
    "광주": {
      revision: "2023.07",
      tiers: [
        { tier: "가", hh: 1000, green: "우수", energy: "1+", re: 8.0 },
        { tier: "나", hh:  300, green: "우량", energy: "1",  re: 7.0 },
        { tier: "다", hh:   30, green: "일반", energy: "2",  re: 5.0 },
        { tier: "라", hh:    0, green: null,   energy: null, re: null }
      ],
      zebExempt: { re: false, energy: false }, notes: []
    },
    "울산": {
      revision: "2025.01",
      tiers: [
        { tier: "가", hh: 1000, green: "우수", energy: null, re: null },
        { tier: "나", hh:  500, green: "우량", energy: null, re: null },
        { tier: "다", hh:   30, green: "일반", energy: null, re: null },
        { tier: "라", hh:    0, green: null,   energy: null, re: null }
      ],
      zebExempt: { re: false, energy: false },
      notes: ["2025.01 이후 에너지효율등급인증 내용 제외",
              "신재생 관련 기준 없음", "EPI 일부 항목 최소배점 주의"]
    },
    "대구": {
      revision: "2025.07",
      tiers: [
        { tier: "가", hh: 1000, green: "우수", energy: "1+", re: 10.0 },
        { tier: "나", hh:  300, green: "우량", energy: "1+", re: 10.0 },
        { tier: "다", hh:   30, green: "일반", energy: "1+", re: 7.0 },
        { tier: "라", hh:    0, green: null,   energy: null, re: null }
      ],
      zebExempt: { re: false, energy: false },
      multiSource: { required: true, min: 2 },
      notes: ["2개 이상 신재생에너지원 복합설치 의무", "EPI 일부 항목 최소배점 주의"]
    },
    "경남": {
      revision: "2025.03",
      tiers: [
        { tier: "가", hh: 1000, green: "우수", energy: "1+", re: 8.0 },
        { tier: "나", hh:  300, green: "우량", energy: "1",  re: 8.0 },
        { tier: "다", hh:   30, green: "일반", energy: null, re: null }
      ],
      zebExempt: { re: false, energy: false },
      multiSource: { required: false, min: 2 },
      notes: ["2개 이상 신재생 복합설치 권장(의무 아님)",
              "30세대 이상 ZEB 5등급 이상 권장"]
    },
    "고양": {
      revision: "2024.05", parent: "경기",
      tiers: [
        { tier: "가", hh: 1000, green: "우수", energy: "1+", re: 2.5 },
        { tier: "나", hh:  500, green: "우량", energy: "1",  re: 2.0 },
        { tier: "다", hh:   30, green: "일반", energy: "2",  re: null },
        { tier: "라", hh:    0, green: null,   energy: null, re: null }
      ],
      zebExempt: { re: true, energy: false },
      publicOverride: { re: 20.0 },
      verify: true,   // ⚠ 2.5%는 타 지자체 대비 이례적 → 산정기준(설비용량 여부) 확인
      notes: ["공공건축물은 20% 이상 일괄 적용",
              "신재생 2.5/2.0%는 타 지자체 대비 낮아 산정기준 원문 확인 필요",
              "EPI 일부 항목 최소배점 주의"]
    },
    "충남": {
      revision: "2024.06",
      tiers: [
        { tier: "가", hh: 1000, green: "우수", energy: "1+", re: 10.0 },
        { tier: "나", hh:  300, green: "우량", energy: "1",  re: 10.0 },
        { tier: "다", hh:   30, green: "일반", energy: "2",  re: null },
        { tier: "라", hh:    0, green: null,   energy: null, re: null }
      ],
      zebExempt: { re: false, energy: false },
      zebDeferred: { active: true, rule: [ { hh: 1000, grade: 4 }, { hh: 30, grade: 5 } ],
                     note: "별도 고시 전까지 유예" },
      notes: ["EPI 일부 항목 최소배점 주의", "ZEB 기준 있으나 별도 고시 전까지 유예"]
    },
    "제주": {
      revision: "2025.07",
      tiers: [
        { tier: "A", hh: 1000, green: "우수", energy: "1",  re: 10.0 },
        { tier: "B", hh:  300, green: "우량", energy: "2",  re: 9.0 },
        { tier: "C", hh:   30, green: "일반", energy: null, re: 8.0 },
        { tier: "D", hh:    0, green: null,   energy: null, re: null }
      ],
      zebExempt: { re: true, energy: true },   // 에너지효율등급까지 면제
      notes: ["2025.07 권장 → 의무사항으로 개정됨",
              "ZEB 취득 시 에너지·신재생 기준 모두 적용 제외 가능",
              "EPI 일부 항목 최소배점 주의"]
    },
    "세종": {
      revision: "2025.06",
      tiers: [
        { tier: "가", hh: 1000, green: "우수", energy: null, re: 10.0 },
        { tier: "나", hh:  300, green: "우량", energy: null, re: 9.5 },
        { tier: "다", hh:   30, green: "일반", energy: null, re: 9.0 },
        { tier: "라", hh:    0, green: null,   energy: null, re: null }
      ],
      zebExempt: { re: true, energy: false },
      notes: ["2025.06 이후 에너지효율등급 관련 내용 제외"]
    },
    "그 외 지역": {
      tiers: [
        { tier: "-", hh: 500, green: "일반", greenMandatory: true,
          energy: "1", energyRecommend: true, re: "GREEN_HOME_ART7" },
        { tier: "-", hh:   0, green: null, energy: null, re: "GREEN_HOME_ART7" }
      ],
      zebExempt: { re: false, energy: false },
      notes: ["500세대 이상: 주택성능등급 의무 표시 대상 → 녹색건축인증 취득 필요",
              "500세대 이하: 의무취득 기준 없음(건축주 요구 시 취득)",
              "신재생은 「에너지절약형 친환경주택의 건설기준」 제7조 준수"]
    }
  },
  zebExemptRegions: ["서울","인천","부산","고양","제주","세종"]
};


/* --------------------------------- 7. ZEB(제로에너지건축물) 인증 기준 */
export const ZEB = {
  effective_from: "2025-01-01", effective_to: null,
  scope: { minArea: 1000, note: "연면적 1,000㎡ 이상, 건축허가 신청일 기준" },
  /* 자립률 또는 1차에너지소요량 중 높은 등급 적용. 소요량 취득 시 BEMS 필수 */
  grades: [
    { grade: "ZEB Plus", selfSufficiency: 120, primaryResi: -10, primaryNonResi: -70 },
    { grade: "ZEB 1",    selfSufficiency: 100, primaryResi:  10, primaryNonResi: -30 },
    { grade: "ZEB 2",    selfSufficiency:  80, primaryResi:  30, primaryNonResi:  10 },
    { grade: "ZEB 3",    selfSufficiency:  60, primaryResi:  50, primaryNonResi:  50 },
    { grade: "ZEB 4",    selfSufficiency:  40, primaryResi:  70, primaryNonResi:  90 },
    { grade: "ZEB 5",    selfSufficiency:  20, primaryResi:  90, primaryNonResi: 130 }
  ],
  /* 2025~ 공공 의무등급 4등급 대상 17개 용도 (그 외 5등급) */
  grade4Uses: [
    "교육연구시설","업무시설","교정시설","운동시설","노유자시설","문화 및 집회시설",
    "수련시설","관광휴게시설","운수시설","묘지관련시설","의료시설","방송통신시설",
    "판매시설","숙박시설","위락시설","종교시설","장례시설"
  ],
  mandatory: {
    public: "신축·재축·개축·별동증축 / 30세대 이상 공동주택 또는 연면적 500㎡ 이상",
    privateResidential: "2025.06.30 시행 「에너지절약형 친환경주택 건설기준」으로 ZEB5 수준 적용",
    privateNonResidential: "2025.12.31 시행 「건축물의 에너지절약설계기준」 개정으로 ZEB5 수준 적용"
  },
  /* 대지 외 생산량 보정계수 */
  offsiteWeight: [
    { selfMin: 0,  selfMax: 10, w: 0.7 },
    { selfMin: 10, selfMax: 15, w: 0.8 },
    { selfMin: 15, selfMax: 20, w: 0.9 },
    { selfMin: 20, selfMax: 999, w: 1.0 }
  ],
  /* 계획단계 개략 자립률 추정용 보정계수(비공식·참고용, 가이드라인 p.35) */
  planningFactor: {
    "PV": 2.0, "BIPV": 0.5, "지열_수직밀폐형": 0.3,
    "연료전지_PEMFC": 0.1, "연료전지_SOFC": 0.025
  },
  /* 주거 계획단계 개략 PV 용량 (ZEB5 기준) */
  residentialPvPerUnit: { "지역난방": 0.8, "개별보일러": 1.0 },  // kW/세대
  bemsRequired: true
};

/* ------------------ 8. 에너지절약형 친환경주택 (2025.06.30 시행) */
export const GREEN_HOME = {
  effective_from: "2025-06-30", effective_to: null,
  performance: { primaryEnergy: 100, savingRate: 67 },    // kWh/㎡yr 미만, %
  prescriptive: {
    boilerEff: 92, lightingDensity: 6, heatExchangeEff: 75, minScore: 50
  },
  scoring: {
    "난방": { per: 1,   point: 1 },
    "냉방": { per: 1,   point: 1 },
    "급탕": { per: 2.5, point: 1 },
    "조명": { per: 2.7, point: 1 },
    "외단열": [
      { min: 30, max: 50, point: 3 },
      { min: 50, max: 70, point: 5 },
      { min: 70, max: 100, point: 7 }
    ]
  },
  /* 50점(조명 항목) 확보용 PV 용량 = 전용면적합계 × 6W/㎡ × 135% */
  pvRule: { lightingDensity: 0.006, ratio: 1.35, coef: 0.0081 },  // kW/㎡
  envelope: {  // 중부2 기준
    "외벽": { direct: 0.17, indirect: 0.24 },
    "지붕": { direct: 0.15, indirect: 0.21 },
    "바닥": { direct: 0.17, indirect: 0.24 },
    "창호": { direct: 0.90, indirect: 1.50 },
    "발코니창": 2.40,
    "강재문": { direct: 1.4, indirect: 1.6 },
    "창면적비": { min: 20, max: 45 }
  }
};

/* ------------------- 9. 에너지절약계획서 / 에너지소비총량 기준 */
export const EPI = {
  effective_from: "2025-01-01", effective_to: null,
  code: "국토교통부고시 제2025-738호",
  target: { minArea: 500 },
  score: { private: 65, public: 74 },
  energyDemand: [
    { minArea: 1000, uses: null, private: 200, public: 130 },
    { minArea: 3000, uses: ["업무시설", "교육연구시설"], limit: 150 }
  ],
  notes: [
    "연면적 1,000㎡ 민간건축물도 2025.12.31 이후 신재생에너지 설치 의무화",
    "ZEB 취득 시 에너지절약계획서 제출 제외 가능(설계변경 시 재인증 요구될 수 있음)"
  ]
};

/* -------------------------- 10. 녹색건축인증(G-SEED) */
export const GSEED = {
  effective_from: "2025-01-01", effective_to: null,
  gradeScore: {
    current: { "주거": { 일반: 50, 우량: 58, 우수: 66, 최우수: 74 },
               "비주거": { 일반: 50, 우량: 60, 우수: 70, 최우수: 80 } },
    revised:  { "통합": { 일반: 50, 우량: 60, 우수: 70, 최우수: 80 } } // 2026 개정(안), 시행시기 미정
  },
  weight: {
    "토지이용 및 교통": 10, "에너지 및 환경오염": 25, "재료 및 자원": 18,
    "물순환관리": 10, "유지관리": 7, "생태환경": 10, "실내환경": 20
  },
  /* 2.1 에너지성능: EPI 점수 → 평점  (12 × [0.4 + (EPI-70)/25 × 0.6]) */
  energyScore: {
    formula: (epi) => 12 * (0.4 + ((epi - 70) / 25) * 0.6),
    minEpiByGrade: { 일반: 70, 우량: 78.4, 우수: 86.7 },
    zeb5Equivalent: 12
  },
  reRatio: { note: "난방+냉방+급탕+전기 설비용량 합계 대비", grade1: 2.5 }, // %
  complexRule: {
    conditions: [
      "작은 용도 면적이 전체 연면적의 10% 이상 & 10,000㎡ 이상",
      "작은 용도 면적이 전체 연면적의 20% 이상",
      "각 용도 연면적이 30,000㎡ 이상"
    ],
    minScoreEachUse: 50
  }
};

/* --------------------------------- 11. 인센티브 */
export const INCENTIVE = {
  effective_from: "2025-01-01", effective_to: null,
  /* 용적률·높이 완화 (최대 15%) — 「건축물의 에너지절약설계기준」 제17조 별표9 */
  relaxation: {
    max: 15,
    gseed: { 최우수: 6, 우수: 3 },
    zeb:   { "1등급": 15, "2등급": 14, "3등급": 13, "4등급": 12, "5등급": 11 }
  },
  /* 취득세·재산세 경감 — 「지방세특례제한법」 제47조의2 */
  tax: {
    gseed: { 최우수: 10, 우수: 5 },
    zeb:   { "3등급 이상": 20, "4등급": 18, "5등급": 15 }
  },
  /* 기부채납 부담률 경감 */
  contribution: [
    { cond: "녹색 최우수 + 에너지 1등급", rate: 10 },
    { cond: "녹색 최우수 + 에너지 2등급", rate: 7 },
    { cond: "녹색 우수 + 에너지 1등급",   rate: 7 },
    { cond: "녹색 우수 + 에너지 2등급",   rate: 5 },
    { cond: "제로에너지건축물인증",        rate: 15, note: "15% 이내" }
  ]
};

/* -------------------- 12. 지역별 열관류율 기준 [W/㎡K] */
export const U_VALUE = {
  effective_from: "2025-01-01", effective_to: null,
  zones: {
    "중부1": {
      벽_외기직접: { 공동주택: 0.150, 그외: 0.170 },
      벽_외기간접: { 공동주택: 0.210, 그외: 0.240 },
      지붕: { 직접: 0.150, 간접: 0.210 },
      바닥_직접: { 바닥난방: 0.150, 비바닥난방: 0.170 },
      바닥_간접: { 바닥난방: 0.210, 비바닥난방: 0.240 },
      층간바닥: 0.810,
      창_직접: { 공동주택: 0.9, 그외: 1.3 }, 문_직접: 1.5,
      창_간접: { 공동주택: 1.3, 그외: 1.6 }, 문_간접: 1.9
    },
    "중부2": {
      벽_외기직접: { 공동주택: 0.170, 그외: 0.240 },
      벽_외기간접: { 공동주택: 0.240, 그외: 0.340 },
      지붕: { 직접: 0.150, 간접: 0.210 },
      바닥_직접: { 바닥난방: 0.170, 비바닥난방: 0.200 },
      바닥_간접: { 바닥난방: 0.240, 비바닥난방: 0.290 },
      층간바닥: 0.810,
      창_직접: { 공동주택: 1.0, 그외: 1.5 }, 문_직접: 1.5,
      창_간접: { 공동주택: 1.5, 그외: 1.9 }, 문_간접: 1.9
    },
    "남부": {
      벽_외기직접: { 공동주택: 0.220, 그외: 0.320 },
      벽_외기간접: { 공동주택: 0.310, 그외: 0.450 },
      지붕: { 직접: 0.180, 간접: 0.260 },
      바닥_직접: { 바닥난방: 0.220, 비바닥난방: 0.250 },
      바닥_간접: { 바닥난방: 0.310, 비바닥난방: 0.350 },
      층간바닥: 0.810,
      창_직접: { 공동주택: 1.2, 그외: 1.8 }, 문_직접: 1.5,
      창_간접: { 공동주택: 1.7, 그외: 2.2 }, 문_간접: 1.9
    },
    "제주": {
      벽_외기직접: { 공동주택: 0.250, 그외: 0.410 },
      벽_외기간접: { 공동주택: 0.350, 그외: 0.560 },
      지붕: { 직접: 0.250, 간접: 0.350 },
      바닥_직접: { 바닥난방: 0.290, 비바닥난방: 0.330 },
      바닥_간접: { 바닥난방: 0.410, 비바닥난방: 0.470 },
      층간바닥: 0.810,
      창_직접: { 공동주택: 1.6, 그외: 2.2 }, 문_직접: 1.5,
      창_간접: { 공동주택: 2.0, 그외: 2.8 }, 문_간접: 1.9
    }
  },
  entranceDoor: { legal: 1.6, practice: 1.4, note: "거실 내 방화문으로 보아 1.4 이하 요구되는 사례 많음" },
  regionMap: {
    "중부1": ["강원(고성·양양·강릉·동해·삼척 제외)", "경기(연천·포천·가평·남양주·의정부·양주·동두천·파주)", "충북(제천)", "경북(봉화·청송)"],
    "중부2": ["서울", "대전", "세종", "인천", "충남", "전북", "경기(중부1 제외)", "충북(제천 제외)", "경남(거창·함양)"],
    "남부":  ["부산", "대구", "울산", "광주", "전남", "경북(울진·영덕·포항·경주·청도·경산)", "경남(거창·함양 제외)"],
    "제주":  ["제주"]
  }
};

/* 단열재 열전도율 [W/mK] — KS M ISO 4898 (2025.05.19 이후 표기법) */
export const INSULATION_K = {
  effective_from: "2025-05-19", effective_to: null,
  EPS: { "Ⅰ-A-1":0.033,"Ⅰ-A-2":0.039,"Ⅰ-B":0.043,"Ⅰ-C":0.043,
         "Ⅱ-A-1":0.032,"Ⅱ-A-2":0.036,"Ⅱ-B":0.039,
         "Ⅲ-A-1":0.029,"Ⅲ-A-2":0.031,"Ⅲ-B":0.034,"Ⅲ-C":0.039 },
  XPS: { "Ⅰ-A-1":0.026,"Ⅰ-A-2":0.029,"Ⅱ-A":0.028,"Ⅱ-B-1":0.026,
         "Ⅱ-B-2":0.027,"Ⅲ-A":0.026,"Ⅲ-B-2":0.026,"Ⅲ-C":0.026 },
  PUR: { "Ⅰ-A":0.024,"Ⅰ-B":0.029,"Ⅰ-C":0.024,"Ⅰ-D":0.023,"Ⅰ-E":0.023,
         "Ⅱ-A":0.023,"Ⅱ-B":0.024,"Ⅱ-C":0.029,"Ⅲ-A":0.023,"Ⅲ-B":0.024,"Ⅲ-C":0.029 },
  PF:  { "Ⅰ-A":0.022,"Ⅰ-B":0.037,"Ⅰ-C":0.022,"Ⅰ-D":0.022,"Ⅱ-A":0.022,"Ⅱ-B":0.037,"Ⅲ-A":0.039 }
};

/* --------------------- 13. 증축 유형별 인증 적용 여부 */
export const EXTENSION_RULE = {
  "수평증축": { 녹색건축: false, 에너지효율: false, ZEB: false, 공급의무비율: true, 에너지절약계획서: true, BF: false },
  "별동증축": { 녹색건축: true,  에너지효율: true,  ZEB: true,  공급의무비율: true, 에너지절약계획서: true, BF: true }
};

/* --------------------- 14. 기부채납시설 공공/민간 구분 */
export const DONATION_RULE = {
  "에너지절약계획서": "허가권자 판단(동별 기부채납 연면적 50% 이상이면 공공으로 판단)",
  "녹색건축인증": "공공",
  "제로에너지건축물인증": "공공"
};

/* ========================= 15. 계산 헬퍼 ========================= */
const normUse    = (u) => USE_ALIAS[String(u).trim()] ?? String(u).trim();
const normRegion = (r) => REGION_FACTOR.alias[String(r).trim()] ?? String(r).trim();

export function resolveSector(use, clientType = "private") {
  const u = normUse(use);
  const s = USE_SECTOR[u];
  if (!s) return null;
  return typeof s === "string" ? s : (clientType === "public" ? s.public : s.private);
}

export function getUnitEnergy(use, clientType = "private") {
  const u = normUse(use);
  if (u === "공동주택" || u === "주거") return UNIT_ENERGY.RESIDENTIAL_DEFAULT;
  const sector = resolveSector(u, clientType);
  if (!sector) throw new Error(`단위에너지사용량 조회 실패: 용도="${use}" (별칭/표기 확인)`);
  const v = UNIT_ENERGY.data[sector]?.[u];
  if (v == null) throw new Error(`단위에너지사용량 조회 실패: 부문="${sector}", 용도="${u}"`);
  return v;
}

export function getRegionFactor(region) {
  const r = normRegion(region);
  const v = REGION_FACTOR.data[r];
  if (v == null) throw new Error(`지역계수 조회 실패: "${region}"`);
  return v;
}

/** 예상에너지사용량 [kWh] = 연면적(주차장 제외) × 단위에너지사용량 × 지역계수 */
export function expectedEnergy({ area, use, region, clientType = "private", parkingArea = 0 }) {
  const netArea = area - (parkingArea || 0);
  return netArea * getUnitEnergy(use, clientType) * getRegionFactor(region);
}

/** 신재생에너지 생산량 [kWh] = 설치규모 × 단위에너지생산량 × 원별보정계수 */
export function reProduction(sourceKey, size) {
  const s = RE_SOURCE.data[sourceKey];
  if (!s) throw new Error(`신재생에너지원 조회 실패: "${sourceKey}"`);
  return size * s.prod * s.k;
}

/** 공급의무비율 만족에 필요한 설치규모 */
export function requiredSize(sourceKey, expected, ratioPercent) {
  const s = RE_SOURCE.data[sourceKey];
  if (!s) throw new Error(`신재생에너지원 조회 실패: "${sourceKey}"`);
  return (expected * ratioPercent / 100) / (s.prod * s.k);
}

export function publicRatio(year) {
  const row = PUBLIC_RE_RATIO.data.find(r => year >= r.from && year <= r.to);
  return row ? row.ratio : null;
}

/** ZEB 등급 판정 (자립률 또는 1차에너지소요량 중 상위 등급) */
export function zebGrade({ selfSufficiency = null, primary = null, isResidential = false }) {
  const key = isResidential ? "primaryResi" : "primaryNonResi";
  for (const g of ZEB.grades) {
    const bySelf = selfSufficiency != null && selfSufficiency >= g.selfSufficiency;
    const byPrim = primary != null && primary < g[key];
    if (bySelf || byPrim) return g.grade;
  }
  return null;
}

/** 계획단계 개략 자립률 [%] (참고용) */
export function estimateSelfSufficiency(items, expected) {
  // items: [{ sourceKey, size, planningKey }]
  return items.reduce((sum, it) => {
    const supply = reProduction(it.sourceKey, it.size) / expected * 100;
    const f = ZEB.planningFactor[it.planningKey ?? it.sourceKey] ?? 1;
    return sum + supply * f;
  }, 0);
}

/** 친환경주택 50점(조명) 확보용 PV 용량 [kW] */
export function greenHomePv(exclusiveArea) {
  return exclusiveArea * GREEN_HOME.pvRule.coef;
}

/** 개산 공사비 [원] */
export function estimateCost(sourceKey, size) {
  const p = RE_SOURCE.data[sourceKey]?.price;
  return p ? size * p : null;
}

/** 설치 필요면적 [㎡] (안전율 반영) */
export function requiredArea(sourceKey, sizeKw) {
  const perKw = sourceKey === "BIPV" ? PV_SPEC.BIPV_AREA_PER_KW : PV_SPEC.AREA_PER_KW;
  return sizeKw * perKw * SAFETY_AREA;
}

export default {
  DATA_VERSION, SOURCE_VERSION, EFFECTIVE, TOE, SAFETY_AREA, PV_SPEC,
  SECTOR, USE_SECTOR, USE_ALIAS, UNIT_ENERGY, REGION_FACTOR, RE_SOURCE,
  PUBLIC_RE_RATIO, LOCAL_STANDARD, ZEB, GREEN_HOME, EPI, GSEED, INCENTIVE,
  U_VALUE, INSULATION_K, EXTENSION_RULE, DONATION_RULE,
  resolveSector, getUnitEnergy, getRegionFactor, expectedEnergy,
  reProduction, requiredSize, publicRatio, zebGrade, estimateSelfSufficiency,
  greenHomePv, estimateCost, requiredArea
};
