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
               <label class="approve-field">
                 <span>클리어 회차</span>
                 <input class="xp-input reg-game" value="${esc(row.game_time)}"
                        placeholder="예) 14분 54.62초" />
               </label>
               ${
                 row.kind === "speedrun"
                   ? ""
                   : `<label class="approve-field">
                        <span>이용약관</span>
                        <input class="xp-input reg-tos" value="${esc(row.tos_time || "")}"
                               placeholder="예) 1시간 30분 54초" />
                      </label>`
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

/* ---------------------------------------------------------
   발행 (미발행 건들을 한 커밋으로 묶어 푸시)
   Netlify 는 배포 1회당 크레딧을 쓰므로, 승인마다 푸시하지 않고 모읍니다.
   --------------------------------------------------------- */
async function loadUnpublished() {
  const bar = document.getElementById("publishBar");
  const list = document.getElementById("publishList");
  try {
    const res = await fetch("/api/admin/unpublished");
    if (!res.ok) return;
    const json = await res.json();
    if (!json.ok || !json.rows.length) {
      bar.hidden = true;
      list.hidden = true;
      return;
    }

    const bar2 = bar;
    const btn = document.getElementById("publishBtn");

    // data.js 에 실제 변경이 없다면 이미 반영된 것입니다.
    // (수동 커밋 등) 이 경우 '발행'이 아니라 '정리'로 안내합니다.
    const stale = json.hasFileChanges === false;
    bar2.classList.toggle("stale", stale);

    if (stale) {
      document.getElementById("publishCount").textContent =
        `${json.rows.length}건`;
      document.getElementById("publishHint").textContent =
        "다만 data.js 에는 변경 사항이 없습니다. 이미 커밋되었을 가능성이 큽니다 — " +
        "'발행 완료로 정리'를 누르면 목록만 정리되고 배포는 실행되지 않습니다.";
      btn.textContent = "✔ 발행 완료로 정리";
    } else {
      document.getElementById("publishCount").textContent =
        `${json.rows.length}건`;
      document.getElementById("publishHint").textContent = json.autoPush
        ? "발행하면 커밋 후 자동으로 푸시됩니다."
        : "GIT_AUTO_PUSH 가 꺼져 있어 커밋만 됩니다. 서버에서 직접 push 해주세요.";
      btn.textContent = "🚀 발행하기";
    }

    list.innerHTML = json.rows
      .map(
        (r) =>
          `<li class="publish-item ${r.revert_reason ? "remove" : "add"}">
             <span class="publish-op">${r.revert_reason ? "삭제" : "추가"}</span>
             <span class="publish-name">${esc(r.streamer_name)}</span>
             <span class="publish-time">${esc(r.game_time)}</span>
             <span class="publish-id">#${r.id}</span>
           </li>`,
      )
      .join("");

    bar.hidden = false;
    list.hidden = false;
  } catch {
    /* 서버 오류 시 발행 UI 만 숨깁니다 */
  }
}

document.getElementById("publishBtn").addEventListener("click", async () => {
  const btn = document.getElementById("publishBtn");
  const n = document.getElementById("publishCount").textContent;
  const stale = document.getElementById("publishBar").classList.contains("stale");

  const msg = stale
    ? `data.js 에 변경 사항이 없어 배포는 실행되지 않습니다.\n\n` +
      `${n}을 발행 완료로 정리할까요?`
    : `${n}을 하나의 커밋으로 발행합니다.\n\n` +
      `Netlify 배포가 1회 실행됩니다. 계속할까요?`;
  if (!(await xpConfirm(msg, { title: "발행", okLabel: stale ? "정리" : "발행" })))
    return;

  btn.disabled = true;
  btn.textContent = "발행 중…";
  try {
    const res = await fetch("/api/admin/publish", { method: "POST" });
    const json = await res.json();
    if (!json.ok) {
      await xpAlert(`발행 실패: ${json.error}`, { title: "발행", tone: "danger" });
      return;
    }
    if (json.cleaned) {
      await xpAlert(
        `${json.message}\n\n${json.count}건을 발행 완료로 정리했습니다.`,
        { title: "정리 완료", symbol: "i" },
      );
    } else {
      await xpAlert(
        `발행했습니다. (${json.count}건)\n` +
          `커밋 ${json.sha}` +
          (json.pushed
            ? "\n푸시 완료 — Netlify 배포가 시작됩니다."
            : "\n푸시 안 함 — 서버에서 git push 해주세요."),
        { title: "발행 완료", symbol: "i" },
      );
    }
    await loadUnpublished();
    await load();
loadUnpublished();
  } catch (e) {
    await xpAlert(`발행 중 오류: ${e.message}`, { title: "발행", tone: "danger" });
  } finally {
    btn.disabled = false;
    // 버튼 문구는 loadUnpublished() 가 상태에 맞게 다시 설정합니다.
  }
});

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

// 목록을 새로 불러올 때 발행 대기 현황도 함께 갱신
document.getElementById("refreshBtn").addEventListener("click", loadUnpublished);

// 탭 전환
document.getElementById("tabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (!tab) return;
  document
    .querySelectorAll(".tab")
    .forEach((t) => t.classList.toggle("active", t === tab));
  currentStatus = tab.dataset.status;
  load();
loadUnpublished();
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

  // 관리자가 고칠 수 있는 시간 값
  const regGame = card.querySelector(".reg-game")?.value.trim() || "";
  const regTosEl = card.querySelector(".reg-tos");
  const regTos = regTosEl ? regTosEl.value.trim() : "";

  if (act === "approve") {
    if (!regName) {
      flash(card, "err", "등록될 이름을 입력해 주세요.");
      return;
    }
    if (!regGame) {
      flash(card, "err", "클리어 회차 시간을 입력해 주세요.");
      return;
    }
    if (regTosEl && !regTos) {
      flash(card, "err", "이용약관과 마주한 시간을 입력해 주세요.");
      return;
    }

    const isRetry = card.querySelector(".league")?.textContent.includes("재도전");
    let preview = regName;
    if (isRetry && !preview.includes("*")) preview += "*";
    else if (hasRetryToo && !preview.includes("🎈")) preview += "🎈";

    // 실제로 등록될 값을 모두 보여주고 확인받습니다.
    const go = await xpConfirm(
      `data.js 에 다음 값으로 등록합니다.\n\n` +
        `    이름  ${preview}\n` +
        `    회차  ${regGame}` +
        (regTosEl ? `\n    약관  ${regTos}` : "") +
        `\n\n계속할까요?`,
      { title: "승인", okLabel: "승인" },
    );
    if (!go) return;
  }

  if (act === "reject") {
    const go = await xpConfirm(`제출 #${id} 을(를) 반려 처리할까요?`, {
      title: "반려",
      okLabel: "반려",
      danger: true,
    });
    if (!go) return;
  }

  // 승인 취소는 사유에 따라 후속 처리가 달라집니다.
  let revertReason = null;
  if (act === "revert") {
    // 사유에 따라 후속 처리가 달라지므로 버튼으로 직접 고르게 합니다.
    revertReason = await xpChoose(
      `제출 #${id} 의 승인을 취소하고 data.js 에서 기록을 삭제합니다.\n\n` +
        `삭제 사유를 선택해 주세요.`,
      [
        { value: "mistake", label: "오등록 (완전 삭제)", kind: "danger" },
        { value: "casual", label: "캐주얼 모드 확인", kind: "danger" },
      ],
      { title: "승인 취소" },
    );
    if (!revertReason) return;
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
        gameTime: regGame || undefined,
        tosTime: regTosEl ? regTos : undefined,
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
      // 결과가 DB 에도 저장되므로 목록을 다시 불러와 배지·메모를 갱신합니다.
      await load();
      const fresh = document.querySelector(`.card[data-id="${id}"]`);
      if (fresh) {
        flash(
          fresh,
          json.verdict === "fail" ? "err" : "ok",
          `재조회 완료: ${json.channel?.channelName || "채널 확정 못함"} · ${fc} — ${json.note}`,
        );
      }
      return;
    }

    // 발행은 모아서 하므로, 아직 리더보드에 반영되지 않았음을 분명히 알립니다.
    const pendingMsg =
      json.unpublished > 0
        ? `\n\n아직 리더보드에 반영되지 않았습니다.\n` +
          `미발행 ${json.unpublished}건 — '발행하기'를 눌러야 배포됩니다.`
        : "";

    if (act === "approve") {
      const added = json.applied?.added?.name;
      await xpAlert(
        `data.js 에 반영했습니다.` +
          (added ? `\n등록된 이름: ${added}` : "") +
          pendingMsg,
        { title: "승인 완료", symbol: "i" },
      );
    }

    if (act === "revert") {
      await xpAlert(
        `data.js 에서 기록을 삭제했습니다.` +
          (json.followUp ? `\n\n[후속 조치] ${json.followUp}` : "") +
          pendingMsg,
        { title: "승인 취소 완료", symbol: "i" },
      );
    }
    await load();
loadUnpublished();
  } catch (err) {
    flash(card, "err", `오류: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
});

load();
loadUnpublished();
