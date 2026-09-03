/* 제출 상태 조회 */

const API_BASE = (() => {
  const meta = document
    .querySelector('meta[name="api-base"]')
    ?.getAttribute("content")
    ?.trim();
  if (meta && !meta.startsWith("{{")) return meta.replace(/\/$/, "");
  return "http://localhost:3111";
})();

const $ = (id) => document.getElementById(id);

/**
 * 상태 문구.
 *
 * ⚠ '승인'과 '리더보드 반영'은 다른 단계입니다.
 *   승인 시에는 data.js 만 수정해 두고, 관리자가 모아서 '발행'해야
 *   실제 배포가 이뤄집니다. (Netlify 배포 크레딧을 아끼기 위함)
 *   그래서 승인됐지만 아직 발행되지 않은 상태를 따로 안내합니다.
 */
const STATUS_TEXT = {
  pending: {
    label: "검토 대기",
    cls: "pending",
    msg: "관리자가 증빙(클립·다시보기)을 확인하고 있습니다. 확인 후 리더보드에 반영됩니다.",
  },
  approved: {
    label: "승인 완료",
    cls: "approved",
    msg: "승인되었습니다. 리더보드 반영을 기다리고 있습니다.\n기록은 모아서 한 번에 반영되므로 시간이 걸릴 수 있습니다.",
  },
  published: {
    label: "반영 완료",
    cls: "approved",
    msg: "리더보드에 반영되었습니다. 확인해 보세요!",
  },
  rejected: {
    label: "반려",
    cls: "rejected",
    msg: "등록되지 않았습니다.",
  },
};

/** 실제 표시할 상태 키 (승인됐지만 미발행이면 'approved') */
function displayStatus(row) {
  if (row.status === "approved" && row.published_at) return "published";
  return row.status;
}

const REVERT_REASON = {
  casual: "캐주얼 모드 사용이 확인되어 기록이 삭제되었습니다.",
  mistake: "오등록으로 확인되어 기록이 삭제되었습니다.",
};

function leagueOf(row) {
  if (row.kind === "speedrun") return "⚡ 스피드런";
  if (row.is_shortcut) return "🎈 풍선 숏컷";
  if (row.is_retry) return "📜 재도전 인정";
  if (row.is_casual) return "⚠️ 캐주얼 모드";
  return "🏆 명예의 전당";
}

function showError(msg) {
  const box = $("errors");
  box.hidden = false;
  box.textContent = msg;
  $("result").hidden = true;
}

async function lookup(id) {
  $("errors").hidden = true;
  try {
    const res = await fetch(`${API_BASE}/api/submissions/${id}/status`);
    const json = await res.json();

    if (!json.ok) {
      showError(json.error || "조회에 실패했습니다.");
      return;
    }

    const r = json.submission;
    const info = STATUS_TEXT[displayStatus(r)] || STATUS_TEXT.pending;

    $("statusBadge").textContent = info.label;
    $("statusBadge").className = `status-badge ${info.cls}`;
    $("statusId").textContent = `접수 번호 #${r.id}`;
    $("rName").textContent = r.streamer_name;
    $("rLeague").textContent = leagueOf(r);
    $("rGame").textContent = r.game_time;

    if (r.tos_time) {
      $("rTos").textContent = r.tos_time;
      $("rTosRow").hidden = false;
    } else {
      $("rTosRow").hidden = true;
    }

    $("rCreated").textContent = r.created_at;
    if (r.reviewed_at) {
      $("rReviewed").textContent = r.reviewed_at;
      $("rReviewedRow").hidden = false;
    } else {
      $("rReviewedRow").hidden = true;
    }

    // 실제 리더보드에 반영된 시각 (발행 시점)
    if (r.published_at) {
      $("rPublished").textContent = r.published_at;
      $("rPublishedRow").hidden = false;
    } else {
      $("rPublishedRow").hidden = true;
    }

    // 승인 취소된 경우 사유를 함께 안내
    let msg = info.msg;
    if (r.status === "rejected" && r.revert_reason) {
      msg = REVERT_REASON[r.revert_reason] || msg;
    }
    $("statusMsg").textContent = msg;

    $("result").hidden = false;
  } catch {
    showError("조회 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
  }
}

/* 조회 방식 전환 (접수 번호 / 이름) */
let mode = "id";

$("lookupTabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (!tab) return;
  mode = tab.dataset.mode;
  document
    .querySelectorAll("#lookupTabs .tab")
    .forEach((t) => t.classList.toggle("active", t === tab));
  $("idField").hidden = mode !== "id";
  $("nameField").hidden = mode !== "name";
  $("errors").hidden = true;
  $("result").hidden = true;
  $("searchResults").hidden = true;
  (mode === "id" ? $("idInput") : $("nameInput")).focus();
});

/** 이름으로 대기 중인 제출 검색 */
async function searchByName(name) {
  $("errors").hidden = true;
  $("result").hidden = true;
  const list = $("searchResults");

  try {
    const res = await fetch(
      `${API_BASE}/api/submissions/search?name=${encodeURIComponent(name)}`,
    );
    const json = await res.json();

    if (!json.ok) {
      list.hidden = true;
      showError(json.error || "검색에 실패했습니다.");
      return;
    }
    if (!json.rows.length) {
      list.hidden = true;
      showError(`'${name}' 으로 등록된 제출을 찾지 못했습니다.`);
      return;
    }

    list.innerHTML = "";
    json.rows.forEach((r) => {
      const li = document.createElement("li");
      li.className = "search-item";
      li.tabIndex = 0;

      const num = document.createElement("span");
      num.className = "search-id";
      num.textContent = `#${r.id}`;

      const nm = document.createElement("span");
      nm.className = "search-name";
      nm.textContent = r.streamer_name;

      const lg = document.createElement("span");
      lg.className = "search-league";
      lg.textContent = leagueOf(r);

      const tm = document.createElement("span");
      tm.className = "search-time";
      tm.textContent = r.game_time;

      // 상태는 보여주되, 반려 사유는 접수 번호로만 확인할 수 있습니다.
      const info = STATUS_TEXT[displayStatus(r)] || STATUS_TEXT.pending;
      const st = document.createElement("span");
      st.className = `status-badge ${info.cls}`;
      st.textContent = info.label;

      li.append(num, nm, lg, tm, st);
      const open = () => {
        $("idInput").value = r.id;
        history.replaceState(null, "", `?id=${r.id}`);
        list.hidden = true;
        lookup(r.id);
      };
      li.addEventListener("click", open);
      li.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          open();
        }
      });
      list.appendChild(li);
    });
    list.hidden = false;
  } catch {
    list.hidden = true;
    showError("조회 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
  }
}

$("lookupForm").addEventListener("submit", (e) => {
  e.preventDefault();

  if (mode === "name") {
    const name = $("nameInput").value.trim();
    if (name.length < 2) {
      showError("스트리머 이름을 두 글자 이상 입력해 주세요.");
      return;
    }
    searchByName(name);
    return;
  }

  const id = Number($("idInput").value);
  if (!Number.isInteger(id) || id < 1) {
    showError("접수 번호를 올바르게 입력해 주세요.");
    return;
  }
  $("searchResults").hidden = true;
  // 주소창에 남겨 새로고침·공유가 가능하게
  history.replaceState(null, "", `?id=${id}`);
  lookup(id);
});

// ?id=12 로 들어오면 바로 조회
const initialId = new URLSearchParams(location.search).get("id");
if (initialId) {
  $("idInput").value = initialId;
  lookup(Number(initialId));
}
