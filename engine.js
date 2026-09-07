/* =========================================================================
 * engine.js — 입력 파싱 · 계산 · 리포트 렌더링
 * 5단계 입력 플로우:
 *   STEP1 공사개요 OCR 추출 → STEP2 필수 입력값(OCR 프리필+확인)
 *   → STEP3 취득 여부 선택(의무/선택/잠금 판정) → STEP4 조건부 입력
 *   → STEP5 예외·갈음 조항 입력 → 최종 리포트
 * ========================================================================= */
import * as T from "./tables.js?v=20260907";
import { CERTIFICATIONS, CERT_SOURCE } from "./certifications.js?v=20260907";
import { evaluateCert } from "./certRules.js?v=20260907";
import { parseOverviewText } from "./autofill.js?v=20260907";

const $  = (id) => document.getElementById(id);
const num = (id) => {
  const el = $(id);
  if (!el) return 0;
  const v = parseFloat(String(el.value).replace(/,/g, "").trim());
  return isNaN(v) ? 0 : v;
};
const fmt = (n, d = 0) =>
  n == null || isNaN(n) ? "-" : n.toLocaleString("ko-KR",
    { minimumFractionDigits: d, maximumFractionDigits: d });

$("ver").textContent = `데이터 버전 ${T.DATA_VERSION} · ${T.SOURCE_VERSION}`;

const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, c => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ========================================================================
 * STEP 1 — 설계개요 자동입력 (OCR/PDF/텍스트)
 * ===================================================================== */
let lastOverviewParse = null;
const CONF_LABEL = { high: "높음", mid: "중간", low: "낮음" };
const CONF_COLOR = { high: "#16a34a", mid: "#d97706", low: "#dc2626" };

function renderOverviewPreview(result) {
  const wrap = $("overviewPreview");
  if (!result.fields.length) {
    wrap.innerHTML = `<div class="alert warn"><b>인식된 항목이 없습니다</b>${result.warnings.map(w => escHtml(w)).join("<br>")}</div>`;
    $("applyOverview").disabled = true;
    return;
  }
  const rowsHtml = result.fields.map((f, i) => `
    <tr data-idx="${i}">
      <td style="width:26px;text-align:center;"><input type="checkbox" class="ov-chk" checked></td>
      <td>${escHtml(f.label)}
        <span style="color:${CONF_COLOR[f.confidence] || "#6b7280"};font-size:11px;">● 인식신뢰도 ${CONF_LABEL[f.confidence] || "-"}</span>
        <div class="muted" style="font-size:11px;">원문: "${escHtml(f.raw)}"${f.note ? ` · ${escHtml(f.note)}` : ""}</div>
      </td>
      <td><input class="ov-val" value="${escHtml(f.value)}" style="padding:4px 6px;"></td>
    </tr>`).join("");

  const infoHtml = result.infoOnly.length ? `
    <div class="muted" style="margin-top:10px;"><b>참고용 (해당 입력필드 없어 자동입력 안 됨)</b><br>${
      result.infoOnly.map(x => `· ${escHtml(x.label)}: ${escHtml(x.value)} <span style="opacity:.75">(${escHtml(x.note)})</span>`).join("<br>")
    }</div>` : "";

  const floorHtml = result.floorTable.length ? `
    <div class="muted" style="margin-top:6px;">층별 면적표 ${result.floorTable.length}행 인식됨 (지상연면적/지하연면적 자동합산에 참고, 개별 반영은 안 됨)</div>` : "";

  const warnHtml = result.warnings.length ? `
    <div class="alert info" style="margin-top:8px;">${result.warnings.map(w => `· ${escHtml(w)}`).join("<br>")}</div>` : "";

  wrap.innerHTML = `
    <table style="margin:6px 0;">
      <tr><th style="width:26px"></th><th style="width:auto">항목</th><th style="width:160px">적용값 (수정 가능)</th></tr>
      ${rowsHtml}
    </table>
    ${infoHtml}${floorHtml}${warnHtml}`;
  $("applyOverview").disabled = false;
}

$("parseOverview").addEventListener("click", () => {
  const text = $("overviewText").value;
  lastOverviewParse = parseOverviewText(text);
  renderOverviewPreview(lastOverviewParse);
});

/* ---------- 이미지/PDF 업로드 → 텍스트 추출(OCR/PDF텍스트) ---------- */
if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

function setOcrStatus(msg, isError) {
  const el = $("ocrStatus");
  el.textContent = msg;
  el.style.color = isError ? "#dc2626" : "#6b7280";
}

async function ocrImageSource(imgSource, onProgress) {
  const { data } = await Tesseract.recognize(imgSource, "kor+eng", {
    logger: (m) => {
      if (m.status && typeof m.progress === "number") {
        onProgress?.(`${m.status} ${(m.progress * 100).toFixed(0)}%`);
      }
    }
  });
  return data.text || "";
}

async function extractTextFromPdf(file, onProgress) {
  if (!window.pdfjsLib) throw new Error("PDF 라이브러리를 불러오지 못했습니다. 네트워크 연결을 확인하세요.");
  const buf = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;

  let textLayer = "";
  const maxPages = Math.min(pdf.numPages, 10);
  for (let p = 1; p <= maxPages; p++) {
    onProgress?.(`PDF 텍스트 레이어 확인 중 (${p}/${maxPages}페이지)`);
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    textLayer += content.items.map((it) => it.str).join(" ") + "\n";
  }

  if (textLayer.replace(/\s/g, "").length >= 30) {
    return { text: textLayer, mode: "pdf-text" };
  }

  onProgress?.("텍스트 레이어가 부족하여 이미지로 변환 후 OCR을 진행합니다...");
  let ocrText = "";
  for (let p = 1; p <= maxPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;
    onProgress?.(`OCR 진행 중 (${p}/${maxPages}페이지)`);
    ocrText += await ocrImageSource(canvas, (s) => onProgress?.(`OCR 진행 중 (${p}/${maxPages}페이지) — ${s}`));
    ocrText += "\n";
  }
  return { text: ocrText, mode: "pdf-ocr" };
}

$("overviewFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const btn = $("parseOverview");
  btn.disabled = true;
  try {
    let extracted = "";
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
      setOcrStatus("PDF 분석 중...");
      const { text, mode } = await extractTextFromPdf(file, (s) => setOcrStatus(s));
      extracted = text;
      setOcrStatus(`완료 (${mode === "pdf-text" ? "PDF 텍스트 레이어 사용" : "스캔 PDF → OCR 사용"}). 아래 텍스트를 확인 후 [③ 인식하기]를 눌러주세요.`);
    } else if (file.type.startsWith("image/")) {
      setOcrStatus("이미지 OCR 진행 중... (수 초~수십 초 소요될 수 있습니다)");
      extracted = await ocrImageSource(file, (s) => setOcrStatus(`이미지 OCR 진행 중... ${s}`));
      setOcrStatus("완료. 아래 텍스트를 확인 후 [③ 인식하기]를 눌러주세요.");
    } else {
      setOcrStatus("지원하지 않는 파일 형식입니다. 이미지(PNG/JPG) 또는 PDF를 선택하세요.", true);
      return;
    }

    if (!extracted.trim()) {
      setOcrStatus("텍스트를 인식하지 못했습니다. 더 선명한 이미지/PDF로 다시 시도하거나 직접 붙여넣으세요.", true);
      return;
    }
    $("overviewText").value = extracted.trim();
    lastOverviewParse = parseOverviewText(extracted);
    renderOverviewPreview(lastOverviewParse);
  } catch (err) {
    setOcrStatus(`인식 실패: ${err.message}`, true);
  } finally {
    btn.disabled = false;
  }
});

function setFieldValue(target, value) {
  const el = document.querySelector(target);
  if (!el) return false;
  el.value = value;
  return true;
}

$("applyOverview").addEventListener("click", () => {
  if (!lastOverviewParse) return;
  const rows = document.querySelectorAll("#overviewPreview tr[data-idx]");
  const applied = [];
  let useVal = null, gfaTotalVal = null;

  rows.forEach(tr => {
    const idx = parseInt(tr.dataset.idx, 10);
    const f = lastOverviewParse.fields[idx];
    const chk = tr.querySelector(".ov-chk").checked;
    const val = tr.querySelector(".ov-val").value;
    if (!chk || !f) return;

    if (f.key === "useMixGuess") { useVal = val; return; }
    setFieldValue(f.target, val);
    applied.push(f.label);
    if (f.key === "gfa_total") gfaTotalVal = val;
  });

  if (useVal) {
    const area = gfaTotalVal || $("gfa_total").value;
    if (area) {
      $("useMix").value = `${useVal},${area}`;
      applied.push("용도 구성(use_code_list)");
    } else {
      applied.push("(용도명은 인식했으나 면적 정보가 없어 용도 구성에는 반영하지 못했습니다 — 직접 입력하세요)");
    }
  }

  // gfa_total이 적용됐다면 gfa_hvac 기본값도 같이 채워준다(수동 보정 대상임을 유지)
  if (gfaTotalVal && (!$("gfa_hvac").value || num("gfa_hvac") === 0)) {
    $("gfa_hvac").value = gfaTotalVal;
  }

  // owner_name이 적용됐다면 owner_type 추정 힌트를 갱신
  updateOwnerTypeGuess();
  updateHint();
  refreshParkingStallHint();

  const wrap = $("overviewPreview");
  wrap.insertAdjacentHTML("beforeend",
    `<div class="alert ok" style="margin-top:8px;"><b>${applied.length}개 항목 적용 완료</b>
     ${applied.map(a => escHtml(a)).join(" · ")}. STEP2 필수 입력값을 확인·확정한 뒤 [STEP3 취득 여부 판정 실행]을 눌러주세요.</div>`);
});

/* ========================================================================
 * STEP 2 — 필수 입력값 보조 로직 (owner_type 추정, 지자체 기준 힌트, 주차구획 추정)
 * ===================================================================== */
function updateOwnerTypeGuess() {
  const guess = T.guessOwnerType($("owner_name").value);
  const hint = $("ownerTypeGuessHint");
  if (!guess.matched) {
    hint.textContent = "건축주·시행자명을 입력하면 발주주체 구분을 추정합니다(자동 확정되지 않음 — 반드시 아래에서 확정하세요).";
    return;
  }
  hint.innerHTML = `추정: <b>${escHtml(guess.label)}</b> (근거: "${escHtml(guess.matched)}") — 정부출연기관·지방공기업은 상호명만으로 판별 불가하니 반드시 확인 후 확정하세요.`;
}
$("owner_name")?.addEventListener("input", updateOwnerTypeGuess);
updateOwnerTypeGuess();

function updateHint() {
  const { key, fallback } = T.resolveLocalStandard($("sido").value, $("sigungu").value);
  $("localHint").textContent = fallback
    ? `적용 기준: 그 외 지역 (별도 설계기준 없음)`
    : `적용 기준: ${key} (${T.LOCAL_STANDARD.data[key].revision ?? "-"})`;
}
$("sido").addEventListener("change", updateHint);
$("sigungu").addEventListener("input", updateHint);
updateHint();

function refreshParkingStallHint() {
  const { area, nearThreshold } = T.estimateParkingStallArea(num("parking_count"));
  const stallInput = $("parking_stall_area");
  if (num("parking_stall_area") === 0 && area > 0) stallInput.value = area.toFixed(1);
  const hint = $("parkingStallHint");
  hint.textContent = `대수 ${fmt(num("parking_count"))}대 × 12.5㎡ ≈ ${fmt(area, 1)}㎡ 추정치.` +
    (nearThreshold ? " ⚠ 1,000㎡ 임계치 근방(80대 전후)입니다 — 실측값을 반드시 입력하세요." :
      " 1,000㎡ 임계치와 거리가 있으면 추정치로도 판정 가능합니다.");
}
$("parking_count")?.addEventListener("input", refreshParkingStallHint);
refreshParkingStallHint();

/* 지자체 조례 강화 세부입력 토글 (STEP2 C.입지) */
$("local_ordinance_applied")?.addEventListener("change", (e) => {
  $("ordinanceDetail").style.display = e.target.checked ? "grid" : "none";
});

/* ========================================================================
 * STEP 5 — 예외·갈음 조항 세부입력 토글
 * ===================================================================== */
const STEP5_TOGGLES = [
  ["is_permit_change", "permitChangeDetail"],
  ["local_bldg_committee_reviewed", "committeeDetail"],
  ["apply_previous_law", "prevLawDetail"],
  ["prior_cert_exists", "priorCertDetail"]
];
STEP5_TOGGLES.forEach(([chkId, detailId]) => {
  const chk = $(chkId), detail = $(detailId);
  if (!chk || !detail) return;
  chk.addEventListener("change", () => { detail.style.display = chk.checked ? "block" : "none"; });
});

/* ========================================================================
 * 용도 구성 파싱 (use_code_list)
 * ===================================================================== */
function parseUseMix(text, isPublicOwner) {
  const notes = [];
  const clientTypeForSector = isPublicOwner ? "public" : "private";
  const rows = String(text).replace(/，/g, ",").split(/\n+/)
    .map(s => s.trim()).filter(Boolean)
    .map((line, i) => {
      const p = line.split(",").map(s => s.trim());
      if (p.length < 2)
        throw new Error(`${i + 1}행 형식 오류: "${line}" → "용도,부문,면적" 또는 "용도,면적"`);

      let use, sector, area;
      if (p.length === 2) { use = p[0]; sector = null; area = parseFloat(p[1]); }
      else { use = p[0]; sector = p[1] || null; area = parseFloat(p[2]); }

      if (isNaN(area) || area <= 0) throw new Error(`${i + 1}행 면적 오류: "${line}"`);

      const ue = T.getUnitEnergy(use, clientTypeForSector, sector);
      if (ue.note) notes.push(`${i + 1}행 ${use}: ${ue.note}`);
      return { use: T.normUse(use), sector: ue.sector, area, unit: ue.value };
    });
  if (!rows.length) throw new Error("용도 구성(use_code_list)이 비어 있습니다.");
  return { rows, notes };
}

/* ========================================================================
 * 공통 컨텍스트 수집 — STEP2·STEP4·STEP5 입력을 모아 certRules.js에 전달
 * ===================================================================== */
function collectCtx() {
  const ownerType = $("owner_type").value;
  const isPublicOwner = T.isPublicOwnerType(ownerType);
  const houseSubtype = $("house_subtype").value;
  const { rows, notes } = parseUseMix($("useMix").value, isPublicOwner);

  const parkingKindAny = $("parking_kind_road").checked || $("parking_kind_off").checked || $("parking_kind_attached").checked;

  return {
    // STEP2 A
    projName: $("proj_name").value,
    ownerName: $("owner_name").value,
    ownerType, isPublicOwner,
    permitTrack: $("permit_track").value,
    projectType: $("project_type").value,

    // STEP2 B
    gfaTotal: num("gfa_total"),
    gfaHvac: num("gfa_hvac"),
    rows, useMixNotes: notes,
    unitsTotal: num("units_total"),
    houseSubtype,
    floorsAbove: num("floors_above"),
    projectSiteArea: num("project_site_area"),
    parkingCount: num("parking_count"),
    parkingStallArea: num("parking_stall_area"),
    parkingKindAny,
    isHighRiseComplex: $("is_high_rise_complex").checked,
    transportFacility: $("transportFacility").checked,
    cptedNeighborhood: $("cptedNeighborhood").checked,
    cptedLodging: $("cptedLodging").checked,

    // STEP2 C (입지)
    sido: $("sido").value,
    sigungu: $("sigungu").value,
    redevDistrict: $("redev_district").checked,
    eduWithin200m: $("edu_within_200m").checked,
    tmdlBasin: $("tmdl_basin").checked,
    isSpecialArea: $("is_special_area").checked,
    eiaTarget: $("eia_target").checked,
    localOrdinanceApplied: $("local_ordinance_applied").checked,
    ordinanceName: $("ordinance_name").value,
    ordinanceValue: $("ordinance_value").value,

    // STEP2 D (시점)
    datePermitApply: $("date_permit_apply").value,
    dateStart: $("date_start").value,
    dateUseInspect: $("date_use_inspect").value,

    // STEP5 예외·갈음
    exemptEpiByEcohouse: $("exempt_epi_by_ecohouse").checked,
    epiReplacedByZeb: $("epi_replaced_by_zeb").checked,
    isPermitChange: $("is_permit_change").checked,
    originalPermitGfa: num("original_permit_gfa"),
    localBldgCommitteeReviewed: $("local_bldg_committee_reviewed").checked,
    committeeReviewDate: $("committee_review_date").value,
    committeeReviewNo: $("committee_review_no").value,
    militaryExclude: $("militaryExclude").checked,
    dormitory: $("dormitory").checked,
    tmdlCoveredByEia: $("tmdl_covered_by_eia").checked,
    applyPreviousLaw: $("apply_previous_law").checked,
    previousLawVersion: $("previous_law_version").value,
    priorCertExists: $("prior_cert_exists").checked,
    priorCertId: $("prior_cert_id").value,
    priorCertExpiry: $("prior_cert_expiry").value,

    zebGrade4Uses: T.ZEB.grade4Uses
  };
}

/* ========================================================================
 * STEP 3 — 취득 여부 선택 UI
 * ===================================================================== */
const STATUS_LABEL = {
  apply: { badge: "대상(의무)", cls: "ok" },
  not_apply: { badge: "비대상", cls: "muted-badge" },
  check: { badge: "확인필요", cls: "warn" }
};

let lastCertRows = []; // [{c, r}]

function renderStep3(certCtx) {
  const certRows = CERTIFICATIONS.map(c => ({ c, r: evaluateCert(c.id, certCtx) }));
  const order = { apply: 0, check: 1, not_apply: 2 };
  certRows.sort((a, b) => order[a.r.status] - order[b.r.status] || a.c.order - b.c.order);
  lastCertRows = certRows;

  const rowsHtml = certRows.map(({ c, r }) => {
    let badgeHtml, note;
    if (r.status === "apply") {
      if (c.kind === "lockable_upgrade") {
        badgeHtml = `<span class="badge locked-opt">🔒 의무 (상위등급 선택가능)</span>`;
        note = "의무 판정. STEP4에서 목표등급을 선택하세요.";
      } else if (c.kind === "voluntary_re") {
        badgeHtml = `<span class="badge locked">🔒 의무</span>`;
        note = "의무 판정 — 선택권 없음.";
      } else {
        badgeHtml = `<span class="badge locked">🔒 의무(잠금)</span>`;
        note = "요건 충족 확인됨 — 선택권 없음, STEP5 예외 조항만 확인.";
      }
    } else if (r.status === "not_apply") {
      badgeHtml = `<span class="badge none">해당 없음</span>`;
      note = "요건 미달 — 대상이 아님(자발 취득 여부와는 다른 상태).";
    } else { // check
      if (c.kind === "always_voluntary") {
        badgeHtml = `<span class="badge optional">선택 가능 (자발)</span>`;
        note = "법적 의무대상 아님. 취득 여부를 선택하세요.";
      } else {
        badgeHtml = `<span class="badge optional">선택 가능</span>`;
        note = "자동판정 불가 또는 지자체기준 대상 — 취득 여부(선택)를 결정하세요.";
      }
    }

    const acquireChoice = (r.status !== "apply" || c.kind === "lockable_upgrade")
      ? `<label style="display:inline-flex;align-items:center;gap:4px;margin:4px 0 0;font-size:11.5px;">
           <input type="checkbox" class="acq-chk" data-cert="${c.id}" ${r.status === "apply" ? "checked disabled" : ""}>
           ${r.status === "apply" ? "상위등급 목표 설정" : "취득함(자발)"}
         </label>`
      : "";

    return `<div class="acq-row">
      <div class="acq-main">
        <span class="acq-name">${escHtml(c.name)}</span> ${badgeHtml}
        <div class="acq-reason">${r.reasons.map(x => escHtml(x)).join(" · ")}</div>
        <div class="acq-reason" style="color:#9ca3af;">${note}</div>
        ${acquireChoice}
      </div>
    </div>`;
  }).join("");

  $("step3List").innerHTML = rowsHtml;
  $("step3Card").style.display = "";
  updateStep4Visibility();
  $("step4Card").style.display = "";
  $("step5Card").style.display = "";
}

function acquiredCertIds() {
  const ids = new Set();
  lastCertRows.forEach(({ c, r }) => {
    if (r.status === "apply") ids.add(c.id); // 의무 대상은 항상 조건부입력 노출
  });
  document.querySelectorAll(".acq-chk:checked").forEach(chk => ids.add(chk.dataset.cert));
  return ids;
}

function updateStep4Visibility() {
  const acquired = acquiredCertIds();
  document.querySelectorAll(".cond-block").forEach(block => {
    const certId = block.dataset.cert;
    const relevant = certId === "RE_VOLUNTARY"
      ? (lastCertRows.find(x => x.c.id === "RE_MANDATORY")?.r.status !== "apply" && document.querySelector('.acq-chk[data-cert="RE_MANDATORY"]')?.checked)
      : acquired.has(certId);
    block.classList.toggle("show", !!relevant);
  });
}

$("evalStep3").addEventListener("click", () => {
  try {
    const ctx = collectCtx();
    renderStep3(ctx);
    document.querySelectorAll("#sb1,#sb2").forEach(el => el.classList.add("done"));
    $("sb3").classList.add("active");
  } catch (e) {
    $("step3List").innerHTML = `<div class="alert error"><b>판정 중단</b>${escHtml(e.message)}</div>`;
    $("step3Card").style.display = "";
  }
});

document.addEventListener("change", (e) => {
  if (e.target.classList && e.target.classList.contains("acq-chk")) updateStep4Visibility();
});

/* ========================================================================
 * 최종 리포트 실행 (STEP2~5 전체 반영)
 * ===================================================================== */
function run() {
  const out = [];
  const push = (t, title, body) =>
    out.push(`<div class="alert ${t}"><b>${title}</b>${body}</div>`);

  try {
    const ctx = collectCtx();
    const { rows, useMixNotes: notes } = ctx;
    const sido = ctx.sido, sigungu = ctx.sigungu;
    const gfaTotal = ctx.gfaTotal;
    const parkingArea = 0; // 레거시 "연면적 산입 주차장 면적" — 지하개발 안내에만 참고 사용
    const year = new Date(ctx.datePermitApply || Date.now()).getFullYear();

    /* 1. 용도·면적 */
    const useSum = rows.reduce((s, r) => s + r.area, 0);
    notes.forEach(n => push("info", "부문 자동보정", n));

    if (Math.abs(useSum - gfaTotal) > 0.5)
      push("warn", "연면적 불일치",
        `연면적 합계(gfa_total) ${fmt(gfaTotal, 1)}㎡ vs 용도구성 합계 ${fmt(useSum, 1)}㎡ ` +
        `(차이 ${fmt(Math.abs(useSum - gfaTotal), 1)}㎡). 한쪽으로 통일하세요.`);

    if (ctx.gfaHvac < gfaTotal)
      push("info", "gfa_hvac(냉난방면적) < gfa_total",
        `냉난방 공간 연면적 ${fmt(ctx.gfaHvac, 1)}㎡ < 연면적 합계 ${fmt(gfaTotal, 1)}㎡. ` +
        `EPI 제출 예외(별표1 제1·3아·5·13·16~17호, 500㎡ 미만) 판정에 사용됩니다.`);

    if (num("basementArea") > 0 && ctx.parkingStallArea === 0)
      push("warn", "주차구획 면적 미입력",
        `지하개발 ${fmt(num("basementArea"))}㎡가 있으나 parking_stall_area가 0입니다. 신재생 주차장 의무(1,000㎡) 판정에 영향을 줍니다.`);

    /* 2. 예상에너지사용량 */
    const rf = T.getRegionFactor(sido, sigungu);
    const netRatio = gfaTotal > 0 ? (gfaTotal - parkingArea) / gfaTotal : 1;
    const expected = rows.reduce((s, r) => s + r.area * netRatio * r.unit, 0) * rf.value;

    /* 3. 적용 의무비율 */
    const ovRatio = num("ovRatio");
    const local = T.getLocalTier(sido, sigungu, ctx.unitsTotal, { clientType: ctx.isPublicOwner ? "public" : "private", zebCertified: document.querySelector('.acq-chk[data-cert="ZEB"]')?.checked || false });
    const isResidential = ctx.unitsTotal > 0;

    let ratio = null, ratioSrc = "";
    if (ovRatio > 0) { ratio = ovRatio; ratioSrc = `심의 반영값 (${$("ovReason").value})`; }
    else if (ctx.isPublicOwner) {
      ratio = T.publicRatio(year); ratioSrc = `공공기관(${ctx.ownerType}) 공급의무비율 ${year}년`;
    } else if (isResidential && typeof local.re === "number") {
      ratio = local.re; ratioSrc = `${local.key} 녹색건축물 설계기준 ${local.tier}등급`;
    }

    /* ---------- 리포트 ---------- */
    out.push(`<h3>1. 산정 기초</h3><table>
      <tr><th>사업명(proj_name)</th><td>${escHtml(ctx.projName)}</td></tr>
      <tr><th>위치 / 지역계수</th><td>${sido} ${sigungu} — ${rf.key} × ${rf.value}</td></tr>
      <tr><th>건축주(owner_name) / 발주주체(owner_type)</th><td>${escHtml(ctx.ownerName) || "-"} / <b>${ctx.ownerType}</b>${ctx.isPublicOwner ? " (공공)" : " (민간)"}</td></tr>
      <tr><th>인허가유형 / 사업유형</th><td>${ctx.permitTrack} / ${ctx.projectType}</td></tr>
      <tr><th>연면적 합계(gfa_total) / 냉난방면적(gfa_hvac)</th><td class="num">${fmt(gfaTotal, 1)} ㎡ / ${fmt(ctx.gfaHvac, 1)} ㎡</td></tr>
      <tr><th>인허가 신청예정일(date_permit_apply)</th><td>${ctx.datePermitApply || "-"}</td></tr>
    </table>`);

    out.push(`<h3>2. 용도별 예상에너지사용량</h3><table>
      <tr><th>용도</th><th>부문</th><th>면적(㎡)</th><th>원단위</th><th>소계(kWh/yr)</th></tr>
      ${rows.map(r => `<tr><td>${r.use}</td><td>${r.sector}</td>
        <td class="num">${fmt(r.area, 1)}</td><td class="num">${fmt(r.unit, 2)}</td>
        <td class="num">${fmt(r.area * netRatio * r.unit * rf.value)}</td></tr>`).join("")}
      <tr><th colspan="4">합계 (지역계수 반영)</th>
          <td class="num"><b>${fmt(expected)}</b></td></tr>
      <tr><th colspan="4">toe 환산 (최종에너지)</th>
          <td class="num">${fmt(expected * T.TOE.KWH_FINAL, 1)} toe</td></tr>
    </table>`);

    /* 4. 비주거 안내 */
    if (!isResidential) {
      push("info", "지자체 설계기준 — 세대수 기준 미적용",
        `${T.LOCAL_STANDARD.source}은 주거 기준입니다. 세대수(units_total) 0(비주거)이므로 티어 판정을 생략합니다. ` +
        `해당 지자체의 비주거 조항을 별도 확인하세요.`);
    } else {
      out.push(`<h3>3. 지자체 설계기준</h3><table>
        <tr><th>적용 기준</th><td>${local.key} (${local.revision ?? "-"})
            ${local.recommend ? " · 권장사항" : ""}</td></tr>
        <tr><th>등급 구분</th><td>${local.tier ?? "-"} (${fmt(ctx.unitsTotal)}세대)</td></tr>
        <tr><th>녹색건축인증</th><td>${local.green ?? "기준 없음"}</td></tr>
        <tr><th>에너지효율등급</th><td>${local.energy ? local.energy + "등급" : "기준 없음"}</td></tr>
        <tr><th>신재생 의무비율</th><td>${
          typeof local.re === "number" ? local.re + " %"
          : local.re === "GREEN_HOME_ART7" ? "친환경주택 건설기준 제7조 준수"
          : local.capacityRatio ? `전체 설비용량의 ${local.capacityRatio}%`
          : "기준 없음"}</td></tr>
      </table>`);
      local.notes.forEach(n => push("info", `${local.key} 유의사항`, n));
      if (local.verify)
        push("warn", "수치 검증 필요",
          `${local.key}의 신재생 비율은 원문 표 정렬 오류 가능성이 있습니다. 조례 원문 대조를 권합니다.`);
    }

    if (ctx.localOrdinanceApplied)
      push("warn", "지자체 조례 강화 적용 (STEP2 local_ordinance_applied)",
        `${escHtml(ctx.ordinanceName) || "조례명 미기재"} → ${escHtml(ctx.ordinanceValue) || "강화기준 미기재"}. ` +
        `이 값이 STEP3 판정보다 먼저 반영되어, 민간건축물의 "선택" 항목이 "의무"로 상향될 수 있습니다.`);

    /* 5. 서울 비주거 지열·수열 룰 */
    const seoulRule = T.LOCAL_STANDARD.data["서울"].geoHydroRule;
    if (local.key === "서울" && !isResidential) {
      const nonResi = gfaTotal - parkingArea;
      if (nonResi >= seoulRule.thresholdArea)
        push("warn", "서울시 지열·수열 의무",
          `비주거 ${fmt(nonResi)}㎡ ≥ ${fmt(seoulRule.thresholdArea)}㎡ → ` +
          `의무비율의 ${seoulRule.minShareOfObligation * 100}% 이상을 지열 또는 수열로 설치해야 합니다.`);
      else
        push("ok", "서울시 지열·수열 의무 — 해당 없음",
          `비주거 ${fmt(nonResi)}㎡ < ${fmt(seoulRule.thresholdArea)}㎡ 이므로 적용되지 않습니다.`);
    }

    /* 6. 신재생 설치규모 */
    if (ratio) {
      const targetKwh = expected * ratio / 100;
      const roofCap = num("roofArea") / (T.PV_SPEC.AREA_PER_KW * T.SAFETY_AREA);

      const cand = ["태양광_고정식", "태양광_입면BAPV", "BIPV",
                    "지열_수직밀폐형", "연료전지_PEMFC", "연료전지_SOFC"];

      out.push(`<h3>4. 신재생에너지 설치규모</h3>
        <table>
          <tr><th>적용 의무비율</th><td>${ratio} % <span class="muted">(${ratioSrc})</span></td></tr>
          <tr><th>필요 생산량</th><td class="num">${fmt(targetKwh)} kWh/yr</td></tr>
        </table>
        <table>
          <tr><th>에너지원</th><th>필요 용량</th><th>소요면적(㎡)</th><th>개산공사비(원)</th></tr>
          ${cand.map(k => {
            const s = T.RE_SOURCE.data[k];
            const size = T.requiredSize(k, targetKwh);
            const area = s.unit === "kW" ? T.requiredArea(k, size) : size * T.SAFETY_AREA;
            const cost = T.estimateCost(k, size);
            return `<tr><td>${k}</td>
              <td class="num">${fmt(size, 1)} ${s.unit}</td>
              <td class="num">${fmt(area, 1)}</td>
              <td class="num">${cost ? fmt(cost) : "-"}</td></tr>`;
          }).join("")}
        </table>`);

      const pvSize = T.requiredSize("태양광_고정식", targetKwh);
      if (pvSize > roofCap)
        push("warn", "옥상 단독 설치 불가",
          `옥상 PV 최대 ${fmt(roofCap, 1)}kW < 필요 ${fmt(pvSize, 1)}kW. ` +
          `입면 BAPV·BIPV 또는 지열·연료전지 병행이 필요합니다.`);
      else
        push("ok", "옥상 PV 단독 충족 가능",
          `필요 ${fmt(pvSize, 1)}kW ≤ 옥상 최대 ${fmt(roofCap, 1)}kW`);
    } else {
      push("info", "신재생 의무비율 미적용",
        `민간 · ${isResidential ? "세대수 기준 미달" : "비주거"} 조건으로 자동 산정되는 의무비율이 없습니다. ` +
        `심의 반영값을 입력하면 그 값으로 산정합니다.`);
    }

    /* 7. ZEB */
    const zebResult = evaluateCert("ZEB", ctx);
    const zebGradeReq = T.ZEB.grade4Uses.includes(rows[0].use) ? 4 : 5;
    if (zebResult.status !== "apply") {
      push("info", "ZEB 의무 — " + (zebResult.status === "check" ? "선택 가능(확인 필요)" : "해당 없음"),
        zebResult.reasons.join(" · "));
    } else {
      push("info", "ZEB 의무 대상",
        `${zebResult.reasons.join(" · ")} → 공공 의무등급 ${zebGradeReq}등급 참고. BEMS 설치 필수.`);
    }
    const pe = num("zeb_primary_energy");
    if (pe > 0) {
      const g = T.zebGrade({ primary: pe, isResidential });
      push(g ? "ok" : "warn", "ZEB 등급 판정",
        `1차에너지소요량 ${fmt(pe, 1)} kWh/㎡yr → ${g ?? "등급 미달"}`);
    }

    /* 8. 에너지사용계획 협의 */
    const th = T.ENERGY_PLAN[ctx.isPublicOwner ? "public" : "private"];
    const elec = num("annualElec"), fuel = num("annualFuel");
    const hitE = elec >= th.elecKwh, hitF = fuel >= th.fuelToe;
    push(hitE || hitF ? "warn" : "ok", "에너지사용계획 협의",
      `전력 ${fmt(elec)} kWh (기준 ${fmt(th.elecKwh)}) · 연료 ${fmt(fuel)} toe (기준 ${fmt(th.fuelToe)}) → ` +
      `${hitE || hitF ? "<b>협의 대상</b>" : "대상 아님"}`);

    /* 9. 실사용 예측치와의 괴리 */
    if (elec > 0) {
      const gap = elec / expected;
      if (gap > 1.5 || gap < 0.67)
        push("warn", "표준 원단위와 실사용 예측치 괴리",
          `표준 산정 ${fmt(expected)} kWh vs 입력 전력 ${fmt(elec)} kWh (${gap.toFixed(2)}배). ` +
          `IT부하 등 특수부하가 있는 시설은 표준 원단위가 실제를 반영하지 못합니다. ` +
          `의무비율 판정은 표준 원단위, 협의 대상 판정은 실사용 예측치로 분리 표기하세요.`);
    }

    /* 10. 인허가·인증 체크리스트 (STEP3~5 반영, Notion DB 연동) */
    const certRows = CERTIFICATIONS.map(c => ({ c, r: evaluateCert(c.id, ctx) }));
    const order = { apply: 0, check: 1, not_apply: 2 };
    certRows.sort((a, b) => order[a.r.status] - order[b.r.status] || a.c.order - b.c.order);

    const applyCount = certRows.filter(x => x.r.status === "apply").length;
    const checkCount = certRows.filter(x => x.r.status === "check").length;
    const acquired = acquiredCertIds();

    out.push(`<h3>5. 인허가·인증 체크리스트 (${CERT_SOURCE.name} 연동, STEP3~5 반영)</h3>
      <div class="muted" style="margin-bottom:8px;">의무(대상) ${applyCount}건 · 확인/선택 ${checkCount}건 / 전체 ${CERTIFICATIONS.length}건 ·
      출처: <a href="${CERT_SOURCE.url}" target="_blank" rel="noopener">${CERT_SOURCE.url}</a> (최종 동기화 ${CERT_SOURCE.lastSynced})</div>
      <table>
        <tr><th style="width:auto">항목</th><th style="width:90px">판정</th><th style="width:70px">취득선택</th><th style="width:auto">근거법령</th>
            <th style="width:auto">제출시기</th><th style="width:auto">판정사유</th></tr>
        ${certRows.map(({ c, r }) => {
          const cls = STATUS_LABEL[r.status].cls;
          const style = cls === "muted-badge"
            ? "background:#f3f4f6;color:#6b7280;border-left:4px solid #9ca3af;"
            : "";
          const badge = `<span class="alert ${cls === 'muted-badge' ? '' : cls}" style="display:inline-block;padding:2px 8px;margin:0;white-space:nowrap;${style}">${STATUS_LABEL[r.status].badge}</span>`;
          const acqMark = acquired.has(c.id) ? "✅ 취득" : (r.status === "apply" ? "🔒 의무" : "-");
          return `<tr>
            <td><b>${c.name}</b></td>
            <td>${badge}</td>
            <td style="text-align:center;">${acqMark}</td>
            <td class="muted">${c.basis.join("<br>")}</td>
            <td class="muted">${c.timing.join("<br>")}</td>
            <td class="muted">${r.reasons.map(x => `· ${x}`).join("<br>")}</td>
          </tr>`;
        }).join("")}
      </table>`);

    document.querySelectorAll(".stepbar > div").forEach(el => el.classList.add("done"));

  } catch (e) {
    out.unshift(`<div class="alert error"><b>계산 중단</b>${escHtml(e.message)}
      <div class="muted" style="margin-top:6px;">임의 기본값을 쓰지 않고 중단했습니다. 입력을 확인하세요.</div></div>`);
  }

  $("report").innerHTML = out.join("");
}

$("run").addEventListener("click", run);
window.reTool = { ...T, run, collectCtx };   // 콘솔 디버깅용
