/* =========================================================
   UI 버전 전환 (구버전 / 신버전 XP)
   - 기본값: 신버전(xp)
   - 선택은 localStorage에 저장되어 다음 방문에도 유지됩니다.
   ========================================================= */
(function initUiVersion() {
  const STORAGE_KEY = "uiVersion";
  const body = document.body;
  const toggleBtn = document.getElementById("uiVersionToggle");
  const label = document.getElementById("uiVersionLabel");

  function readSaved() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return null;
    }
  }

  function applyVersion(version) {
    if (version === "legacy") {
      body.removeAttribute("data-ui");
      label.textContent = "🪟 신버전 UI로 보기";
      // 좁은 화면에서는 CSS 가 짧은 라벨로 바꿔치기합니다. (data-short)
      label.dataset.short = "🪟 신버전";
      label.dataset.icon = "🪟";
      toggleBtn.title = "신버전 UI로 보기";
    } else {
      body.setAttribute("data-ui", "xp");
      label.textContent = "🖥️ 구버전 UI로 보기";
      label.dataset.short = "🖥️ 구버전";
      label.dataset.icon = "🖥️";
      toggleBtn.title = "구버전 UI로 보기";
    }
  }

  // 저장된 값이 없으면 신버전(xp)이 기본
  let current = readSaved() === "legacy" ? "legacy" : "xp";
  applyVersion(current);

  toggleBtn.addEventListener("click", function () {
    current = current === "xp" ? "legacy" : "xp";
    applyVersion(current);
    try {
      localStorage.setItem(STORAGE_KEY, current);
    } catch (e) {
      /* 저장 불가 환경(사생활 보호 모드 등)에서는 무시 */
    }
    // 테마 변경으로 캔버스 크기가 달라질 수 있어 차트를 다시 맞춤
    if (typeof myChart !== "undefined") {
      myChart.resize();
      // 구버전/신버전에 따라 이름표·축 제한·드래그 적용을 다시 반영
      if (typeof applyXZoom === "function") applyXZoom();
    }
    checkScroll();
    // XP 모드의 활성 창 표시 갱신
    if (typeof window.updateActiveWindow === "function") {
      window.updateActiveWindow();
    }
  });
})();

/* =========================================================
   XP 데스크톱 연출 (신버전 전용)
   ========================================================= */
(function initXpChrome() {
  // 작업 표시줄 시계
  const clock = document.getElementById("xpClock");
  function tick() {
    const now = new Date();
    let h = now.getHours();
    const m = String(now.getMinutes()).padStart(2, "0");
    const meridiem = h < 12 ? "오전" : "오후";
    h = h % 12 || 12;
    clock.textContent = `${meridiem} ${h}:${m}`;
  }
  tick();
  setInterval(tick, 10000);

  const container = document.querySelector(".container");
  const taskBtn = document.getElementById("xpTaskWindow");

  // 최소화 / 작업 표시줄 버튼으로 복원
  document.getElementById("xpMinimize").addEventListener("click", function () {
    container.classList.add("minimized");
    taskBtn.classList.remove("active");
  });

  // 작업 표시줄의 메인 버튼 : 최소화 상태면 복원, 아니면 맨 위로 이동
  taskBtn.addEventListener("click", function () {
    if (container.classList.contains("minimized")) {
      container.classList.remove("minimized");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  /* -------------------------------------------------------
     XP 스타일 알림 대화상자
     - 브라우저 기본 alert 대신 사용
     - 확인 / X / Enter / Esc / 바깥 클릭으로 닫힘
     - 닫은 뒤에는 직전 포커스로 되돌립니다.
     ------------------------------------------------------- */
  const modalOverlay = document.getElementById("xpModalOverlay");
  const modalTitle = document.getElementById("xpModalTitle");
  const modalMsg = document.getElementById("xpModalMsg");
  const modalOk = document.getElementById("xpModalOk");
  const modalX = document.getElementById("xpModalX");
  let lastFocused = null;

  function closeModal() {
    modalOverlay.hidden = true;
    if (lastFocused && typeof lastFocused.focus === "function") {
      lastFocused.focus();
    }
    lastFocused = null;
  }

  function showModal(message, title) {
    // 구버전에서는 XP 다이얼로그 스타일이 적용되지 않으므로 기본 alert 사용
    if (document.body.dataset.ui !== "xp") {
      alert(message);
      return;
    }
    lastFocused = document.activeElement;
    modalTitle.textContent = title || "이용약관에 동의하고 싶어";
    modalMsg.textContent = message;
    modalOverlay.hidden = false;
    modalOk.focus();
  }

  modalOk.addEventListener("click", closeModal);
  modalX.addEventListener("click", closeModal);

  // 바깥(오버레이) 클릭 시 닫기
  modalOverlay.addEventListener("mousedown", function (e) {
    if (e.target === modalOverlay) closeModal();
  });

  // Esc / Enter 로 닫기
  document.addEventListener("keydown", function (e) {
    if (modalOverlay.hidden) return;
    if (e.key === "Escape" || e.key === "Enter") {
      e.preventDefault();
      closeModal();
    }
  });

  // 닫기 / 동의하지 않음 : 게임처럼 거부당하는 연출
  function refuse(message, title) {
    showModal(message, title);
  }

  document.getElementById("xpClose").addEventListener("click", function () {
    refuse(
      "이용약관에 동의하지 않으면 리더보드를 종료할 수 없습니다.",
      "리더보드 종료",
    );
  });

  document.getElementById("xpDisagree").addEventListener("click", function () {
    refuse(
      "동의하지 않으셨습니다.\n하지만 리더보드는 계속됩니다.\n\n(제 3 조에 의거하여 인정협회는 거부를 인정하지 않습니다)",
      "인정협회",
    );
  });

  // 약관 동의 체크 해제 시도 시 되돌림
  const consent = document.getElementById("xpConsent");
  consent.addEventListener("change", function () {
    if (!consent.checked) {
      refuse("이용약관 동의는 필수 항목입니다.", "이용약관 동의");
      consent.checked = true;
    }
  });

  document.getElementById("xpStart").addEventListener("click", function () {
    showModal(
      "시작 메뉴는 이용약관 제 12 조에 동의한 이후에 사용할 수 있습니다.\n\n(아직 제 4 조입니다)",
      "시작 메뉴",
    );
  });

  /* -------------------------------------------------------
     섹션 = 창 연출
     - 각 섹션 타이틀바의 _ □ X : 접기 / 최대화 / 닫기
     - 작업 표시줄 버튼 : 해당 섹션으로 이동 + 닫힌 창 복원
     - 스크롤 위치에 따라 활성 창(진한 파랑) 표시
     ------------------------------------------------------- */
  const sections = [
    { id: "sectionMain", el: null, task: null },
    { id: "sectionSpeedrun", el: null, task: null },
    { id: "sectionShortcut", el: null, task: null },
    { id: "sectionRetry", el: null, task: null },
  ];

  const taskButtons = Array.prototype.slice.call(
    document.querySelectorAll(".xp-task[data-target]"),
  );

  sections.forEach((s) => {
    s.el = document.getElementById(s.id);
    s.task = taskButtons.find((b) => b.dataset.target === s.id) || null;
  });

  // '창'으로 취급할 섹션들 (메인 차트 영역은 컨테이너 자체가 창이므로 제외)
  const windowSections = Array.prototype.slice.call(
    document.querySelectorAll(".bottom-section, .casual-mode"),
  );

  windowSections.forEach(function (section) {
    const title = section.querySelector(".section-title");
    if (!title) return;

    const minBtn = title.querySelector(".sec-min");
    const maxBtn = title.querySelector(".sec-max");
    const closeBtn = title.querySelector(".sec-close");

    // 타이틀바(버튼 외 영역) 클릭 시 접기/펼치기
    title.addEventListener("click", function (e) {
      if (e.target.closest(".xp-btn")) return;
      if (e.target.closest("a, button, label, input")) return;
      section.classList.toggle("collapsed");
    });

    if (minBtn) {
      minBtn.addEventListener("click", function () {
        section.classList.remove("maximized");
        section.classList.toggle("collapsed");
      });
    }

    if (maxBtn) {
      maxBtn.addEventListener("click", function () {
        section.classList.remove("collapsed");
        section.classList.toggle("maximized");
        // 최대화 시 차트가 있는 경우 크기 재계산
        if (typeof myChart !== "undefined") myChart.resize();
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        section.classList.remove("maximized");
        section.classList.add("closed");
        updateTaskbarState();
      });
    }
  });

  // 작업 표시줄 버튼 : 이동 + 닫힌 창 복원
  taskButtons.forEach(function (btn) {
    if (btn.id === "xpTaskWindow") return; // 메인 창은 최소화 토글이 이미 걸려 있음
    btn.addEventListener("click", function () {
      const target = document.getElementById(btn.dataset.target);
      if (!target) return;
      target.classList.remove("closed", "collapsed");
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  function updateTaskbarState() {
    sections.forEach(function (s) {
      if (!s.task || !s.el) return;
      // 닫힌 창은 작업 표시줄에서 눌린 상태를 해제
      if (s.el.classList.contains("closed")) {
        s.task.classList.remove("active");
      }
    });
  }

  // 스크롤 위치에 따라 활성 창 갱신
  function updateActiveWindow() {
    if (document.body.dataset.ui !== "xp") return;

    let activeId = sections[0].id;
    const probe = window.innerHeight * 0.35;

    sections.forEach(function (s) {
      if (!s.el || s.el.classList.contains("closed")) return;
      const rect = s.el.getBoundingClientRect();
      if (rect.top <= probe) activeId = s.id;
    });

    sections.forEach(function (s) {
      if (!s.el) return;
      const isActive = s.id === activeId && !s.el.classList.contains("closed");
      // 메인은 .content-wrapper 라 타이틀바가 없으므로 클래스만 관리
      s.el.classList.toggle("active-window", isActive);
      if (s.task) s.task.classList.toggle("active", isActive);
    });
  }

  window.addEventListener("scroll", updateActiveWindow, { passive: true });
  updateActiveWindow();

  // 다른 스코프(테마 전환 등)에서도 호출할 수 있도록 노출
  window.updateActiveWindow = updateActiveWindow;
})();

/* =========================================================
   검토 중인 제출 목록 (선택적)
   - 서버가 없거나 응답하지 않아도 리더보드는 정상 동작해야 하므로
     실패 시 조용히 섹션을 숨긴 채 넘어갑니다.
   - 순위·차트에는 절대 반영하지 않습니다. (미검증 기록이므로)
   ========================================================= */
(function loadPendingSubmissions() {
  const meta = document
    .querySelector('meta[name="api-base"]')
    ?.getAttribute("content")
    ?.trim();
  if (!meta) return; // 서버 주소가 없으면 기능 자체를 쓰지 않음

  const base = meta.replace(/\/$/, "");
  const section = document.getElementById("sectionPending");
  const list = document.getElementById("pendingList");
  if (!section || !list) return;

  function leagueOf(r) {
    if (r.kind === "speedrun") return "⚡ 스피드런";
    if (r.is_shortcut) return "🎈 풍선 숏컷";
    if (r.is_retry) return "📜 재도전";
    return "🏆 명예의 전당";
  }

  fetch(`${base}/api/submissions/pending`)
    .then((res) => (res.ok ? res.json() : null))
    .then((json) => {
      if (!json?.ok || !Array.isArray(json.rows) || json.rows.length === 0) {
        return;
      }
      list.innerHTML = "";
      json.rows.forEach((r) => {
        const li = document.createElement("li");
        li.className = "pending-item";

        const name = document.createElement("span");
        name.className = "pending-name";
        // textContent 로 넣어 사용자 입력이 HTML 로 해석되지 않게 합니다.
        name.textContent = r.streamer_name;

        const tag = document.createElement("span");
        tag.className = "pending-tag";
        tag.textContent = "임시";

        const league = document.createElement("span");
        league.className = "pending-league";
        league.textContent = leagueOf(r);

        const time = document.createElement("span");
        time.className = "pending-time";
        time.textContent = r.tos_time
          ? `${r.game_time} / 약관 ${r.tos_time}`
          : r.game_time;

        li.append(tag, name, league, time);
        list.appendChild(li);
      });
      section.hidden = false;
      // 섹션이 늘어났으므로 스크롤 화살표 위치를 다시 계산
      if (typeof checkScroll === "function") checkScroll();
    })
    .catch(() => {
      /* 서버 미가동 등 — 리더보드는 그대로 동작합니다 */
    });
})();

// FOUT 문제 해결 : 폰트 로딩 감지 및 화면 표시
document.fonts.ready.then(function () {
  document.body.classList.add("fonts-loaded");
});

// (혹시 모를 폰트 로딩 실패/지연 대비 fallback: 0.5초 뒤에는 무조건 보여줌)
setTimeout(function () {
  document.body.classList.add("fonts-loaded");
}, 500);

Chart.register(ChartDataLabels);

function parseTime(str) {
  const h = str.match(/(\d+)시간/) ? parseInt(str.match(/(\d+)시간/)[1]) : 0;
  const m = str.match(/(\d+)분/) ? parseInt(str.match(/(\d+)분/)[1]) : 0;
  // 소수점(.포함)도 인식하여 실수(float)로 변환하도록 변경
  const s = str.match(/([\d.]+)초/)
    ? parseFloat(str.match(/([\d.]+)초/)[1])
    : 0;
  return h * 60 + m + s / 60;
}

function formatTime(totalMinutes, showDecimals = false) {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.floor(totalMinutes % 60);

  // 분의 소수점 부분을 초로 변환
  let rawSeconds = (totalMinutes - Math.floor(totalMinutes)) * 60;
  let sString = "";

  if (showDecimals) {
    // [스피드런용] 소수점 2자리 반올림
    let s = Math.round(rawSeconds * 100) / 100;

    // 59.999... 가 60이 되는 경우 보정 (단순화: 0으로 처리)
    if (s >= 60) {
      s = 0;
    }

    // "05.10" 처럼 두 자리 고정 및 앞에 0 채우기
    sString = s < 10 ? "0" + s.toFixed(2) : s.toFixed(2);
    sString += "초"; // '초' 단위 붙이기
  } else {
    // [명예의 전당용] 소수점 버림 (Floor)
    // 부동소수점 오차 보정: 1.9999... -> 2.0000... 만든 뒤 내림
    let s = Math.floor(rawSeconds + 0.0001);

    // 초가 0보다 크거나, 시/분이 모두 0일 때만 표시
    if (s > 0 || (h === 0 && m === 0)) {
      sString = `${s}초`;
    }
  }

  let result = "";
  if (h > 0) result += `${h}시간 `;
  if (m > 0) result += `${m}분 `;

  // 스피드런 모드이거나, 초 값이 있을 때 출력
  if (showDecimals || sString) {
    result += sString;
  }

  return result.trim() || "0분";
}

function processData(dataArray, type = "normal") {
  // type: 'normal' | 'shortcut' | 'retry'
  return dataArray.map((item) => {
    const gameMin = parseTime(item.gameTime);
    const tosMin = parseTime(item.tosTime);
    const totalMin = gameMin + tosMin;

    // x: tosMin (이용약관), y: gameMin (본 게임)
    return {
      ...item,
      x: tosMin, // X축: 이용약관 시간
      y: gameMin, // Y축: 본 게임 시간
      totalMin: totalMin,
      color: STREAMER_COLORS[item.name] || DEFAULT_COLOR,
      type: type, // 데이터 타입 저장
    };
  });
}

const processedRecordData = processData(RECORD_DATA, "normal");
const sortedRecordData = [...processedRecordData].sort(
  (a, b) => a.totalMin - b.totalMin,
);

const processedRetryData = processData(RETRY_DATA, "retry");
const sortedRetryData = [...processedRetryData].sort(
  (a, b) => a.totalMin - b.totalMin,
);

const processedShortcutData = processData(SHORTCUT_DATA, "shortcut");
const sortedShortcutData = [...processedShortcutData].sort(
  (a, b) => a.totalMin - b.totalMin,
);

let activePoint = null;
let chartFocusTimeout = null;

/* ---------------------------------------------------------
   평균선
   화면이 4분면으로 나뉘어 '약관은 오래 봤지만 클리어는 빨랐다' 같은
   위치를 한눈에 읽을 수 있습니다.

   평균/중앙값이 X축 1.16배, Y축 1.06배로 치우침이 크지 않아
   평균을 그대로 씁니다.
   --------------------------------------------------------- */
/**
 * 차트에 그릴 리그. 'record' | 'shortcut' | 'speedrun'
 *
 * ⚠ 스피드런 기록에는 약관 시간(tosTime)이 없습니다. (19건 전부)
 *   그래서 같은 산점도에 올리면 전부 x=0 에 붙어 버립니다.
 *   스피드런은 '순위 × 회차 시간' 으로 축을 바꿔 그립니다.
 *
 * ⚠ initialChartData 가 getDisplayData 보다 먼저 평가되므로
 *   선언도 그보다 위에 있어야 합니다. (TDZ 오류 방지)
 */
let chartLeague = "record";

let showAverage = true;
let averages = { x: 0, y: 0 };

/** 현재 차트에 그려진 데이터로 평균을 다시 계산합니다. */
function computeAverages(rows) {
  if (!rows.length) return { x: 0, y: 0 };
  const sum = rows.reduce((a, r) => ({ x: a.x + r.x, y: a.y + r.y }), {
    x: 0,
    y: 0,
  });
  return { x: sum.x / rows.length, y: sum.y / rows.length };
}

const averageLinePlugin = {
  id: "averageLinePlugin",
  beforeDatasetsDraw: (chart) => {
    // 특정 점을 보고 있을 때는 그 점의 crosshair 와 겹쳐 지저분해집니다.
    if (!showAverage || activePoint !== null) return;
    if (!averages.x || !averages.y) return;
    // 구버전 차트는 원래 모습 그대로 두기로 했습니다.
    if (document.body.dataset.ui !== "xp") return;
    // 히스토그램의 y 는 '인원 수'라 평균선이 뜻을 갖지 않습니다.
    if (chartLeague === "speedrun") return;

    const ctx = chart.ctx;
    const xAxis = chart.scales.x;
    const yAxis = chart.scales.y;

    const px = xAxis.getPixelForValue(averages.x);
    const py = yAxis.getPixelForValue(averages.y);

    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(120, 120, 120, 0.75)";

    // 확대·이동으로 평균이 화면 밖이면 선을 그리지 않습니다.
    // 스피드런의 x 는 순위라서 '순위의 평균'은 뜻이 없으므로 뺍니다.
    const xVisible =
      chartLeague !== "speedrun" && px >= xAxis.left && px <= xAxis.right;
    const yVisible = py >= yAxis.top && py <= yAxis.bottom;

    ctx.beginPath();
    if (xVisible) {
      ctx.moveTo(px, yAxis.top);
      ctx.lineTo(px, yAxis.bottom);
    }
    if (yVisible) {
      ctx.moveTo(xAxis.left, py);
      ctx.lineTo(xAxis.right, py);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = "bold 10px 'Pretendard Variable', Pretendard, sans-serif";
    ctx.fillStyle = "#5a5a5a";

    // 선이 화면 밖이어도 값은 알 수 있도록 축 가장자리에 붙여 둡니다.
    if (xVisible) {
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(`평균 ${formatTime(averages.x, false)}`, px, yAxis.top + 3);
    }
    if (yVisible) {
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(`평균 ${formatTime(averages.y, false)}`, xAxis.left + 4, py - 3);
    }
    ctx.restore();
  },
};

/**
 * 히스토그램 막대 위에 인원 수를 적습니다.
 *
 * chartjs-plugin-datalabels 는 차트 type(scatter) 기준으로 위치를
 * 잡아서 막대 꼭대기를 못 찾습니다. 직접 그리는 편이 확실합니다.
 */
const histogramLabelPlugin = {
  id: "histogramLabelPlugin",
  afterDatasetsDraw: (chart) => {
    const meta = chart.getDatasetMeta(0);
    const data = chart.data.datasets[0].data;
    if (!data.length || !data[0]?.members) return;

    const ctx = chart.ctx;
    ctx.save();
    ctx.font = "bold 10.3px 'Pretendard Variable', Pretendard, sans-serif";
    ctx.fillStyle = "#333";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";

    data.forEach((d, i) => {
      if (!d.y) return; // 빈 구간은 적지 않습니다.
      const bar = meta.data[i];
      if (!bar) return;
      ctx.fillText(String(d.y), bar.x, bar.y - 3);
    });
    ctx.restore();
  },
};

const hoverAxisPlugin = {
  id: "hoverAxisPlugin",
  beforeDatasetsDraw: (chart) => {
    if (activePoint === null) return;

    const ctx = chart.ctx;
    const meta = chart.getDatasetMeta(0);
    if (!meta.data[activePoint]) return;

    const point = meta.data[activePoint];
    const data = chart.data.datasets[0].data[activePoint];

    const xAxis = chart.scales.x;
    const yAxis = chart.scales.y;

    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = data.color;
    ctx.lineWidth = 1;

    ctx.moveTo(xAxis.left, point.y);
    ctx.lineTo(point.x, point.y);
    ctx.moveTo(point.x, yAxis.bottom);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();

    ctx.font = "bold 12px";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // X축 레이블 (이용약관 시간)
    const xLabel = formatTime(data.x);
    const xLabelX = point.x;
    const xLabelY = yAxis.bottom + 15;

    const xTextWidth = ctx.measureText(xLabel).width;
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.fillRect(
      xLabelX - xTextWidth / 2 - 4,
      xLabelY - 10,
      xTextWidth + 8,
      20,
    );

    ctx.fillStyle = data.color;
    ctx.fillText(xLabel, xLabelX, xLabelY);

    // Y축 레이블 (본 게임 시간)
    const yLabel = formatTime(data.y);
    const yLabelX = xAxis.left - 10;
    const yLabelY = point.y;

    ctx.textAlign = "right";
    const yTextWidth = ctx.measureText(yLabel).width;
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.fillRect(yLabelX - yTextWidth - 4, yLabelY - 10, yTextWidth + 8, 20);

    ctx.fillStyle = data.color;
    ctx.fillText(yLabel, yLabelX, yLabelY);

    ctx.restore();
  },
};

const ctx = document.getElementById("clearChart").getContext("2d");

/* ---------------------------------------------------------
   차트 가독성 설정
   - 이름표는 상위 LABEL_RANK_LIMIT 위까지만 상시 표시
     (전체 표시 시 113개 이름이 화면을 가득 채움)
   - X축은 기본적으로 X_ZOOM_LIMIT(분) 이하만 보여줌
     기록의 절반이 약관 6시간 이내에 몰려 있어,
     18시간까지 펼치면 대다수가 왼쪽에 짓눌립니다.
   --------------------------------------------------------- */
const LABEL_RANK_LIMIT = 15;
const X_ZOOM_LIMIT = 360; // 6시간
let isXZoomed = true; // 기본: 확대 보기

// 차트 개선(이름표 축약/확대/드래그)은 신버전(XP)에서만 적용하고,
// 구버전은 기존 차트 동작을 그대로 유지합니다.
function isXpUi() {
  return document.body.dataset.ui === "xp";
}

// totalMin 오름차순 정렬 순서가 곧 순위이므로 labelRank로 저장
function assignLabelRank(list) {
  list.forEach((d, i) => {
    d.labelRank = i;
  });
  return list;
}

// 차트 초기 데이터에 재도전 데이터 포함 (정렬 포함)
const initialChartData = assignLabelRank(
  [...processedRecordData, ...processedRetryData].sort(
    (a, b) => a.totalMin - b.totalMin,
  ),
);

averages = computeAverages(initialChartData);

const myChart = new Chart(ctx, {
  type: "scatter",
  data: {
    datasets: [
      {
        label: "클리어 기록",
        data: initialChartData,
        backgroundColor: (context) => {
          if (activePoint !== null && context.dataIndex !== activePoint)
            return "#e0e0e0";
          return context.raw ? context.raw.color : "#333";
        },
        borderColor: (context) => {
          if (activePoint !== null && context.dataIndex !== activePoint)
            return "#cccccc";
          return context.raw ? context.raw.color : "#333";
        },
        borderWidth: 1,
        pointRadius: 6.4,
        pointHoverRadius: 8,
      },
    ],
  },
  // 평균선을 먼저 그려 점 아래에 깔리게 합니다.
  plugins: [averageLinePlugin, hoverAxisPlugin, histogramLabelPlugin],
  options: {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: 3 },
    onHover: (event, elements) => {
      // 점 위: pointer / 드래그 가능한 확대 보기: grab / 그 외: default
      event.native.target.style.cursor = elements.length
        ? "pointer"
        : isXpUi() && isXZoomed
          ? "grab"
          : "default";

      if (elements && elements.length > 0) {
        const newIndex = elements[0].index;
        if (activePoint !== newIndex) {
          activePoint = newIndex;
          myChart.update();
        }
      } else {
        if (activePoint !== null) {
          activePoint = null;
          myChart.update();
        }
      }
    },
    // 차트 점 클릭 시 리스트로 이동
    onClick: (e, elements) => {
      // 드래그로 화면을 옮긴 직후의 클릭은 무시
      if (window.chartJustPanned) return;
      // 오른쪽 목록은 명예의 전당이므로, 다른 리그에서는 순서가 맞지 않습니다.
      if (chartLeague !== "record") return;
      if (elements.length > 0) {
        const index = elements[0].index;
        const listContainer = document.getElementById("rankList");
        // rankList의 자식들은 li 태그들
        const targetItem = listContainer.children[index];

        if (targetItem) {
          // 요소의 컨테이너 내 상대 위치 계산
          // (아이템의 offsetTop - 컨테이너 높이 절반 + 아이템 높이 절반)
          const scrollTop =
            targetItem.offsetTop -
            listContainer.clientHeight / 2 +
            targetItem.clientHeight / 2;

          listContainer.scrollTo({
            top: scrollTop,
            behavior: "smooth",
          });

          // 하이라이트 효과
          const listItems = listContainer.querySelectorAll(".rank-item");
          listItems.forEach((item) => item.classList.remove("highlight-rank"));
          targetItem.classList.add("highlight-rank");
          setTimeout(() => {
            targetItem.classList.remove("highlight-rank");
          }, 2000);
        }
      }
    },
    scales: {
      // X축: 이용약관 (stepSize: 60)
      x: {
        type: "linear",
        position: "bottom",
        // 확대 보기에서는 6시간까지만. 그 밖의 기록은 '전체 보기'로 확인
        // (값은 applyXZoom() 에서 갱신합니다)
        max: X_ZOOM_LIMIT,
        title: {
          display: true,
          text: "이용약관과 마주한 시간",
          font: { weight: "bold", size: 14 },
          color: () => (activePoint !== null ? "transparent" : "#666"),
        },
        ticks: {
          stepSize: 60, // 약관은 시간이 기니까 1시간 단위
          callback: function (value) {
            return formatTime(value);
          },
          color: () => (activePoint !== null ? "transparent" : "#666"),
        },
        grid: { color: "rgba(0,0,0,0.05)" },
      },
      // Y축: 본 게임 (자동 눈금)
      y: {
        type: "linear",
        position: "left",
        title: {
          display: true,
          text: "클리어한 회차 플레이 시간(약관 + 본 게임)",
          font: { weight: "bold", size: 14 },
          color: () => (activePoint !== null ? "transparent" : "#666"),
        },
        ticks: {
          // stepSize 제거 (게임 시간은 짧으므로 자동 조정에 맡김)
          callback: function (value) {
            return formatTime(value);
          },
          color: () => (activePoint !== null ? "transparent" : "#666"),
        },
        grid: { color: "rgba(0,0,0,0.05)" },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: function (items) {
            if (chartLeague !== "speedrun") return items[0]?.label;
            const d = items[0]?.raw;
            if (!d) return "";
            return `${formatTime(d.binStart, false)} ~ ${formatTime(d.binEnd, false)}`;
          },
          label: function (context) {
            const d = context.raw;
            // 스피드런은 구간별 분포라, 그 구간에 속한 사람을 보여 줍니다.
            if (chartLeague === "speedrun") {
              return `${d.members.length}명`;
            }
            const icon = d.isShortcut ? "🎈" : "";
            return `${icon}${d.name} (총 ${formatTime(d.totalMin)})`;
          },
          afterLabel: function (context) {
            const d = context.raw;
            if (chartLeague === "speedrun") {
              if (!d.members.length) return "";
              // 순위 순으로, 너무 길어지지 않게 잘라 보여 줍니다.
              const MAX = 12;
              const lines = d.members
                .slice(0, MAX)
                .map((m) => ` ${m.rank}위 ${m.name} — ${m.gameTime}`);
              if (d.members.length > MAX) {
                lines.push(` … 외 ${d.members.length - MAX}명`);
              }
              return lines.join("\n");
            }
            // 툴팁 내용은 데이터 객체 그대로 사용 (x, y값과 무관하게 원본 텍스트 출력)
            return ` - 막트 전체: ${d.gameTime}\n - 약관: ${d.tosTime}`;
          },
        },
      },
      datalabels: {
        align: function (context) {
          const val = context.dataset.data[context.dataIndex];
          const allData = context.dataset.data;

          // 차트 이름 오른쪽으로
          if (val.name === "유즈하 리코") return "right";
          if (val.name === "큐베") return "right";
          if (val.name === "김나성") return "right";
          if (val.name === "시라유키 히나") return "right";
          if (val.name === "다주🎈") return "right";
          if (val.name === "아야츠노 유니") return "right";
          if (val.name === "김뿡") return "right";
          if (val.name === "사모장") return "right";
          if (val.name === "플라이") return "right";
          if (val.name === "강소연") return "right";
          if (val.name === "니니아*") return "right";
          if (val.name === "로션욤🎈") return "right";
          if (val.name === "로션욤*") return "right";
          if (val.name === "미라이 of HANAVI🎈") return "right";
          if (val.name === "강소연🎈") return "right";
          if (val.name === "양아지") return "right";
          if (val.name === "울프") return "right";
          if (val.name === "코리수🎈") return "right";
          if (val.name === "앰비션") return "right";
          if (val.name === "행돌") return "right";
          if (val.name === "위구리") return "right";
          if (val.name === "쿠레나이 나츠키") return "right";
          if (val.name === "던") return "right";
          if (val.name === "고뇨*") return "right";
          if (val.name === "마젯") return "right";
          if (val.name === "만디") return "right";
          if (val.name === "신선한망치") return "right";
          if (val.name === "포포포포 POPOPOPO") return "right";
          if (val.name === "눈꽃") return "right";
          if (val.name === "연이") return "right";
          if (val.name === "새담") return "right";
          if (val.name === "바뀐") return "right";
          if (val.name === "유람 Yuram") return "right";
          if (val.name === "자동") return "right";
          if (val.name === "탬탬버린") return "right";
          if (val.name === "자몽뀨") return "right";
          if (val.name === "눈가루") return "right";
          if (val.name === "김똘복") return "right";
          if (val.name === "네클릿") return "right";
          if (val.name === "이로 클라우드") return "right";
          if (val.name === "휘용") return "right";
          if (val.name === "냐미") return "right";
          if (val.name === "레아나 Reana") return "right";
          if (val.name === "햇살살") return "right";
          if (val.name === "김도") return "right";
          if (val.name === "유세라") return "right";
          if (val.name === "낭만숟가락1") return "right";
          if (val.name === "부쿠키") return "right";

          // 차트 이름 아래쪽으로
          if (val.name === "강지형") return "bottom";
          if (val.name === "텐코 시부키") return "bottom";
          if (val.name === "달콤레나") return "bottom";
          if (val.name === "수련수련") return "bottom";
          if (val.name === "소니쇼🎈") return "bottom";
          if (val.name === "망내") return "bottom";
          if (val.name === "브이챠🎈") return "bottom";
          if (val.name === "배돈") return "bottom";
          if (val.name === "김달걀") return "bottom";
          if (val.name === "매드라이프") return "bottom";
          if (val.name === "모카형") return "bottom";
          if (val.name === "모라라🎈") return "bottom";
          if (val.name === "니니아🎈") return "bottom";
          if (val.name === "코리수") return "bottom";
          if (val.name === "쾅준🎈") return "bottom";
          if (val.name === "고뇨🎈") return "bottom";
          if (val.name === "슈향") return "bottom";
          if (val.name === "똘킹") return "bottom";
          if (val.name === "헤징🎈") return "bottom";
          if (val.name === "윤가놈") return "bottom";
          if (val.name === "두뭉") return "bottom";
          if (val.name === "정령왕") return "bottom";
          if (val.name === "유레이 UREI") return "bottom";
          if (val.name === "모라라*") return "bottom";
          if (val.name === "이리온 lrion") return "bottom";
          if (val.name === "두니주니") return "bottom";
          if (val.name === "라꼬미") return "bottom";
          if (val.name === "랑께 님") return "bottom";
          if (val.name === "포키쨩") return "bottom";

          // 차트 이름 왼쪽으로
          if (val.name === "마우쥐") return "left";
          if (val.name === "고차비") return "left";
          if (val.name === "강지") return "left";
          if (val.name === "이춘향") return "left";
          if (val.name === "계춘회") return "left";
          if (val.name === "베릴") return "left";
          if (val.name === "루이쨘🎈") return "left";
          if (val.name === "콩콩") return "left";
          if (val.name === "러너") return "left";
          if (val.name === "로마러") return "left";
          if (val.name === "조별하") return "left";
          if (val.name === "다비") return "left";
          if (val.name === "진수") return "left";
          if (val.name === "루코") return "left";
          if (val.name === "캡틴잭") return "left";
          if (val.name === "삼식") return "left";
          if (val.name === "갱맘") return "left";
          if (val.name === "강소연*") return "left";
          if (val.name === "RIOORI 리우리") return "left";
          if (val.name === "아야 AyaUke") return "left";
          if (val.name === "짜누") return "left";
          if (val.name === "호무새") return "left";
          if (val.name === "묭이") return "left";
          if (val.name === "뇨롱이") return "left";
          if (val.name === "청묘") return "left";
          if (val.name === "RED레드") return "left";
          if (val.name === "김편집") return "left";
          if (val.name === "뱅") return "left";
          if (val.name === "연주하는곰탱") return "left";
          if (val.name === "우고님") return "left";
          if (val.name === "옌룡 Yenryong") return "left";
          if (val.name === "한동그라미") return "left";
          if (val.name === "만득") return "left";

          // 차트 이름 위쪽으로(기본)
          return "top";
        },
        anchor: "center",
        offset: 4,
        padding: { left: 4, right: 4 },
        // 113개 이름을 항상 띄우면 화면이 글자로 가득 차므로
        // 상위권 + 호버/검색 대상만 표시합니다. (LABEL_RANK_LIMIT)
        display: function (context) {
          // 히스토그램의 인원 수는 histogramLabelPlugin 이 직접 그립니다.
          // (차트 type 이 scatter 라 datalabels 가 막대 꼭대기를 못 잡습니다)
          const d0 = context.dataset.data[context.dataIndex];
          if (d0 && d0.members) return false;
          // 구버전은 기존처럼 모든 이름표를 표시
          if (!isXpUi()) return true;
          if (context.dataIndex === activePoint) return true;
          const d = context.dataset.data[context.dataIndex];
          return d && d.labelRank !== undefined && d.labelRank < LABEL_RANK_LIMIT;
        },
        color: (context) => {
          if (activePoint !== null && context.dataIndex !== activePoint)
            return "rgba(0,0,0,0.1)";
          return "#333";
        },
        font: {
          family: "Pretendard Variable, Pretendard, sans-serif",
          weight: "bold",
          size: 10.3,
        },
        formatter: function (value) {
          return value.name;
        },
      },
    },
  },
});

/* ---------------------------------------------------------
   X축 확대/전체 보기 전환
   --------------------------------------------------------- */
// 확대 보기에서 드래그로 이동한 현재 뷰포트 (null이면 기본 위치)
let panView = null;

// 데이터 전체 범위 (드래그 한계 계산용)
function getDataBounds() {
  const data = myChart.data.datasets[0].data;
  if (!data.length) return { xMin: 0, xMax: 60, yMin: 0, yMax: 30 };
  const xs = data.map((d) => d.x);
  const ys = data.map((d) => d.y);
  return {
    xMin: Math.min(...xs),
    xMax: Math.max(...xs),
    yMin: Math.min(...ys),
    yMax: Math.max(...ys),
  };
}

// 현재 보이는 영역 밖의 기록 수를 안내 문구로 갱신
function updateZoomHint() {
  const hint = document.getElementById("xZoomHint");
  if (!isXpUi() || !isXZoomed) {
    hint.textContent = "";
    return;
  }
  const xa = myChart.scales.x;
  const ya = myChart.scales.y;
  const hidden = myChart.data.datasets[0].data.filter(
    (d) => d.x < xa.min || d.x > xa.max || d.y < ya.min || d.y > ya.max,
  ).length;
  // 모바일에서는 드래그 패닝 대신 컨테이너를 스크롤하므로 안내를 달리합니다.
  const scroller = document.querySelector(".chart-scroll");
  const isScrollMode =
    scroller && scroller.scrollWidth > scroller.clientWidth;
  const how = isScrollMode ? "좌우로 밀어서 보기" : "드래그로 이동";

  hint.textContent = hidden > 0 ? `화면 밖 ${hidden}명 · ${how}` : how;
}

/**
 * 리그에 맞게 축 제목·눈금 표기를 바꿉니다.
 *
 * 스피드런은 x 가 시간이 아니라 순위라서, 시간 포맷을 그대로 쓰면
 * '1분, 2분…' 처럼 잘못 읽힙니다.
 */
function applyLeagueAxes() {
  const scales = myChart.options.scales;
  const speedrun = chartLeague === "speedrun";
  const dataset = myChart.data.datasets[0];

  // 스피드런은 분포(막대), 나머지는 산점도입니다.
  dataset.type = speedrun ? "bar" : "scatter";
  // 히스토그램은 막대가 구간 폭을 채우되 살짝 틈이 있어야 구간이 구분됩니다.
  dataset.barPercentage = 0.92;
  dataset.categoryPercentage = 1;
  dataset.barThickness = undefined;
  dataset.borderWidth = 1;

  scales.x.title.text = speedrun
    ? `클리어한 회차 시간 (${SPEEDRUN_BIN_MIN}분 구간)`
    : "이용약관과 마주한 시간";
  scales.x.ticks.callback = speedrun
    ? (value) => formatTime(value, false)
    : (value) => formatTime(value, false);
  scales.x.ticks.stepSize = speedrun ? SPEEDRUN_BIN_MIN : 60;
  // 막대가 축 양 끝에서 잘리지 않도록 여유를 둡니다.
  scales.x.offset = speedrun;

  scales.y.title.text = speedrun
    ? "인원 수"
    : "클리어한 회차 플레이 시간(약관 + 본 게임)";
  scales.y.ticks.stepSize = speedrun ? 5 : undefined;
  // 산점도의 y 는 시간이므로 원래 포맷을 되돌려야 합니다.
  scales.y.ticks.callback = speedrun
    ? (value) => (Number.isInteger(value) ? `${value}명` : "")
    : (value) => formatTime(value);
  scales.y.beginAtZero = speedrun;
}

function applyXZoom() {
  const btn = document.getElementById("xZoomBtn");
  const hint = document.getElementById("xZoomHint");
  const controls = document.querySelector(".chart-controls");
  const scales = myChart.options.scales;

  applyLeagueAxes();

  // 히스토그램은 x 범위가 이미 구간에 맞춰져 있어 확대가 뜻이 없습니다.
  if (chartLeague === "speedrun") {
    controls.style.display = isXpUi() ? "" : "none";
    scales.x.min = undefined;
    scales.x.max = undefined;
    scales.y.min = undefined;
    scales.y.max = undefined;
    myChart.update();
    btn.hidden = true;
    hint.textContent = "";
    return;
  }
  btn.hidden = false;

  // 구버전: 기존 차트 그대로 (축 제한/드래그 없음)
  if (!isXpUi()) {
    controls.style.display = "none";
    scales.x.min = undefined;
    scales.x.max = undefined;
    scales.y.min = undefined;
    scales.y.max = undefined;
    myChart.update();
    return;
  }

  controls.style.display = "";

  if (isXZoomed) {
    if (panView) {
      // 드래그로 이동한 위치 유지
      scales.x.min = panView.xMin;
      scales.x.max = panView.xMax;
      scales.y.min = panView.yMin;
      scales.y.max = panView.yMax;
    } else {
      scales.x.min = 0;
      scales.x.max = X_ZOOM_LIMIT;
      scales.y.min = undefined;
      scales.y.max = undefined;
    }
    myChart.update();

    btn.textContent = "🔍 전체 보기 (18시간까지)";
    updateZoomHint();
  } else {
    panView = null;
    scales.x.min = undefined;
    scales.x.max = undefined;
    scales.y.min = undefined;
    scales.y.max = undefined;
    myChart.update();
    btn.textContent = "🔍 확대 보기 (6시간까지)";
    hint.textContent = "";
  }
}

/* ---------------------------------------------------------
   확대 보기에서 차트 드래그(패닝)
   - 신버전 + 확대 보기일 때만 동작
   - 데이터 범위 밖으로 너무 벗어나지 않도록 여유분만 허용
   --------------------------------------------------------- */
(function initChartPan() {
  const canvas = document.getElementById("clearChart");
  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let startView = null;
  // 더블클릭 초기화 직후의 잔여 mousedown/up 을 무시하기 위한 플래그
  let justReset = false;

  /**
   * 드래그 패닝 가능 여부.
   *
   * 모바일(가로 스크롤 컨테이너 안)에서는 패닝을 끕니다.
   * 손가락 드래그는 컨테이너를 좌우로 스크롤하는 데 쓰여야 하고,
   * 둘이 겹치면 어느 쪽도 제대로 동작하지 않습니다.
   */
  function canPan() {
    if (!isXpUi() || !isXZoomed) return false;
    // 차트가 가로 스크롤 상태면(= 모바일 레이아웃) 패닝 대신 스크롤
    const scroller = canvas.closest(".chart-scroll");
    if (scroller && scroller.scrollWidth > scroller.clientWidth) return false;
    return true;
  }

  function currentView() {
    return {
      xMin: myChart.scales.x.min,
      xMax: myChart.scales.x.max,
      yMin: myChart.scales.y.min,
      yMax: myChart.scales.y.max,
    };
  }

  canvas.addEventListener("mousedown", function (e) {
    if (!canPan()) return;
    if (justReset) {
      justReset = false;
      return;
    }
    dragging = true;
    moved = false;
    startX = e.clientX;
    startY = e.clientY;
    startView = currentView();
  });

  window.addEventListener("mousemove", function (e) {
    if (!dragging || !startView) return;

    const rect = canvas.getBoundingClientRect();
    const dxPx = e.clientX - startX;
    const dyPx = e.clientY - startY;

    if (!moved && Math.abs(dxPx) + Math.abs(dyPx) < 3) return;
    moved = true;
    canvas.style.cursor = "grabbing";

    // 픽셀 이동량을 데이터 단위로 환산
    const xSpan = startView.xMax - startView.xMin;
    const ySpan = startView.yMax - startView.yMin;
    const xPerPx = xSpan / (myChart.chartArea.right - myChart.chartArea.left);
    const yPerPx = ySpan / (myChart.chartArea.bottom - myChart.chartArea.top);

    let nxMin = startView.xMin - dxPx * xPerPx;
    let nxMax = startView.xMax - dxPx * xPerPx;
    // Y축은 위로 갈수록 값이 커지므로 부호가 반대
    let nyMin = startView.yMin + dyPx * yPerPx;
    let nyMax = startView.yMax + dyPx * yPerPx;

    // 데이터 범위에서 한 화면 이상 벗어나지 않도록 제한
    const b = getDataBounds();
    const xPad = xSpan * 0.5;
    const yPad = ySpan * 0.5;

    if (nxMin < b.xMin - xPad) {
      nxMax += b.xMin - xPad - nxMin;
      nxMin = b.xMin - xPad;
    }
    if (nxMax > b.xMax + xPad) {
      nxMin -= nxMax - (b.xMax + xPad);
      nxMax = b.xMax + xPad;
    }
    if (nyMin < b.yMin - yPad) {
      nyMax += b.yMin - yPad - nyMin;
      nyMin = b.yMin - yPad;
    }
    if (nyMax > b.yMax + yPad) {
      nyMin -= nyMax - (b.yMax + yPad);
      nyMax = b.yMax + yPad;
    }

    panView = { xMin: nxMin, xMax: nxMax, yMin: nyMin, yMax: nyMax };

    const scales = myChart.options.scales;
    scales.x.min = nxMin;
    scales.x.max = nxMax;
    scales.y.min = nyMin;
    scales.y.max = nyMax;
    myChart.update("none");

    e.preventDefault();
  });

  window.addEventListener("mouseup", function () {
    if (!dragging) return;
    dragging = false;
    startView = null;
    canvas.style.cursor = "";
    if (moved) {
      // 드래그 직후 발생하는 click 이 점 선택으로 이어지지 않도록 차단
      window.chartJustPanned = true;
      setTimeout(() => {
        window.chartJustPanned = false;
      }, 0);
      // 드래그로 화면이 바뀌었으면 안내 문구만 갱신
      updateZoomHint();
    }
  });

  // (커서 모양은 차트의 onHover 에서 함께 관리합니다)

  // 확대 보기 기본 위치로 되돌리기 (더블클릭)
  // Chart.js 가 캔버스 이벤트를 가로채므로 래퍼에서 캡처 단계로 받습니다.
  const canvasWrap = canvas.closest(".chart-canvas-wrap") || canvas;
  canvasWrap.addEventListener("dblclick", function () {
    if (!canPan()) return;
    // 더블클릭 중 발생한 mousedown/up 이 방금 되돌린 위치를
    // 다시 덮어쓰지 않도록 드래그 상태를 완전히 정리합니다.
    dragging = false;
    moved = false;
    startView = null;
    justReset = true;
    panView = null;
    applyXZoom();
  });
})();

/* ---------------------------------------------------------
   특정 기록이 확대 화면 밖에 있으면 그 위치로 뷰를 옮깁니다.
   (명예의 전당 목록 클릭 / 스트리머 검색에서 호출)
   --------------------------------------------------------- */
function focusChartOn(dataItem) {
  // 구버전이거나 전체 보기면 이미 다 보이므로 이동 불필요
  if (!isXpUi() || !isXZoomed || !dataItem) return;

  const xa = myChart.scales.x;
  const ya = myChart.scales.y;

  // 가장자리에 딱 붙지 않도록 약간의 여유를 둡니다
  const xMargin = (xa.max - xa.min) * 0.08;
  const yMargin = (ya.max - ya.min) * 0.08;

  const inView =
    dataItem.x >= xa.min + xMargin &&
    dataItem.x <= xa.max - xMargin &&
    dataItem.y >= ya.min + yMargin &&
    dataItem.y <= ya.max - yMargin;

  if (inView) return;

  // 현재 확대 배율을 유지한 채 해당 점을 중앙으로
  const xSpan = xa.max - xa.min;
  const ySpan = ya.max - ya.min;

  panView = {
    xMin: dataItem.x - xSpan / 2,
    xMax: dataItem.x + xSpan / 2,
    yMin: dataItem.y - ySpan / 2,
    yMax: dataItem.y + ySpan / 2,
  };

  const scales = myChart.options.scales;
  scales.x.min = panView.xMin;
  scales.x.max = panView.xMax;
  scales.y.min = panView.yMin;
  scales.y.max = panView.yMax;
}

document.getElementById("xZoomBtn").addEventListener("click", function () {
  isXZoomed = !isXZoomed;
  panView = null;
  applyXZoom();
});

/** 스피드런 히스토그램 구간 폭(분). 2분이면 14개 안팎으로 나뉩니다. */
const SPEEDRUN_BIN_MIN = 2;

/**
 * 스피드런 리그를 '구간별 인원' 막대로 만듭니다.
 *
 * 스피드런 기록에는 약관 시간이 없어 산점도로는 그릴 수 없습니다.
 * 대신 회차 시간의 분포를 보여 주고, 각 막대에 속한 스트리머를
 * 순위와 함께 담아 두어 마우스를 올리면 확인할 수 있게 합니다.
 */
function buildSpeedrunHistogram() {
  // 스피드런 리그는 명예의 전당 회차 시간도 함께 줄을 세웁니다.
  // (renderSpeedrun 의 병합과 같은 규칙)
  const map = new Map();
  for (const item of [...processedRecordData, ...processedRetryData]) {
    map.set(item.name.replace("*", ""), item);
  }
  if (typeof SPEEDRUN_DATA !== "undefined") {
    for (const raw of SPEEDRUN_DATA) {
      const name = raw.name.replace("*", "");
      const prev = map.get(name);
      map.set(name, { ...(prev || {}), ...raw, name });
    }
  }

  // 빠른 순으로 정렬해 순위를 매깁니다.
  const ranked = [...map.values()]
    .map((item) => ({ name: item.name, gameTime: item.gameTime, min: parseTime(item.gameTime) }))
    .sort((a, b) => a.min - b.min)
    .map((item, i) => ({ ...item, rank: i + 1 }));

  // 구간별로 담습니다. 기록이 없는 중간 구간도 0 으로 채워야
  // 막대 사이가 벌어지지 않고 분포가 제대로 보입니다.
  const buckets = new Map();
  for (const item of ranked) {
    const start = Math.floor(item.min / SPEEDRUN_BIN_MIN) * SPEEDRUN_BIN_MIN;
    if (!buckets.has(start)) buckets.set(start, []);
    buckets.get(start).push(item);
  }

  const starts = [...buckets.keys()].sort((a, b) => a - b);
  const first = starts[0] ?? 0;
  const last = starts[starts.length - 1] ?? 0;

  const rows = [];
  for (let s = first; s <= last; s += SPEEDRUN_BIN_MIN) {
    const members = buckets.get(s) || [];
    rows.push({
      // 막대 중앙에 놓아야 구간을 가리키는 위치가 맞습니다.
      x: s + SPEEDRUN_BIN_MIN / 2,
      y: members.length,
      binStart: s,
      binEnd: s + SPEEDRUN_BIN_MIN,
      members,
      // 산점도용 필드들이 없어도 되도록 최소한만 맞춰 둡니다.
      name: `${s}~${s + SPEEDRUN_BIN_MIN}분`,
      color: "#3a93ff",
    });
  }
  return rows;
}

function getDisplayData() {
  if (chartLeague === "shortcut") {
    return assignLabelRank(
      [...processedShortcutData].sort((a, b) => a.totalMin - b.totalMin),
    );
  }

  if (chartLeague === "speedrun") {
    return buildSpeedrunHistogram();
  }

  // 명예의 전당 (+ 선택 시 풍선 숏컷)
  const isShortcutChecked = document.getElementById("toggleShortcut").checked;

  let finalData = [...processedRecordData, ...processedRetryData]; // 기본 데이터 + 재시도 데이터

  if (isShortcutChecked) {
    finalData = [...finalData, ...processedShortcutData]; // 숏컷 데이터
  }

  // 정렬 후 순위를 다시 매겨 이름표 표시 기준(labelRank)을 갱신
  return assignLabelRank(finalData.sort((a, b) => a.totalMin - b.totalMin));
}

/**
 * 각 목록이 '마지막으로 그린 데이터 배열'.
 * 목록은 검색·펼치기에 따라 걸러지거나 잘리므로,
 * 우클릭한 li 를 원본 항목으로 되돌리려면 그린 순서 그대로가 필요합니다.
 */
const renderedLists = {};

function renderRanking() {
  const listContainer = document.getElementById("rankList");
  listContainer.innerHTML = "";

  const displayData = getDisplayData();

  let rankCounter = 0;

  // 우클릭 메뉴가 li → 데이터를 되찾을 수 있도록 이번에 그린 목록을 기억합니다.
  renderedLists.rankList = displayData;

  displayData.forEach((data, index) => {
    const li = document.createElement("li");
    li.className = "rank-item";
    li.dataset.idx = String(index);

    let badgeContent = "";
    let badgeClass = "";

    // 타입별 분기 처리
    if (data.type === "shortcut") {
      badgeContent = "🎈";
      li.classList.add("shortcut-user"); // 숏컷 유저 스타일
    } else {
      // 일반 유저 (순위 부여)
      rankCounter++;
      badgeContent = rankCounter;
      if (rankCounter === 1) badgeClass = "gold";
      else if (rankCounter === 2) badgeClass = "silver";
      else if (rankCounter === 3) badgeClass = "bronze";
    }

    li.innerHTML = `
                <div class="rank-main">
                    <span class="rank-badge ${badgeClass}">${badgeContent}</span>
                    <div class="rank-info">
                        <span class="rank-name-row"><span class="rank-name" style="color:${data.color}">${data.name}</span>${newBadgeHtml(data)}</span>
                        <span class="rank-detail"><span class="detail-part">막트 전체: ${formatTime(data.y, false)}</span> <span class="detail-part">/ 약관: ${formatTime(data.x, false)}</span></span>
                    </div>
                </div>
                <span class="rank-time" style="font-weight:bold;">${formatTime(data.totalMin, false)}</span>
            `;

    // 리스트 클릭 시 차트 포커스
    li.onclick = () => {
      // 1. 기존에 예약된 포커스 해제 타이머가 있다면 취소
      if (chartFocusTimeout) {
        clearTimeout(chartFocusTimeout);
      }

      // 2. 확대 상태에서 화면 밖이면 해당 위치로 차트를 이동
      focusChartOn(data);

      // 3. 차트 하이라이트 & 툴팁 활성화
      activePoint = index;
      myChart.tooltip.setActiveElements([{ datasetIndex: 0, index: index }]);
      myChart.setActiveElements([{ datasetIndex: 0, index: index }]);
      myChart.update();

      // 4. 3초 뒤에 포커스 해제 예약
      chartFocusTimeout = setTimeout(() => {
        activePoint = null; // 점선(Crosshair) 제거
        myChart.tooltip.setActiveElements([]); // 툴팁 숨기기
        myChart.setActiveElements([]); // 점 활성화 해제
        myChart.update();
        // 이동했다면 '화면 밖 N명' 안내를 갱신
        updateZoomHint();
      }, 1500);
    };

    listContainer.appendChild(li);
  });
}

// 검색 내용 초기화 함수
function clearSearch() {
  const input = document.getElementById("playerSearchInput");
  input.value = "";
  toggleClearBtn(); // 버튼 숨김 처리
  input.focus(); // 입력창 포커스 유지
}

// 삭제 버튼 토글 함수
function toggleClearBtn() {
  const input = document.getElementById("playerSearchInput");
  const clearBtn = document.getElementById("clearSearchBtn");
  if (input.value.length > 0) {
    clearBtn.style.display = "block";
  } else {
    clearBtn.style.display = "none";
  }
}

// 검색 함수
function searchPlayer() {
  const input = document.getElementById("playerSearchInput").value.trim();
  if (!input) return;

  const listItems = document.querySelectorAll("#rankList .rank-item");
  let found = false;

  for (let i = 0; i < listItems.length; i++) {
    const nameSpan = listItems[i].querySelector(".rank-name");
    // includes로 부분 일치 검색
    if (nameSpan && nameSpan.textContent.includes(input)) {
      const listContainer = document.getElementById("rankList");
      const targetItem = listItems[i];

      // 스크롤 이동 로직
      const scrollTop =
        targetItem.offsetTop -
        listContainer.clientHeight / 2 +
        targetItem.clientHeight / 2;
      listContainer.scrollTo({
        top: scrollTop,
        behavior: "smooth",
      });

      // 하이라이트 효과
      listItems.forEach((item) => item.classList.remove("highlight-rank"));
      targetItem.classList.add("highlight-rank");

      // 2초 뒤 하이라이트 제거
      setTimeout(() => {
        targetItem.classList.remove("highlight-rank");
      }, 2000);

      // 차트 포커싱 (기존 click 이벤트 트리거)
      targetItem.click();

      found = true;
      break; // 첫 번째 검색 결과만 이동
    }
  }

  // 검색 결과가 없을 때 깜빡임 효과
  if (!found) {
    const rankSection = document.querySelector(".rank-section");
    rankSection.classList.add("search-error");
    setTimeout(() => {
      rankSection.classList.remove("search-error");
    }, 1000); // 1초 뒤 제거
  }
}

// 이벤트 리스너 등록
const searchInput = document.getElementById("playerSearchInput");

// 입력 시 삭제 버튼 토글
searchInput.addEventListener("input", toggleClearBtn);

// 1. Enter: 키를 누르자마자 검색 실행
searchInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter") {
    searchPlayer();
  }
});

// 2. Escape: 키를 뗄 때 포커스 해제 (MacOS 한글 중복 버그 방지)
searchInput.addEventListener("keyup", function (e) {
  if (e.key === "Escape") {
    clearSearch();
    this.blur(); // 포커스 해제
  }
});

function updateChart() {
  const displayData = getDisplayData();
  myChart.data.datasets[0].data = displayData;
  // 숏컷 포함 여부가 바뀌면 평균도 달라집니다.
  averages = computeAverages(displayData);
  // 데이터가 바뀌면 숨김 인원 수도 달라지므로 함께 갱신
  applyXZoom();
}

function renderRetries() {
  const listContainer = document.getElementById("retryList");
  listContainer.innerHTML = "";

  renderedLists.retryList = sortedRetryData;

  sortedRetryData.forEach((data, index) => {
    const li = document.createElement("li");
    li.className = "retry-item list-item";
    li.style.borderLeft = `4px solid ${data.color}`;
    li.dataset.idx = String(index);

    li.innerHTML = `
                <span class="rank-badge">${index + 1}</span> <span style="font-weight:bold; color:${data.color}">${data.name}</span>${newBadgeHtml(data)}
                <span style="color:#666; font-size:0.8em">(${data.gameTime}/${data.tosTime})</span>
                <span style="font-weight:bold; font-size: 0.75rem">${formatTime(data.totalMin)}</span>
            `;
    listContainer.appendChild(li);
  });
}

// 스피드런 펼침 상태 관리 변수
let isSpeedrunExpanded = false;

// 스피드런 데이터 가공 및 렌더링
function renderSpeedrun() {
  const listContainer = document.getElementById("speedrunList");
  const expandBtn = document.getElementById("speedrunExpandBtn");

  listContainer.innerHTML = "";

  // 중복된 이름이 있을 경우 SPEEDRUN_DATA가 우선되도록 Map으로 병합
  const dataMap = new Map();

  // 1. 명예의 전당(일반+재도전) 데이터를 먼저 맵에 등록
  [...RECORD_DATA, ...RETRY_DATA].forEach((item) => {
    const cleanName = item.name.replace("*", "");
    dataMap.set(cleanName, item);
  });

  // 2. 스피드런 데이터로 덮어쓰기 (Override)
  //
  // 스피드런은 같은 사람이 여러 번 갱신할 수 있어 SPEEDRUN_DATA 에
  // 같은 이름이 여러 개 있을 수 있습니다. 순위에는 '가장 빠른 기록'만
  // 쓰고, 나머지는 previous 에 모아 우클릭 메뉴에서 보여 줍니다.
  // (배열 순서가 곧 기록 순서는 아니므로 시간으로 비교합니다)
  if (typeof SPEEDRUN_DATA !== "undefined") {
    const byName = new Map();
    SPEEDRUN_DATA.forEach((item) => {
      const cleanName = item.name.replace("*", "");
      if (!byName.has(cleanName)) byName.set(cleanName, []);
      byName.get(cleanName).push({ ...item, name: cleanName });
    });

    byName.forEach((entries, cleanName) => {
      // 빠른 순으로 정렬 → 첫 항목이 대표 기록, 나머지가 이전 기록
      const sorted = entries
        .slice()
        .sort((a, b) => parseTime(a.gameTime) - parseTime(b.gameTime));
      const best = sorted[0];
      const previous = sorted.slice(1);

      const merged = { ...best };
      if (previous.length) merged.previous = previous;

      if (dataMap.has(cleanName)) {
        // 이미 명예의 전당에 있는 경우: 기존 데이터(색상, tosTime 등)는
        // 유지하되 gameTime 만 스피드런 기록으로 교체
        dataMap.set(cleanName, { ...dataMap.get(cleanName), ...merged });
      } else {
        dataMap.set(cleanName, merged);
      }
    });
  }

  // 3. 맵을 배열로 변환
  const combinedData = Array.from(dataMap.values());

  // 4. 데이터 가공
  const speedrunData = combinedData.map((item) => {
    // 이름으로 찾아보고, 없으면 뒤에 '*'를 붙여서 다시 찾아봄
    const color =
      STREAMER_COLORS[item.name] ||
      STREAMER_COLORS[item.name + "*"] ||
      DEFAULT_COLOR;

    return {
      ...item,
      parsedGameTime: parseTime(item.gameTime), // 여기서 SPEEDRUN_DATA의 시간이 파싱됨
      color: color,
    };
  });

  // 5. 게임 시간(parsedGameTime) 오름차순 정렬
  speedrunData.sort((a, b) => a.parsedGameTime - b.parsedGameTime);

  // 6. 30위까지만 자르기 vs 전체 보여주기
  const DISPLAY_LIMIT = 30;
  const finalData = isSpeedrunExpanded
    ? speedrunData
    : speedrunData.slice(0, DISPLAY_LIMIT);

  // 7. 렌더링
  renderedLists.speedrunList = finalData;

  finalData.forEach((data, index) => {
    const li = document.createElement("li");
    li.className = "speedrun-item";
    li.style.borderLeft = `4px solid ${data.color}`;
    li.dataset.idx = String(index);

    li.innerHTML = `
        <span class="rank-badge">${index + 1}</span>
        <span style="font-weight:bold; color:${data.color}">${data.name}</span>${newBadgeHtml(data)}
        <span style="font-weight:bold; font-size: 0.85rem; margin-left: auto;">${formatTime(data.parsedGameTime, true)}</span>
    `;

    listContainer.appendChild(li);
  });

  // 버튼 상태 업데이트
  // 데이터가 30개 이하라면 버튼을 숨김
  if (speedrunData.length <= DISPLAY_LIMIT) {
    expandBtn.style.display = "none";
  } else {
    expandBtn.style.display = "inline-flex";
    if (isSpeedrunExpanded) {
      expandBtn.innerHTML = `접기 ▲`;
    } else {
      const remaining = speedrunData.length - DISPLAY_LIMIT;
      expandBtn.innerHTML = `더 보기 리그 (+${remaining}명) ▼`;
    }
  }
}

// 더 보기 버튼 클릭 이벤트 리스너
document
  .getElementById("speedrunExpandBtn")
  .addEventListener("click", function () {
    isSpeedrunExpanded = !isSpeedrunExpanded; // 상태 토글
    renderSpeedrun(); // 리스트 다시 그리기
  });

//  숏컷 펼침 상태 관리 변수
let isShortcutExpanded = false;

function renderShortcuts() {
  const listContainer = document.getElementById("shortcutList");
  const expandBtn = document.getElementById("shortcutExpandBtn");

  listContainer.innerHTML = "";

  // 30위까지만 자르기 vs 전체 보여주기
  const DISPLAY_LIMIT = 30;
  const finalData = isShortcutExpanded
    ? sortedShortcutData
    : sortedShortcutData.slice(0, DISPLAY_LIMIT);

  renderedLists.shortcutList = finalData;

  finalData.forEach((data, index) => {
    const li = document.createElement("li");
    li.className = "shortcut-item";
    li.style.borderLeft = `4px solid ${data.color}`;
    li.dataset.idx = String(index);

    li.innerHTML = `
                <span class="rank-badge">${index + 1}</span> <span style="font-weight:bold; color:${data.color}">${data.name}</span>${newBadgeHtml(data)}
                <span style="color:#666; font-size:0.8em">(${data.gameTime}/${data.tosTime})</span>
                <span style="font-weight:bold; font-size: 0.75rem">${formatTime(data.totalMin)}</span>
            `;

    listContainer.appendChild(li);
  });

  // 버튼 상태 업데이트 로직
  if (sortedShortcutData.length <= DISPLAY_LIMIT) {
    expandBtn.style.display = "none"; // 데이터가 적으면 버튼 숨김
  } else {
    expandBtn.style.display = "inline-flex";
    if (isShortcutExpanded) {
      expandBtn.innerHTML = `접기 ▲`;
    } else {
      const remaining = sortedShortcutData.length - DISPLAY_LIMIT;
      expandBtn.innerHTML = `더 보기 리그 (+${remaining}명) ▼`;
    }
  }
}

// 숏컷 더 보기 버튼 클릭 이벤트 리스너
document
  .getElementById("shortcutExpandBtn")
  .addEventListener("click", function () {
    isShortcutExpanded = !isShortcutExpanded; // 상태 토글
    renderShortcuts(); // 리스트 다시 그리기
  });

function updateAll() {
  renderRanking();
  updateChart();

  // 경고 문구 표시 로직
  const isShorcutChecked = document.getElementById("toggleShortcut").checked;
  const shorcutWarningText = document.getElementById("shortcutWarning");

  if (isShorcutChecked) {
    shorcutWarningText.style.display = "inline";
  } else {
    shorcutWarningText.style.display = "none";
  }
}

// 스크롤 유도 화살표 로직
const arrowSpeedrun = document.getElementById("arrowToSpeedrun");
const arrowShortcut = document.getElementById("arrowToShortcut");
const arrowRetry = document.getElementById("arrowToRetry");
const arrowToTop = document.getElementById("arrowToTop");

// 대상 섹션들
const sectionSpeedrun = document.getElementById("sectionSpeedrun");
const sectionShortcut = document.getElementById("sectionShortcut");
const sectionRetry = document.getElementById("sectionRetry");

function checkScroll() {
  const windowHeight = window.innerHeight;

  if (sectionSpeedrun && arrowSpeedrun) {
    const rect = sectionSpeedrun.getBoundingClientRect();
    if (rect.top < windowHeight - 200) {
      arrowSpeedrun.classList.add("hidden");
    } else {
      arrowSpeedrun.classList.remove("hidden");
    }
  }

  // 1번 화살표 (숏컷 섹션으로 가는 것)
  if (sectionShortcut) {
    const rect = sectionShortcut.getBoundingClientRect();
    // 타겟 섹션의 윗부분이 화면 하단보다 조금 위로 올라오면 (보이기 시작하면) 숨김
    if (rect.top < windowHeight - 200) {
      arrowShortcut.classList.add("hidden");
    } else {
      arrowShortcut.classList.remove("hidden");
    }
  }

  // 2번 화살표 (재도전 섹션으로 가는 것)
  if (sectionRetry) {
    const rect = sectionRetry.getBoundingClientRect();
    if (rect.top < windowHeight - 250) {
      arrowRetry.classList.add("hidden");
      arrowToTop.classList.remove("hidden");
    } else {
      arrowRetry.classList.remove("hidden");
      arrowToTop.classList.add("hidden");
    }
  }
}

// 부드러운 이동 함수
function scrollToId(id) {
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// 맨 위로 이동
function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// 화살표 클릭 시 부드럽게 해당 섹션으로 이동
function scrollToBottom() {
  if (targetSection) {
    targetSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// 스크롤 이벤트 등록
window.addEventListener("scroll", checkScroll);

// 초기 로딩 시 위치 확인 (이미 스크롤된 상태로 로드될 경우 대비)
checkScroll();

document.getElementById("toggleShortcut").addEventListener("change", (e) => {
  // 차트 옆 토글도 같은 값으로 맞춥니다.
  const box = document.getElementById("toggleShortcutChart");
  if (box) box.checked = e.target.checked;
  updateAll();
});

// 평균선 표시 토글 (차트가 빽빽해 거슬릴 수 있어 끌 수 있게 둡니다)
document.getElementById("toggleAverage").addEventListener("change", (e) => {
  showAverage = e.target.checked;
  myChart.update();
});

/* ---------------------------------------------------------
   리그별 차트 전환
   --------------------------------------------------------- */
const chartShortcutBox = document.getElementById("toggleShortcutChart");
const chartShortcutLabel = document.getElementById("chartShortcutToggleLabel");

/**
 * 리그에 따라 쓸모없는 컨트롤을 감춥니다.
 *  - '풍선 숏컷 포함'은 명예의 전당 차트에서만 뜻이 있습니다.
 *  - 평균선은 히스토그램(스피드런)에서 뜻이 없습니다. y 가 인원 수입니다.
 */
function syncChartControls() {
  chartShortcutLabel.hidden = chartLeague !== "record";
  const avgLabel = document.getElementById("toggleAverage")?.closest("label");
  if (avgLabel) avgLabel.hidden = chartLeague === "speedrun";
}

/* XP 스타일 드롭다운 (네이티브 select 의 목록은 OS 가 그려서 못 꾸밉니다) */
(function initLeagueSelect() {
  const btn = document.getElementById("chartLeagueBtn");
  const list = document.getElementById("chartLeagueList");
  const valueEl = document.getElementById("chartLeagueValue");
  const items = [...list.querySelectorAll("li")];

  function close() {
    list.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  }
  function open() {
    list.hidden = false;
    btn.setAttribute("aria-expanded", "true");
  }

  function choose(li) {
    const value = li.dataset.value;
    close();
    if (value === chartLeague) return;

    chartLeague = value;
    valueEl.textContent = li.textContent.trim();
    items.forEach((x) => x.classList.toggle("selected", x === li));
    syncChartControls();
    // 리그가 바뀌면 확대·이동 상태를 초기화합니다.
    // (축의 의미가 달라져 이전 범위를 유지하면 엉뚱한 곳을 봅니다)
    panView = null;
    activePoint = null;
    updateChart();
    // Chart.js 는 scriptable 옵션 결과를 캐시합니다. 리그가 바뀌면
    // 막대/점이 서로 다른 설정을 써야 하므로 캐시를 비웁니다.
    myChart.update("resize");
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (list.hidden) open();
    else close();
  });

  list.addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (li) choose(li);
  });

  // 키보드로도 고를 수 있게 합니다.
  btn.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
      const cur = items.findIndex((x) => x.classList.contains("selected"));
      const next = items[e.key === "ArrowDown" ? Math.min(cur + 1, items.length - 1) : cur];
      if (next) next.focus?.();
    }
  });
  list.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      close();
      btn.focus();
    }
  });

  document.addEventListener("click", () => close());
  window.addEventListener("blur", close);
})();

// 차트 옆 토글과 숏컷 섹션의 토글은 같은 값을 공유합니다.
// 둘 중 어느 쪽을 눌러도 같게 동작해야 헷갈리지 않습니다.
chartShortcutBox.addEventListener("change", (e) => {
  document.getElementById("toggleShortcut").checked = e.target.checked;
  updateAll();
});

syncChartControls();

// UI 버전을 바꾸면 평균선 표시 여부도 달라지므로 다시 그립니다.
document.getElementById("uiVersionToggle").addEventListener("click", () => {
  if (typeof myChart !== "undefined") myChart.update();
});

// 초기 실행
renderRanking();
renderSpeedrun();
renderShortcuts();
renderRetries();
applyXZoom(); // X축 확대 상태 및 안내 문구 초기화

// 순위 항목 우클릭 메뉴 (채널/클립/다시보기 열기)
initContextMenu();
for (const id of ["rankList", "retryList", "speedrunList", "shortcutList"]) {
  attachContextMenu(id, (li) => {
    const list = renderedLists[id];
    const idx = Number(li.dataset.idx);
    return list && Number.isInteger(idx) ? list[idx] : null;
  });
}

// 'NEW' 배지는 6시간이 지나면 사라져야 하므로 만료를 확인합니다.
startBadgeExpiry(() => {
  renderRanking();
  renderSpeedrun();
  renderShortcuts();
  renderRetries();
});

// 리스트 생성 후 스크롤 상태 재확인 (DOM 높이 변경 반영)
setTimeout(checkScroll, 100);
