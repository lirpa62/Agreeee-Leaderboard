/**
 * 새 기록 배지 + 순위 항목 우클릭 메뉴
 *
 * data.js 항목에 addedAt / channelUrl / clipUrl / vodUrl 이 있을 때만 동작합니다.
 * 네이버 폼으로 받던 시절의 기존 기록에는 이 필드들이 없으므로,
 * 배지도 메뉴 항목도 자연스럽게 나타나지 않습니다.
 */

/** 이 시간 안에 등록된 기록에 'NEW' 배지를 붙입니다. */
const NEW_BADGE_MS = 6 * 60 * 60 * 1000;

/* ────────────────────────────── NEW 배지 ────────────────────────────── */

function isNewRecord(item) {
  if (!item || !item.addedAt) return false;
  const t = Date.parse(item.addedAt);
  if (Number.isNaN(t)) return false;
  const age = Date.now() - t;
  // 미래 시각(시계 오차/타임존 실수)은 새 기록으로 치지 않습니다.
  return age >= 0 && age < NEW_BADGE_MS;
}

/** 배지 HTML. 배지가 필요 없으면 빈 문자열이라 그대로 이어붙일 수 있습니다. */
function newBadgeHtml(item) {
  if (!isNewRecord(item)) return "";
  const when = new Date(item.addedAt).toLocaleString("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return ` <span class="new-badge" title="${when} 등록">NEW</span>`;
}

/**
 * 배지는 시간이 지나면 사라져야 하므로 주기적으로 다시 확인합니다.
 * 6시간 배지에 1분 간격이면 충분하고, 탭이 숨겨져 있으면 건너뜁니다.
 */
function startBadgeExpiry(rerender) {
  if (typeof rerender !== "function") return;
  setInterval(() => {
    if (document.hidden) return;
    const shown = document.querySelectorAll(".new-badge").length;
    if (shown === 0) return;
    // 하나라도 만료됐다면 다시 그립니다.
    rerender();
  }, 60 * 1000);
}

/* ──────────────────────────── 우클릭 메뉴 ──────────────────────────── */

let menuEl = null;

function ensureMenu() {
  if (menuEl) return menuEl;
  menuEl = document.createElement("div");
  menuEl.className = "xp-context-menu";
  menuEl.setAttribute("role", "menu");
  menuEl.hidden = true;
  document.body.appendChild(menuEl);
  return menuEl;
}

function closeMenu() {
  if (menuEl) menuEl.hidden = true;
}

/**
 * 화면 밖으로 나가지 않게 위치를 보정합니다.
 * XP 처럼 오른쪽/아래 공간이 부족하면 커서 반대쪽으로 폅니다.
 */
function placeMenu(el, x, y) {
  el.hidden = false;
  const { offsetWidth: w, offsetHeight: h } = el;
  const maxX = window.innerWidth - w - 4;
  const maxY = window.innerHeight - h - 4;
  const left = x > maxX ? Math.max(4, x - w) : Math.max(4, Math.min(x, maxX));
  const top = y > maxY ? Math.max(4, y - h) : Math.max(4, Math.min(y, maxY));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function openMenu(x, y, item) {
  const el = ensureMenu();

  const entries = [
    { label: "치지직 채널 열기", url: item.channelUrl, icon: "📺" },
    { label: "제출한 클립 보기", url: item.clipUrl, icon: "🎬" },
    { label: "제출한 다시보기 보기", url: item.vodUrl, icon: "📼" },
  ];

  // 링크가 하나도 없는 기록(기존 209건)은 메뉴를 띄우지 않고
  // 브라우저 기본 메뉴를 그대로 쓰게 둡니다.
  if (!entries.some((e) => e.url)) return false;

  const rows = entries
    .map((e) => {
      // XP 는 쓸 수 없는 메뉴를 숨기지 않고 회색으로 남겨 둡니다.
      const disabled = e.url ? "" : " disabled";
      return (
        `<button type="button" class="xp-menu-item${disabled}" role="menuitem"` +
        (e.url ? ` data-url="${encodeURI(e.url)}"` : " disabled") +
        `><span class="xp-menu-icon">${e.icon}</span>${e.label}</button>`
      );
    })
    .join("");

  el.innerHTML =
    `<div class="xp-menu-title">${escapeHtml(item.name)}</div>` +
    `<div class="xp-menu-sep"></div>` +
    rows;

  placeMenu(el, x, y);
  return true;
}

function escapeHtml(s) {
  return String(s).replace(
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

/**
 * 순위 목록에 우클릭 메뉴를 붙입니다.
 *
 * 목록은 다시 그려질 때마다 li 가 교체되므로, 개별 항목이 아니라
 * 컨테이너에 위임해 한 번만 등록합니다.
 *
 * @param {string} containerId  목록 <ul> 의 id
 * @param {(li: HTMLElement) => object|null} resolve  li → 데이터 항목
 */
function attachContextMenu(containerId, resolve) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.addEventListener("contextmenu", (ev) => {
    const li = ev.target.closest("li");
    if (!li || !container.contains(li)) return;
    const item = resolve(li);
    if (!item) return;
    if (openMenu(ev.clientX, ev.clientY, item)) {
      ev.preventDefault();
    }
  });
}

/* 메뉴 닫기 / 실행 — 한 번만 등록합니다. */
function initContextMenu() {
  ensureMenu();

  menuEl.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".xp-menu-item");
    if (!btn || btn.disabled) return;
    const url = btn.dataset.url;
    closeMenu();
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  });

  // 메뉴 안에서의 우클릭은 메뉴를 유지합니다.
  menuEl.addEventListener("contextmenu", (ev) => ev.stopPropagation());

  document.addEventListener("mousedown", (ev) => {
    if (menuEl && !menuEl.hidden && !menuEl.contains(ev.target)) closeMenu();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeMenu();
  });
  // 스크롤·리사이즈 시 메뉴가 엉뚱한 곳에 남지 않도록 닫습니다.
  window.addEventListener("scroll", closeMenu, true);
  window.addEventListener("resize", closeMenu);
  window.addEventListener("blur", closeMenu);
}
