/* 관리자 검토 화면 */

let currentStatus = "pending";

const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");

function esc(value) {
  return String(value ?? "").replace(
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

function leagueOf(row) {
  if (row.kind === "speedrun") return "⚡ 스피드런";
  if (row.is_shortcut) return "🎈 풍선 숏컷";
  if (row.is_retry) return "📜 재도전 인정";
  if (row.is_casual) return "⚠️ 캐주얼 모드";
  return "🏆 명예의 전당";
}

/**
 * 제출 이름과 조회된 채널명이 실질적으로 다른지 판정.
 * 서버의 compareNames 와 같은 규칙을 씁니다.
 * (접미사·공백·대소문자를 무시하고, 포함 관계면 표기 차이로 봄)
 */
function nameMismatch(row) {
  if (!row.channel_name) return false;
  const norm = (s) =>
    String(s || "")
      .replace(/\*/g, "")
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "")
      .replace(/\s+/g, "")
      .trim()
      .toLocaleLowerCase("ko-KR");
  const a = norm(row.streamer_name);
  const b = norm(row.channel_name);
  if (!b || a === b) return false;
  return !(a.includes(b) || b.includes(a));
}

function verdictOf(row) {
  // 서버가 저장해 둔 판정 문구에서 등급을 추정
  const note = row.verify_note || "";
  if (row.verify_status !== "exact") return { cls: "review", text: "확인 필요" };
  if (note.includes("충족")) return { cls: "pass", text: "기준 충족" };
  if (note.includes("미달")) return { cls: "fail", text: "기준 미달" };
  return { cls: "review", text: "확인 필요" };
}

function linkOr(url, label) {
  if (!url) return '<span style="color:#999">없음</span>';
  return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label || url)}</a>`;
}

function cardHtml(row) {
  const v = verdictOf(row);
  const follower =
    row.follower_count == null
      ? "조회 실패"
      : `${Number(row.follower_count).toLocaleString()}명`;

  const isPending = row.status === "pending";

  return `
  <div class="card ${esc(row.status)}" data-id="${row.id}">
    <div class="card-head">
      <span class="card-id">#${row.id}</span>
      <span>${esc(row.streamer_name)}</span>
      <span class="league">${esc(leagueOf(row))}</span>
    </div>
    <div class="card-body">
      <div class="field"><span class="k">클리어 회차</span><span class="v">${esc(row.game_time)}</span></div>
      <div class="field"><span class="k">이용약관</span><span class="v">${esc(row.tos_time || "—")}</span></div>
      <div class="field"><span class="k">채널</span><span class="v">${esc(row.channel_name || "확정 못함")}${
        nameMismatch(row)
          ? ` <span class="verdict fail">이름 불일치</span>`
          : ""
      }</span></div>
      <div class="field"><span class="k">팔로워</span><span class="v">${esc(follower)}
        <span class="verdict ${v.cls}">${v.text}</span></span></div>
      <div class="field full"><span class="k">검증 메모</span><span class="v">${esc(row.verify_note || "—")}</span></div>
      <div class="field"><span class="k">클립</span><span class="v">${linkOr(row.clip_url, "클립 열기")}</span></div>
      <div class="field"><span class="k">다시보기</span><span class="v">${linkOr(row.vod_url, "다시보기 열기")}</span></div>
      <div class="field"><span class="k">채널 주소</span><span class="v">${linkOr(row.channel_url)}</span></div>
      <div class="field"><span class="k">색상</span><span class="v">${
        row.color
          ? `<span style="display:inline-block;width:12px;height:12px;background:${esc(row.color)};border:1px solid #999;vertical-align:-2px"></span> ${esc(row.color)}`
          : "—"
      }</span></div>
      <div class="field"><span class="k">제출 시각</span><span class="v">${esc(row.created_at)}</span></div>
      ${
        row.admin_note
          ? `<div class="field full"><span class="k">관리자 메모</span><span class="v">${esc(row.admin_note)}</span></div>`
          : ""
      }
    </div>
    <div class="card-actions">
      ${
        isPending
          ? `<div class="approve-row">
               <label class="approve-field">
                 <span>등록될 이름</span>
                 <input class="xp-input reg-name" value="${esc(row.streamer_name)}"
                        placeholder="등록될 이름" />
               </label>
               ${
                 row.is_shortcut
                   ? `<label class="approve-check" title="재도전 기록도 함께 등록되는 경우에만 체크하세요">
                        <input type="checkbox" class="has-retry" /> 재도전도 있음 (🎈 표시)
                      </label>`
                   : ""
               }
               ${
                 row.is_retry
                   ? `<span class="suffix-hint">재도전 리그 → 이름 뒤에 * 가 자동으로 붙습니다</span>`
                   : ""
               }
             </div>
             <div class="approve-row">
               <input class="xp-input note" placeholder="처리 메모 (선택)" />
               <button type="button" class="xp-button" data-act="recheck">팔로워 재조회</button>
               <button type="button" class="xp-button danger" data-act="reject">반려</button>
               <button type="button" class="xp-button primary" data-act="approve">승인 → 반영</button>
             </div>`
          : `<span class="status-tag">${row.status === "approved" ? "승인됨" : "반려됨"}${
              row.reviewed_at ? ` · ${esc(row.reviewed_at)}` : ""
            }${
              row.revert_reason
                ? ` (${row.revert_reason === "casual" ? "캐주얼 모드" : "오등록"})`
                : ""
            }</span>
             ${
               row.status === "approved"
                 ? `<button type="button" class="xp-button danger"
                      data-act="revert" style="margin-left:auto">승인 취소</button>`
                 : ""
             }`
      }
    </div>
  </div>`;
}

function flash(card, cls, text) {
  const old = card.querySelector(".msg");
  if (old) old.remove();
  const div = document.createElement("div");
  div.className = `msg ${cls}`;
  div.textContent = text;
  card.querySelector(".card-body").before(div);
}

async function load() {
  const res = await fetch(`/api/admin/submissions?status=${currentStatus}`);
  if (res.status === 401) {
    location.href = "/admin/login.html";
    return;
  }
  const json = await res.json();
  if (!json.ok) return;

  document.getElementById("cnt-pending").textContent = json.counts.pending || 0;
  document.getElementById("cnt-approved").textContent = json.counts.approved || 0;
  document.getElementById("cnt-rejected").textContent = json.counts.rejected || 0;

  listEl.innerHTML = json.rows.map(cardHtml).join("");
  emptyEl.hidden = json.rows.length > 0;
}

// 탭 전환
document.getElementById("tabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (!tab) return;
  document
    .querySelectorAll(".tab")
    .forEach((t) => t.classList.toggle("active", t === tab));
  currentStatus = tab.dataset.status;
  load();
});

document.getElementById("refreshBtn").addEventListener("click", load);

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await fetch("/api/admin/logout", { method: "POST" });
  location.href = "/admin/login.html";
});

// 카드 액션
listEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const card = btn.closest(".card");
  const id = card.dataset.id;
  const note = card.querySelector(".note")?.value || "";
  const act = btn.dataset.act;

  // 승인 시 실제로 등록될 이름(접미사 포함)을 미리 보여주고 확인받습니다.
  const regNameEl = card.querySelector(".reg-name");
  const hasRetryEl = card.querySelector(".has-retry");
  const regName = regNameEl ? regNameEl.value.trim() : "";
  const hasRetryToo = !!(hasRetryEl && hasRetryEl.checked);

  if (act === "approve") {
    if (!regName) {
      flash(card, "err", "등록될 이름을 입력해 주세요.");
      return;
    }
    const isRetry = card.querySelector(".league")?.textContent.includes("재도전");
    let preview = regName;
    if (isRetry && !preview.includes("*")) preview += "*";
    else if (hasRetryToo && !preview.includes("🎈")) preview += "🎈";

    if (!confirm(`data.js 에 다음 이름으로 등록합니다.\n\n    ${preview}\n\n계속할까요?`))
      return;
  }

  if (act === "reject") {
    if (!confirm(`제출 #${id} 을(를) 반려 처리할까요?`)) return;
  }

  // 승인 취소는 사유에 따라 후속 처리가 달라집니다.
  let revertReason = null;
  if (act === "revert") {
    const answer = prompt(
      `제출 #${id} 의 승인을 취소하고 data.js 에서 기록을 삭제합니다.\n\n` +
        `사유를 선택하세요.\n` +
        `  1 = 오등록 (단순 실수 — 완전 삭제)\n` +
        `  2 = 캐주얼 모드 확인 (하단 삭제 목록에 남김)\n\n` +
        `취소하려면 빈 칸으로 두고 확인을 누르세요.`,
      "1",
    );
    if (answer !== "1" && answer !== "2") return;
    revertReason = answer === "2" ? "casual" : "mistake";
  }

  btn.disabled = true;
  try {
    const res = await fetch(`/api/admin/submissions/${id}/${act}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        note,
        reason: revertReason,
        name: regName || undefined,
        hasRetryToo,
      }),
    });
    const json = await res.json();

    if (!json.ok) {
      flash(card, "err", json.error || "처리에 실패했습니다.");
      return;
    }

    if (act === "recheck") {
      const fc =
        json.channel?.followerCount != null
          ? `${json.channel.followerCount.toLocaleString()}명`
          : "조회 실패";
      flash(
        card,
        json.verdict === "fail" ? "err" : "ok",
        `재조회: ${json.channel?.channelName || "채널 확정 못함"} · ${fc} — ${json.note}`,
      );
      return;
    }

    const gitMsgOf = (g = {}) =>
      g.committed
        ? ` · 커밋 ${g.sha}${g.pushed ? " (푸시됨)" : ""}`
        : ` · ${g.reason || "커밋 안 함"}`;

    if (act === "approve") {
      const added = json.applied?.added?.name;
      alert(
        `data.js 에 반영했습니다.` +
          (added ? `\n등록된 이름: ${added}` : "") +
          gitMsgOf(json.git),
      );
    }

    if (act === "revert") {
      alert(
        `data.js 에서 기록을 삭제했습니다.${gitMsgOf(json.git)}` +
          (json.followUp ? `\n\n[후속 조치] ${json.followUp}` : ""),
      );
    }
    await load();
  } catch (err) {
    flash(card, "err", `오류: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
});

load();
