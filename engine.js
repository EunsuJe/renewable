/* =========================================================================
 * engine.js — 입력 파싱 · 계산 · 리포트 렌더링
 * ========================================================================= */
import * as T from "./tables.js?v=20260819";
import { CERTIFICATIONS, CERT_SOURCE } from "./certifications.js?v=20260826";
import { evaluateCert } from "./certRules.js?v=20260826";
import { parseOverviewText } from "./autofill.js?v=20260826";

const $  = (id) => document.getElementById(id);
const num = (id) => {
  const v = parseFloat(String($(id).value).replace(/,/g, "").trim());
  return isNaN(v) ? 0 : v;
};
const fmt = (n, d = 0) =>
  n == null || isNaN(n) ? "-" : n.toLocaleString("ko-KR",
    { minimumFractionDigits: d, maximumFractionDigits: d });

$("ver").textContent = `데이터 버전 ${T.DATA_VERSION} · ${T.SOURCE_VERSION}`;

const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, c => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- 설계개요 자동입력 ---------- */
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
  let useVal = null, totalAreaVal = null;

  rows.forEach(tr => {
    const idx = parseInt(tr.dataset.idx, 10);
    const f = lastOverviewParse.fields[idx];
    const chk = tr.querySelector(".ov-chk").checked;
    const val = tr.querySelector(".ov-val").value;
    if (!chk || !f) return;

    if (f.key === "useMixGuess") { useVal = val; return; }
    setFieldValue(f.target, val);
    applied.push(f.label);
    if (f.key === "totalArea") totalAreaVal = val;
  });

  if (useVal) {
    const area = totalAreaVal || $("totalArea").value;
    if (area) {
      $("useMix").value = `${useVal},${area}`;
      applied.push("용도 구성");
    } else {
      applied.push("(용도명은 인식했으나 면적 정보가 없어 용도 구성에는 반영하지 못했습니다 — 직접 입력하세요)");
    }
  }

  updateHint();
  const wrap = $("overviewPreview");
  wrap.insertAdjacentHTML("beforeend",
    `<div class="alert ok" style="margin-top:8px;"><b>${applied.length}개 항목 적용 완료</b>
     ${applied.map(a => escHtml(a)).join(" · ")}. 좌측 입력값을 확인 후 [검토 실행]을 눌러주세요.</div>`);
});

/* ---------- 시·도 변경 시 적용 지자체 기준 미리보기 ---------- */
function updateHint() {
  const { key, fallback } = T.resolveLocalStandard($("sido").value, $("sigungu").value);
  $("localHint").textContent = fallback
    ? `적용 기준: 그 외 지역 (별도 설계기준 없음)`
    : `적용 기준: ${key} (${T.LOCAL_STANDARD.data[key].revision ?? "-"})`;
}
$("sido").addEventListener("change", updateHint);
$("sigungu").addEventListener("input", updateHint);
updateHint();

/* ---------- 용도 구성 파싱 ---------- */
function parseUseMix(text, clientType) {
  const notes = [];
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

      const ue = T.getUnitEnergy(use, clientType, sector);
      if (ue.note) notes.push(`${i + 1}행 ${use}: ${ue.note}`);
      return { use: T.normUse(use), sector: ue.sector, area, unit: ue.value };
    });
  if (!rows.length) throw new Error("용도 구성이 비어 있습니다.");
  return { rows, notes };
}

/* ---------- 메인 ---------- */
function run() {
  const out = [];
  const push = (t, title, body) =>
    out.push(`<div class="alert ${t}"><b>${title}</b>${body}</div>`);

  try {
    const clientType  = $("clientType").value;
    const actType     = $("actType").value;
    const sido        = $("sido").value;
    const sigungu     = $("sigungu").value;
    const totalArea   = num("totalArea");
    const parkingArea = num("parkingArea");
    const households  = num("households");
    const zebCert     = $("zebCert").checked;
    const year        = new Date($("permitDate").value || Date.now()).getFullYear();

    /* 1. 용도·면적 */
    const { rows, notes } = parseUseMix($("useMix").value, clientType);
    const useSum = rows.reduce((s, r) => s + r.area, 0);
    notes.forEach(n => push("info", "부문 자동보정", n));

    if (Math.abs(useSum - totalArea) > 0.5)
      push("warn", "연면적 불일치",
        `총 연면적 ${fmt(totalArea, 1)}㎡ vs 용도면적 합계 ${fmt(useSum, 1)}㎡ ` +
        `(차이 ${fmt(Math.abs(useSum - totalArea), 1)}㎡). 한쪽으로 통일하세요.`);

    if (parkingArea === 0 && num("basementArea") > 0)
      push("warn", "주차장 면적 미입력",
        `지하개발 ${fmt(num("basementArea"))}㎡가 있으나 주차장 면적이 0입니다. ` +
        `연면적 산입 여부를 확인하세요.`);

    /* 2. 예상에너지사용량 */
    const rf = T.getRegionFactor(sido, sigungu);
    const netRatio = totalArea > 0 ? (totalArea - parkingArea) / totalArea : 1;
    const expected = rows.reduce((s, r) => s + r.area * netRatio * r.unit, 0) * rf.value;

    /* 3. 적용 의무비율 */
    const ovRatio = num("ovRatio");
    const local = T.getLocalTier(sido, sigungu, households, { clientType, zebCertified: zebCert });
    const isResidential = households > 0;

    let ratio = null, ratioSrc = "";
    if (ovRatio > 0) { ratio = ovRatio; ratioSrc = `심의 반영값 (${$("ovReason").value})`; }
    else if (clientType === "public") {
      ratio = T.publicRatio(year); ratioSrc = `공공기관 공급의무비율 ${year}년`;
    } else if (isResidential && typeof local.re === "number") {
      ratio = local.re; ratioSrc = `${local.key} 녹색건축물 설계기준 ${local.tier}등급`;
    }

    /* ---------- 리포트 ---------- */
    out.push(`<h3>1. 산정 기초</h3><table>
      <tr><th>프로젝트</th><td>${$("pjtName").value}</td></tr>
      <tr><th>위치 / 지역계수</th><td>${sido} ${sigungu} — ${rf.key} × ${rf.value}</td></tr>
      <tr><th>발주자 / 행위유형</th><td>${clientType === "public" ? "공공" : "민간"} / ${actType}</td></tr>
      <tr><th>연면적 (주차장 제외)</th><td class="num">${fmt(totalArea - parkingArea, 1)} ㎡</td></tr>
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
        `${T.LOCAL_STANDARD.source}은 주거 기준입니다. 세대수 0(비주거)이므로 티어 판정을 생략합니다. ` +
        `해당 지자체의 비주거 조항을 별도 확인하세요.`);
    } else {
      out.push(`<h3>3. 지자체 설계기준</h3><table>
        <tr><th>적용 기준</th><td>${local.key} (${local.revision ?? "-"})
            ${local.recommend ? " · 권장사항" : ""}</td></tr>
        <tr><th>등급 구분</th><td>${local.tier ?? "-"} (${fmt(households)}세대)</td></tr>
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

    /* 5. 서울 비주거 지열·수열 룰 */
    const seoulRule = T.LOCAL_STANDARD.data["서울"].geoHydroRule;
    if (local.key === "서울" && !isResidential) {
      const nonResi = totalArea - parkingArea;
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
    const zebApplies = T.ZEB.mandatoryActs.includes(actType);
    const zebGradeReq = T.ZEB.grade4Uses.includes(rows[0].use) ? 4 : 5;
    if (!zebApplies) {
      push("info", "ZEB 의무 — 해당 없음",
        `행위유형 "${actType}"은 ZEB 의무대상(${T.ZEB.mandatoryActs.join("·")})이 아닙니다. ` +
        `다만 민간 비주거는 2025.12.31 이후 에너지절약설계기준 개정으로 ZEB5 수준이 요구됩니다.`);
    } else {
      push("info", "ZEB 의무 대상",
        `연면적 1,000㎡ 이상 · ${rows[0].use} → 공공 의무등급 ${zebGradeReq}등급. BEMS 설치 필수.`);
    }
    const pe = num("primaryEnergy");
    if (pe > 0) {
      const g = T.zebGrade({ primary: pe, isResidential });
      push(g ? "ok" : "warn", "ZEB 등급 판정",
        `1차에너지소요량 ${fmt(pe, 1)} kWh/㎡yr → ${g ?? "등급 미달"}`);
    }

    /* 8. 에너지사용계획 협의 */
    const th = T.ENERGY_PLAN[clientType];
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

    /* 10. 인허가·인증 항목 체크리스트 (Notion DB 연동) */
    const certCtx = {
      clientType, actType, sido, sigungu,
      totalArea, parkingArea, households, rows,
      housingType: $("housingType").value,
      siteArea: num("siteArea"),
      floorsAbove: num("floorsAbove"),
      dormitory: $("dormitory").checked,
      militaryExclude: $("militaryExclude").checked,
      cptedResiTypes: households > 0,
      cptedNeighborhood: $("cptedNeighborhood").checked,
      cptedLodging: $("cptedLodging").checked,
      parkingStandalone: $("parkingStandalone").checked,
      ultraHighRise: $("ultraHighRise").checked,
      transportFacility: $("transportFacility").checked,
      redevelopmentZone: $("redevelopmentZone").checked,
      nearEduFacility: $("nearEduFacility").checked,
      watershedTarget: $("watershedTarget").checked,
      zebGrade4Uses: T.ZEB.grade4Uses
    };

    const STATUS_LABEL = {
      apply: { badge: "대상", cls: "ok" },
      not_apply: { badge: "비대상", cls: "muted-badge" },
      check: { badge: "확인필요", cls: "warn" }
    };

    const certRows = CERTIFICATIONS.map(c => {
      const r = evaluateCert(c.id, certCtx);
      return { c, r };
    });

    const order = { apply: 0, check: 1, not_apply: 2 };
    certRows.sort((a, b) => order[a.r.status] - order[b.r.status] || a.c.order - b.c.order);

    const applyCount = certRows.filter(x => x.r.status === "apply").length;
    const checkCount = certRows.filter(x => x.r.status === "check").length;

    out.push(`<h3>5. 인허가·인증 체크리스트 (${CERT_SOURCE.name} 연동)</h3>
      <div class="muted" style="margin-bottom:8px;">대상 ${applyCount}건 · 확인필요 ${checkCount}건 / 전체 ${CERTIFICATIONS.length}건 ·
      출처: <a href="${CERT_SOURCE.url}" target="_blank" rel="noopener">${CERT_SOURCE.url}</a> (최종 동기화 ${CERT_SOURCE.lastSynced})</div>
      <table>
        <tr><th style="width:auto">항목</th><th style="width:70px">판정</th><th style="width:auto">근거법령</th>
            <th style="width:auto">제출시기</th><th style="width:auto">판정사유</th></tr>
        ${certRows.map(({ c, r }) => {
          const cls = STATUS_LABEL[r.status].cls;
          const style = cls === "muted-badge"
            ? "background:#f3f4f6;color:#6b7280;border-left:4px solid #9ca3af;"
            : "";
          const badge = `<span class="alert ${cls === 'muted-badge' ? '' : cls}" style="display:inline-block;padding:2px 8px;margin:0;white-space:nowrap;${style}">${STATUS_LABEL[r.status].badge}</span>`;
          return `<tr>
            <td><b>${c.name}</b></td>
            <td>${badge}</td>
            <td class="muted">${c.basis.join("<br>")}</td>
            <td class="muted">${c.timing.join("<br>")}</td>
            <td class="muted">${r.reasons.map(x => `· ${x}`).join("<br>")}</td>
          </tr>`;
        }).join("")}
      </table>`);

  } catch (e) {
    out.unshift(`<div class="alert error"><b>계산 중단</b>${e.message}
      <div class="muted" style="margin-top:6px;">임의 기본값을 쓰지 않고 중단했습니다. 입력을 확인하세요.</div></div>`);
  }

  $("report").innerHTML = out.join("");
}

$("run").addEventListener("click", run);
window.reTool = { ...T, run };   // 콘솔 디버깅용
