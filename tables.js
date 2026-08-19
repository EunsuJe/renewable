/* ============================================================
   tables.js  —  데이터 테이블
   ※ 고시/공고 개정 시 이 파일만 수정하면 됩니다.
   ※ verified:false 항목은 반드시 원문 확인 후 true로 바꾸세요.
   ============================================================ */

const DATA_VERSION = "2026-08-19";

/* toe 환산계수 — 에너지열량환산기준 */
const TOE = {
  KWH_FINAL: 0.000086,      // 최종에너지 기준 (860kcal/kWh ÷ 10^7)
  KWH_ELEC_PRIMARY: 0.000215 // 전력 1차에너지 기준 (심의체 따라 상이)
};

const SAFETY_AREA = 1.2;   // 설비 여유율

/* ------------------------------------------------------------
   [T1] 원별 단위에너지생산량 / 보정계수
        출처: 신·재생에너지 설비의 지원 등에 관한 지침 별표
   ------------------------------------------------------------ */
const COEFF = [
  { from:"2024-01-01", to:null, src:"KNREC지침 별표10", key:"PV_FIX",
    name:"태양광(고정식)", unit:"kW", gen:1358, cf:0.95,
    area:10.0, mount:"roof",   cost:250,  verified:true },
  { from:"2024-01-01", to:null, src:"KNREC지침 별표10", key:"PV_TRK",
    name:"태양광(추적식)", unit:"kW", gen:1765, cf:1.47,
    area:14.0, mount:"roof",   cost:380,  verified:true },
  { from:"2024-01-01", to:null, src:"KNREC지침 별표10", key:"BIPV",
    name:"BIPV",          unit:"kW", gen:923,  cf:6.12,
    area:8.0,  mount:"facade", cost:450,  verified:true },
  { from:"2024-01-01", to:null, src:"KNREC지침 별표10", key:"ST_FLAT",
    name:"태양열(평판형)", unit:"㎡", gen:596,  cf:1.78,
    area:1.0,  mount:"roof",   cost:150,  verified:true },
  { from:"2024-01-01", to:null, src:"KNREC지침 별표10", key:"ST_VAC",
    name:"태양열(단일진공관형)", unit:"㎡", gen:745, cf:1.42,
    area:1.0,  mount:"roof",   cost:180,  verified:true },
  { from:"2024-01-01", to:null, src:"KNREC지침 별표10", key:"GEO_CLOSE",
    name:"지열(수직밀폐형)", unit:"kW", gen:864, cf:1.26,
    area:0,    mount:"under",  cost:300,  verified:true },
  { from:"2024-01-01", to:null, src:"KNREC지침 별표10", key:"GEO_OPEN",
    name:"지열(개방형)",  unit:"kW", gen:864,  cf:1.00,
    area:0,    mount:"under",  cost:280,  verified:true },
  { from:"2024-01-01", to:null, src:"KNREC지침 별표10", key:"LIGHT_DUCT",
    name:"집광채광(광덕트)", unit:"㎡", gen:73, cf:7.77,
    area:1.0,  mount:"roof",   cost:100,  verified:true },
  { from:"2024-01-01", to:null, src:"KNREC지침 별표10", key:"FC_PEM",
    name:"연료전지(PEMFC)", unit:"kW", gen:7415, cf:2.20,
    area:3.0,  mount:"none",   cost:2600, verified:true },
  { from:"2024-01-01", to:null, src:"KNREC지침 별표10", key:"FC_SOFC",
    name:"연료전지(SOFC)",  unit:"kW", gen:9198, cf:8.71,
    area:3.0,  mount:"none",   cost:3000, verified:true },
  { from:"2024-01-01", to:null, src:"KNREC지침 별표10", key:"HYDRO_RIVER",
    name:"수열(하천수)",   unit:"kW", gen:864, cf:1.30,
    area:0,    mount:"none",   cost:320,  verified:true },
  { from:"2024-01-01", to:null, src:"KNREC지침 별표10", key:"WIND_S",
    name:"소형풍력",      unit:"kW", gen:2375, cf:4.50,
    area:20.0, mount:"roof",   cost:600,  verified:false }
];

/* 재생열로 인정하는 원 (서울시 재생열 의무 판정용) */
const HEAT_SOURCES = ["GEO_CLOSE","GEO_OPEN","HYDRO_RIVER"];

/* ------------------------------------------------------------
   [T2] 용도별 단위에너지사용량 (kWh/㎡·yr)
        ※ 용도별 보정계수는 2017.4.1. 폐지 — 곱하지 말 것
   ------------------------------------------------------------ */
const UNIT_ENERGY = [
  { from:"2017-04-01", sector:"공공용",   use:"업무시설",        v:371.66, verified:true },
  { from:"2017-04-01", sector:"공공용",   use:"방송통신시설",     v:490.18, verified:true },
  { from:"2017-04-01", sector:"공공용",   use:"교정시설",        v:371.66, verified:false },
  { from:"2017-04-01", sector:"문교사회용", use:"문화및집회시설",   v:412.03, verified:true },
  { from:"2017-04-01", sector:"문교사회용", use:"의료시설",        v:643.52, verified:true },
  { from:"2017-04-01", sector:"문교사회용", use:"교육연구시설",     v:231.33, verified:true },
  { from:"2017-04-01", sector:"문교사회용", use:"노유자시설",      v:231.33, verified:false },
  { from:"2017-04-01", sector:"상업용",   use:"판매시설",        v:408.45, verified:true },
  { from:"2017-04-01", sector:"상업용",   use:"업무시설",        v:374.47, verified:true },
  { from:"2017-04-01", sector:"상업용",   use:"숙박시설",        v:526.55, verified:true },
  { from:"2017-04-01", sector:"상업용",   use:"운수시설",        v:374.47, verified:false },
  { from:"2025-01-02", sector:"주거",     use:"공동주택",        v:230.00, verified:true }
];

/* ------------------------------------------------------------
   [T3] 지역계수  ★★ 미검증 — 지침 별표 원문으로 반드시 채우세요
   ------------------------------------------------------------ */
const REGION_FACTOR = {
  _verified: false,
  _note: "전 지역 1.00으로 임시 설정됨. 지침 별표 확인 후 실제값 입력 필요.",
  "서울특별시":1.00,"부산광역시":1.00,"대구광역시":1.00,"인천광역시":1.00,
  "광주광역시":1.00,"대전광역시":1.00,"울산광역시":1.00,"세종특별자치시":1.00,
  "경기도":1.00,"강원특별자치도":1.00,"충청북도":1.00,"충청남도":1.00,
  "전북특별자치도":1.00,"전라남도":1.00,"경상북도":1.00,"경상남도":1.00,
  "제주특별자치도":1.00
};

/* ------------------------------------------------------------
   [T4] 공공기관 설치의무화 공급의무비율
   ------------------------------------------------------------ */
const PUBLIC_SCHEDULE = [
  { from:"2020-01-01", to:"2021-12-31", pct:30 },
  { from:"2022-01-01", to:"2023-12-31", pct:32 },
  { from:"2024-01-01", to:"2025-12-31", pct:34 },
  { from:"2026-01-01", to:"2027-12-31", pct:36 },
  { from:"2028-01-01", to:"2029-12-31", pct:38 },
  { from:"2030-01-01", to:null,         pct:40 }
];

const PUBLIC_ELIGIBLE_USES = [
  "업무시설","방송통신시설","교정시설","문화및집회시설","종교시설","의료시설",
  "교육연구시설","노유자시설","수련시설","운동시설","묘지관련시설",
  "관광휴게시설","장례시설","판매시설","운수시설","숙박시설","위락시설"
];
const PUBLIC_EXCLUDED_USES = ["공동주택","단독주택","창고시설","위험물저장및처리시설","발전시설"];

/* ------------------------------------------------------------
   [T5] 지자체 기준 — 서울특별시 녹색건축물 설계기준
   ------------------------------------------------------------ */
const LOCAL_STANDARDS = {
  "서울특별시": {
    name: "서울특별시 녹색건축물 설계기준",
    basis: "서울특별시 고시 (5차 개정, 2025.1.2. 시행)",
    verified: true,
    grades: ["가","나","다","라"],
    gradeBySize: {
      residential:    [ {grade:"가", min:1000}, {grade:"나", min:300},
                        {grade:"다", min:30},   {grade:"라", min:0} ],   // 세대수
      nonResidential: [ {grade:"가", min:100000},{grade:"나", min:10000},
                        {grade:"다", min:3000}, {grade:"라", min:0} ]    // ㎡
    },
    ratios: [
      { from:"2025-01-01", to:"2025-12-31",
        public:{res:34, non:34}, "가":{res:11,   non:15},
        "나":{res:10.5, non:14},  "다":{res:10,   non:13}, "라":null },
      { from:"2026-01-01", to:"2026-12-31",
        public:{res:36, non:36}, "가":{res:11.5, non:15.5},
        "나":{res:11,   non:14.5},"다":{res:10.5, non:13.5}, "라":null },
      { from:"2027-01-01", to:null,
        public:{res:36, non:36}, "가":{res:12,   non:16},
        "나":{res:11.5, non:15},  "다":{res:11,   non:14}, "라":null }
    ],
    renewableHeat: { minGfaNonRes:30000, ratioOfRequired:0.5,
                     altUndergroundRatio:0.5 }
  }
  /* 경기도·인천 등은 고시 확인 후 동일 구조로 추가 */
};

/* ------------------------------------------------------------
   [T6] 에너지사용계획 협의 대상 규모
   ------------------------------------------------------------ */
const ESP_THRESHOLD = {
  public:  { toe:2500, kwh:10000000 },
  private: { toe:5000, kwh:20000000 },
  defaultTargetPct: 0.40,
  note: "0.4% 이상 양호 기준. 심의 재량으로 상향 가능(예: 0.45%)."
};

/* ------------------------------------------------------------
   [T7] ZEB 자립률 등급
   ------------------------------------------------------------ */
const ZEB_GRADE = [
  { grade:5, min:20,  max:40  }, { grade:4, min:40,  max:60 },
  { grade:3, min:60,  max:80  }, { grade:2, min:80,  max:100 },
  { grade:1, min:100, max:null }
];
const ZEB_MANDATE = [
  { from:"2025-01-01", scope:"public",  minGfa:500,  minHouse:30, grade:5 },
  { from:"2025-01-01", scope:"public",  minGfa:1000, minHouse:null, grade:4,
    note:"일부 용도 限" },
  { from:"2025-06-30", scope:"private", minGfa:1000, minHouse:30, grade:5,
    note:"5등급 수준 설계" },
  { from:"2030-01-01", scope:"private", minGfa:500,  minHouse:30, grade:5 }
];

/* 서울시 환경영향평가 대상 (조례) */
const EIA_SEOUL = { gfa:100000, redevelopArea:90000, verified:true };
