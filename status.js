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

const STATUS_TEXT = {
  pending: {
    label: "검토 대기",
    cls: "pending",
    msg: "관리자가 증빙(클립·다시보기)을 확인하고 있습니다. 확인 후 리더보드에 반영됩니다.",
  },
  approved: {
    label: "승인 완료",
    cls: "approved",
    msg: "리더보드에 반영되었습니다. 반영까지 몇 분 정도 걸릴 수 있습니다.",
  },
  rejected: {
    label: "반려",
    cls: "rejected",
    msg: "등록되지 않았습니다.",
  },
};

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
    const info = STATUS_TEXT[r.status] || STATUS_TEXT.pending;

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

$("lookupForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const id = Number($("idInput").value);
  if (!Number.isInteger(id) || id < 1) {
    showError("접수 번호를 올바르게 입력해 주세요.");
    return;
  }
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
