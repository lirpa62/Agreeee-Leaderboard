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

// 차트 초기 데이터에 재도전 데이터 포함 (정렬 포함)
const initialChartData = [...processedRecordData, ...processedRetryData].sort(
  (a, b) => a.totalMin - b.totalMin,
);

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
  plugins: [hoverAxisPlugin],
  options: {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: 3 },
    onHover: (event, elements) => {
      // 마우스가 점 위에 있을 때 커서를 pointer로, 아니면 default로 변경
      event.native.target.style.cursor = elements.length
        ? "pointer"
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
          label: function (context) {
            const d = context.raw;
            const icon = d.isShortcut ? "🎈" : "";
            return `${icon}${d.name} (총 ${formatTime(d.totalMin)})`;
          },
          afterLabel: function (context) {
            const d = context.raw;
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

          // 차트 이름 위쪽으로(기본)
          return "top";
        },
        anchor: "center",
        offset: 4,
        padding: { left: 4, right: 4 },
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

function getDisplayData() {
  const isShortcutChecked = document.getElementById("toggleShortcut").checked;

  let finalData = [...processedRecordData, ...processedRetryData]; // 기본 데이터 + 재시도 데이터

  if (isShortcutChecked) {
    finalData = [...finalData, ...processedShortcutData]; // 숏컷 데이터
  }

  return finalData.sort((a, b) => a.totalMin - b.totalMin);
}

function renderRanking() {
  const listContainer = document.getElementById("rankList");
  listContainer.innerHTML = "";

  const displayData = getDisplayData();

  let rankCounter = 0;

  displayData.forEach((data, index) => {
    const li = document.createElement("li");
    li.className = "rank-item";

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
                <div style="display:flex; align-items:center;">
                    <span class="rank-badge ${badgeClass}">${badgeContent}</span>
                    <div class="rank-info">
                        <span class="rank-name" style="color:${data.color}">${data.name}</span>
                        <span class="rank-detail">막트 전체: ${formatTime(data.y, false)} / 약관: ${formatTime(data.x, false)}</span>
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

      // 2. 차트 하이라이트 & 툴팁 활성화
      activePoint = index;
      myChart.tooltip.setActiveElements([{ datasetIndex: 0, index: index }]);
      myChart.setActiveElements([{ datasetIndex: 0, index: index }]);
      myChart.update();

      // 3. 3초 뒤에 포커스 해제 예약
      chartFocusTimeout = setTimeout(() => {
        activePoint = null; // 점선(Crosshair) 제거
        myChart.tooltip.setActiveElements([]); // 툴팁 숨기기
        myChart.setActiveElements([]); // 점 활성화 해제
        myChart.update();
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
  myChart.update();
}

function renderRetries() {
  const listContainer = document.getElementById("retryList");
  listContainer.innerHTML = "";

  sortedRetryData.forEach((data, index) => {
    const li = document.createElement("li");
    li.className = "retry-item list-item";
    li.style.borderLeft = `4px solid ${data.color}`;

    li.innerHTML = `
                <span class="rank-badge">${index + 1}</span> <span style="font-weight:bold; color:${data.color}">${data.name}</span>
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

  // 2. 스피드런 데이터가 있다면 덮어쓰기 (Override)
  // SPEEDRUN_DATA에 있는 이름이라면, 기존 기록(gameTime)을 새 기록으로 교체
  if (typeof SPEEDRUN_DATA !== "undefined") {
    SPEEDRUN_DATA.forEach((item) => {
      const cleanName = item.name.replace("*", "");

      const speedrunItem = { ...item, name: cleanName };

      if (dataMap.has(cleanName)) {
        // 이미 명예의 전당에 있는 경우: 기존 데이터(색상, tosTime 등)는 유지하되 gameTime만 스피드런 기록으로 교체
        const original = dataMap.get(cleanName);
        dataMap.set(cleanName, { ...original, ...speedrunItem });
      } else {
        // 명예의 전당에 없는 경우: 그냥 추가
        dataMap.set(cleanName, speedrunItem);
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
  finalData.forEach((data, index) => {
    const li = document.createElement("li");
    li.className = "speedrun-item";
    li.style.borderLeft = `4px solid ${data.color}`;

    li.innerHTML = `
        <span class="rank-badge">${index + 1}</span>
        <span style="font-weight:bold; color:${data.color}">${data.name}</span>
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

  finalData.forEach((data, index) => {
    const li = document.createElement("li");
    li.className = "shortcut-item";
    li.style.borderLeft = `4px solid ${data.color}`;

    li.innerHTML = `
                <span class="rank-badge">${index + 1}</span> <span style="font-weight:bold; color:${data.color}">${data.name}</span>
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

document.getElementById("toggleShortcut").addEventListener("change", updateAll);

// 초기 실행
renderRanking();
renderSpeedrun();
renderShortcuts();
renderRetries();

// 리스트 생성 후 스크롤 상태 재확인 (DOM 높이 변경 반영)
setTimeout(checkScroll, 100);
