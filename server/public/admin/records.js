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
            ${
              f.key === "channelUrl"
                ? `<button type="button" class="xp-button rec-verify"
                     title="치지직에서 채널을 조회해 이름과 팔로워를 대조합니다"
                     >채널 확인</button>`
                : ""
            }
          </label>`,
        ).join("")}
      </div>
      <div class="rec-verify-box" hidden></div>
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

/* ─────────────────────────── 채널 확인 ─────────────────────────── */

const num = (n) => (n == null ? "?" : Number(n).toLocaleString());

/** 확인 결과를 카드 안에 펼쳐 보여줍니다. */
function renderVerify(card, r) {
  const box = card.querySelector(".rec-verify-box");
  const chip = (c) =>
    `<button type="button" class="rec-cand" data-url="https://chzzk.naver.com/${
      c.channelId
    }">${escapeHtml(c.channelName)} <span>팔로워 ${num(
      c.followerCount,
    )}</span></button>`;

  // 주소가 비어 있던 경우 — 채워 넣을 후보를 제안합니다.
  if (!r.hadUrl) {
    if (r.status === "exact" && r.channel) {
      box.className = "rec-verify-box warn";
      box.innerHTML =
        `<p><strong>채널 주소가 비어 있습니다.</strong> 이름으로 찾은 채널입니다 — ` +
        `맞는지 확인이 필요합니다.</p>${chip(r.channel)}` +
        `<p class="rec-verify-note">${escapeHtml(r.note)}</p>`;
    } else if (r.candidates.length) {
      box.className = "rec-verify-box warn";
      box.innerHTML =
        `<p><strong>채널 주소가 비어 있습니다.</strong> 이름이 정확히 일치하는 채널을 ` +
        `찾지 못했습니다. 후보 중에서 확인이 필요합니다.</p>` +
        r.candidates.map(chip).join("");
    } else {
      box.className = "rec-verify-box err";
      box.innerHTML =
        `<p><strong>채널 주소가 비어 있습니다.</strong> ` +
        `'${escapeHtml(r.plainName)}' 으로는 채널을 찾지 못했습니다. ` +
        `직접 찾아 입력해 주세요.</p>`;
    }
    box.hidden = false;
    return;
  }

  // 주소가 있던 경우 — 그 채널이 이 기록의 주인이 맞는지 대조합니다.
  if (r.status !== "exact" || !r.channel) {
    box.className = "rec-verify-box err";
    box.innerHTML =
      `<p><strong>확인 필요</strong> — 입력된 주소로 채널을 조회하지 못했습니다. ` +
      `주소가 잘못되었거나 삭제된 채널일 수 있습니다.</p>`;
    box.hidden = false;
    return;
  }

  const okFollowers = r.verdict === "pass";
  const nameOk = r.nameMatch === "same" || r.nameMatch === "similar";
  const good = okFollowers && nameOk;

  const nameLine =
    r.nameMatch === "same"
      ? `이름 일치 — <strong>${escapeHtml(r.channel.channelName)}</strong>`
      : r.nameMatch === "similar"
        ? `이름 유사 — 기록 '<strong>${escapeHtml(r.plainName)}</strong>' ↔ ` +
          `채널 '<strong>${escapeHtml(r.channel.channelName)}</strong>' (표기 차이로 보입니다)`
        : `⚠️ <strong>이름 불일치</strong> — 기록 '${escapeHtml(r.plainName)}' ↔ ` +
          `채널 '${escapeHtml(r.channel.channelName)}' — 다른 사람의 주소일 수 있습니다`;

  box.className = `rec-verify-box ${good ? "ok" : "warn"}`;
  box.innerHTML =
    `<p>${good ? "✅ 확인됨" : "⚠️ 확인 필요"}</p>` +
    `<p class="rec-verify-note">${nameLine}</p>` +
    `<p class="rec-verify-note">${escapeHtml(r.note)}</p>`;
  box.hidden = false;
}

async function verify(card) {
  const btn = card.querySelector(".rec-verify");
  const box = card.querySelector(".rec-verify-box");
  const input = card.querySelector('input[data-key="channelUrl"]');

  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "조회 중…";
  box.hidden = true;

  try {
    const r = await api("/api/admin/records/verify", {
      method: "POST",
      body: JSON.stringify({
        arrayName: card.dataset.array,
        index: Number(card.dataset.index),
        // 저장 전 값으로도 확인할 수 있게 화면의 입력값을 보냅니다.
        channelUrl: input.value.trim(),
      }),
    });
    renderVerify(card, r);
  } catch (e) {
    box.className = "rec-verify-box err";
    box.innerHTML = `<p>${escapeHtml(e.message)}</p>`;
    box.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = original;
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
  const save_ = ev.target.closest(".rec-save");
  if (save_) return save(save_.closest(".rec-card"));

  const verify_ = ev.target.closest(".rec-verify");
  if (verify_) return verify(verify_.closest(".rec-card"));

  // 제안된 후보를 누르면 입력란에 채워 넣습니다. (저장은 따로 눌러야 합니다)
  const cand = ev.target.closest(".rec-cand");
  if (cand) {
    const card = cand.closest(".rec-card");
    card.querySelector('input[data-key="channelUrl"]').value = cand.dataset.url;
    const msg = card.querySelector(".rec-msg");
    msg.textContent = "채워 넣었습니다. 저장을 눌러 주세요.";
    msg.className = "rec-msg";
  }
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
