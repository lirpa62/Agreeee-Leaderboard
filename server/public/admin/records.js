/**
 * 기록 링크 관리 화면
 *
 * data.js 의 기록에 채널·클립·다시보기 주소를 추가/수정/삭제합니다.
 * 기록 자체(이름·시간)는 건드리지 않습니다 — 그건 검토 화면의 몫입니다.
 */

const LEAGUE_LABEL = {
  RECORD_DATA: "명예의 전당",
  RETRY_DATA: "재도전 인정",
  SHORTCUT_DATA: "풍선 숏컷",
  SPEEDRUN_DATA: "스피드런",
};

const FIELDS = [
  { key: "channelUrl", label: "채널 주소", icon: "📺" },
  { key: "clipUrl", label: "클립 주소", icon: "🎬" },
  { key: "vodUrl", label: "다시보기 주소", icon: "📼" },
];

let rows = [];
let filter = "all";

const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (res.status === 401) {
    location.href = "login.html";
    throw new Error("로그인이 필요합니다.");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    throw new Error(json.error || `요청에 실패했습니다. (${res.status})`);
  }
  return json;
}

/** 링크가 몇 개나 채워져 있는지 */
function fillState(row) {
  const n = FIELDS.filter((f) => row[f.key]).length;
  if (n === 0) return "missing";
  if (n === FIELDS.length) return "complete";
  return "partial";
}

function escapeHtml(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}

/** 탭 개수는 리그·검색 필터까지 반영해 실제 보이는 수를 셉니다. */
function updateCounts() {
  const league = $("leagueFilter").value;
  const query = $("search").value.trim().toLowerCase();
  const base = rows.filter((r) => {
    if (league && r.arrayName !== league) return false;
    if (query && !r.name.toLowerCase().includes(query)) return false;
    return true;
  });
  $("cnt-all").textContent = base.length;
  for (const state of ["missing", "partial", "complete"]) {
    $(`cnt-${state}`).textContent = base.filter(
      (r) => fillState(r) === state,
    ).length;
  }
}

function render() {
  const league = $("leagueFilter").value;
  const query = $("search").value.trim().toLowerCase();

  const shown = rows.filter((r) => {
    if (league && r.arrayName !== league) return false;
    if (filter !== "all" && fillState(r) !== filter) return false;
    if (query && !r.name.toLowerCase().includes(query)) return false;
    return true;
  });

  updateCounts();

  const list = $("list");
  list.innerHTML = "";
  $("empty").hidden = shown.length > 0;

  for (const row of shown) {
    const el = document.createElement("div");
    el.className = `rec-card ${fillState(row)}`;
    el.dataset.array = row.arrayName;
    el.dataset.index = String(row.index);

    const time =
      escapeHtml(row.gameTime) +
      (row.tosTime ? ` / 약관 ${escapeHtml(row.tosTime)}` : "");

    el.innerHTML = `
      <div class="rec-head">
        <span class="rec-name">${escapeHtml(row.name)}</span>
        <span class="rec-league">${LEAGUE_LABEL[row.arrayName] || row.arrayName}</span>
        <span class="rec-time">${time}</span>
        <span class="rec-state" title="채워진 링크 수">${
          FIELDS.filter((f) => row[f.key]).length
        }/${FIELDS.length}</span>
      </div>
      <div class="rec-fields">
        ${FIELDS.map(
          (f) => `
          <label class="rec-field">
            <span class="rec-field-label">${f.icon} ${f.label}</span>
            <input type="url" class="xp-input" data-key="${f.key}"
                   value="${escapeHtml(row[f.key])}"
                   placeholder="${
                     f.key === "vodUrl"
                       ? "치지직 또는 유튜브 주소"
                       : "치지직 주소"
                   }" />
            <a class="rec-open${row[f.key] ? "" : " empty"}"
               data-open="${f.key}"
               ${row[f.key] ? `href="${escapeHtml(row[f.key])}"` : ""}
               target="_blank" rel="noopener noreferrer"
               >${row[f.key] ? "열기" : "없음"}</a>
          </label>`,
        ).join("")}
      </div>
      <div class="rec-actions">
        <span class="rec-msg"></span>
        <button type="button" class="xp-button primary rec-save">저장</button>
      </div>`;

    list.appendChild(el);
  }
}

async function save(card) {
  const arrayName = card.dataset.array;
  const index = Number(card.dataset.index);
  const btn = card.querySelector(".rec-save");
  const msg = card.querySelector(".rec-msg");

  const payload = { arrayName, index };
  for (const input of card.querySelectorAll("input[data-key]")) {
    payload[input.dataset.key] = input.value.trim();
  }

  btn.disabled = true;
  msg.textContent = "저장 중…";
  msg.className = "rec-msg";

  try {
    const { updated } = await api("/api/admin/records/urls", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    // 로컬 목록도 갱신해 두어야 탭 개수와 '열기' 링크가 맞습니다.
    const row = rows.find(
      (r) => r.arrayName === arrayName && r.index === index,
    );
    if (row) {
      for (const f of FIELDS) row[f.key] = updated[f.key] || "";
    }
    // 다시 그리면 '저장했습니다' 가 지워지므로, 카드 상태만 직접 갱신합니다.
    // (목록 전체를 다시 그리면 입력 중이던 다른 카드도 초기화됩니다)
    if (row) {
      card.className = `rec-card ${fillState(row)}`;
      card.querySelector(".rec-state").textContent =
        `${FIELDS.filter((f) => row[f.key]).length}/${FIELDS.length}`;
      for (const f of FIELDS) {
        const link = card.querySelector(`[data-open="${f.key}"]`);
        if (!link) continue;
        if (row[f.key]) {
          link.textContent = "열기";
          link.className = "rec-open";
          link.href = row[f.key];
        } else {
          link.textContent = "없음";
          link.className = "rec-open empty";
          link.removeAttribute("href");
        }
      }
      updateCounts();
    }
    msg.textContent = "저장했습니다.";
    msg.className = "rec-msg ok";
  } catch (e) {
    msg.textContent = e.message;
    msg.className = "rec-msg err";
  } finally {
    btn.disabled = false;
  }
}

async function load() {
  try {
    const { rows: fetched } = await api("/api/admin/records");
    rows = fetched;
    render();
  } catch (e) {
    xpAlert(e.message, { title: "불러오기 실패", tone: "error", symbol: "✕" });
  }
}

/* ─────────────────────────── 이벤트 ─────────────────────────── */

$("tabs").addEventListener("click", (ev) => {
  const tab = ev.target.closest(".tab");
  if (!tab) return;
  for (const t of document.querySelectorAll(".tab")) {
    t.classList.toggle("active", t === tab);
  }
  filter = tab.dataset.filter;
  render();
});

$("list").addEventListener("click", (ev) => {
  const btn = ev.target.closest(".rec-save");
  if (btn) save(btn.closest(".rec-card"));
});

// Enter 로도 저장할 수 있게 합니다.
$("list").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && ev.target.matches("input[data-key]")) {
    ev.preventDefault();
    save(ev.target.closest(".rec-card"));
  }
});

$("leagueFilter").addEventListener("change", render);
$("search").addEventListener("input", render);
$("refreshBtn").addEventListener("click", load);
$("closeBtn").addEventListener("click", () => (location.href = "index.html"));

load();
