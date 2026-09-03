/**
 * XP Luna 스타일 페이지 전환 표시
 *
 * 같은 사이트 내 링크를 눌렀을 때, 다음 페이지가 그려지기 전까지
 * "잠시 기다려 주십시오" 창을 띄웁니다.
 *
 * 정적 사이트라 전환이 대개 아주 빠릅니다. 그래서 곧바로 띄우면
 * 오버레이가 번쩍이고 말아 오히려 거슬립니다.
 * DELAY_MS 이상 걸릴 때만 나타나게 해서, 느릴 때만 보이도록 합니다.
 */

(function () {
  const DELAY_MS = 150;

  let overlay = null;
  let showTimer = null;

  function injectStyles() {
    if (document.getElementById("page-transition-style")) return;
    const style = document.createElement("style");
    style.id = "page-transition-style";
    style.textContent = `
.pt-overlay {
  position: fixed;
  inset: 0;
  z-index: 20000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.25);
  font-family: "Tahoma", "Pretendard Variable", "Pretendard",
    -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.pt-overlay[hidden] { display: none; }

.pt-window {
  width: 300px;
  background: #ece9d8;
  border: 1px solid #0054e3;
  border-radius: 6px 6px 0 0;
  box-shadow: 3px 3px 12px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}

.pt-titlebar {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 6px;
  background: linear-gradient(180deg, #0058ee 0%, #3a93ff 48%, #0855dd 100%);
  color: #fff;
  font-size: 12px;
  font-weight: bold;
  text-shadow: 1px 1px 1px rgba(0, 0, 0, 0.45);
}

.pt-body {
  padding: 16px 16px 18px;
}

.pt-label {
  margin: 0 0 12px;
  font-size: 12px;
  color: #000;
}

/* XP 의 '블록이 흐르는' 진행 막대 — 진행률을 모를 때 쓰는 그 형태입니다. */
.pt-progress {
  height: 18px;
  padding: 2px;
  background: #fff;
  border: 1px solid #9a9a9a;
  box-shadow: inset 1px 1px 0 #dcdcdc;
  overflow: hidden;
}

.pt-blocks {
  display: flex;
  gap: 2px;
  height: 100%;
  width: 40%;
  animation: pt-slide 1.1s linear infinite;
}

.pt-blocks span {
  flex: 1 1 auto;
  background: linear-gradient(180deg, #6fd66f 0%, #2eaa2e 50%, #1c8a1c 100%);
}

@keyframes pt-slide {
  from { transform: translateX(-105%); }
  to   { transform: translateX(355%); }
}

@media (prefers-reduced-motion: reduce) {
  .pt-blocks { animation-duration: 2.2s; }
}
`;
    document.head.appendChild(style);
  }

  function build() {
    if (overlay) return overlay;
    injectStyles();
    overlay = document.createElement("div");
    overlay.className = "pt-overlay";
    overlay.hidden = true;
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    overlay.innerHTML = `
      <div class="pt-window">
        <div class="pt-titlebar"><span>⏳</span><span class="pt-title">이동 중…</span></div>
        <div class="pt-body">
          <p class="pt-label">잠시 기다려 주십시오…</p>
          <div class="pt-progress">
            <div class="pt-blocks">
              <span></span><span></span><span></span><span></span><span></span>
            </div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  function show(title) {
    const el = build();
    if (title) el.querySelector(".pt-title").textContent = title;
    el.hidden = false;
  }

  function hide() {
    clearTimeout(showTimer);
    showTimer = null;
    if (overlay) overlay.hidden = true;
  }

  /** 링크 텍스트에서 창 제목을 뽑아 XP 창처럼 보이게 합니다. */
  function titleFor(a) {
    const t = (a.textContent || "").replace(/\s+/g, " ").trim();
    return t ? t.replace(/^[^\w가-힣]+/, "").trim() || "이동 중…" : "이동 중…";
  }

  function isPlainLeftClick(ev) {
    return (
      ev.button === 0 &&
      !ev.metaKey &&
      !ev.ctrlKey &&
      !ev.shiftKey &&
      !ev.altKey &&
      !ev.defaultPrevented
    );
  }

  document.addEventListener("click", (ev) => {
    const a = ev.target.closest("a[href]");
    if (!a || !isPlainLeftClick(ev)) return;

    // 새 탭·다운로드·앵커·외부 링크는 페이지가 바뀌지 않으므로 제외합니다.
    if (a.target && a.target !== "_self") return;
    if (a.hasAttribute("download")) return;

    const href = a.getAttribute("href");
    if (!href || href.startsWith("#")) return;

    let url;
    try {
      url = new URL(href, location.href);
    } catch {
      return;
    }
    if (url.origin !== location.origin) return;
    if (!/^https?:$/.test(url.protocol)) return;
    // 같은 문서 내 이동(해시만 다름)이면 표시하지 않습니다.
    if (
      url.pathname === location.pathname &&
      url.search === location.search &&
      url.hash
    ) {
      return;
    }

    // 빠르게 넘어가면 굳이 보여주지 않습니다.
    const title = titleFor(a);
    clearTimeout(showTimer);
    showTimer = setTimeout(() => show(title), DELAY_MS);
  });

  // 폼 제출(제출 상태 조회 등)도 페이지 이동이면 동일하게 처리합니다.
  document.addEventListener("submit", (ev) => {
    const form = ev.target;
    if (!(form instanceof HTMLFormElement) || ev.defaultPrevented) return;
    // JS 로 처리하는 폼은 defaultPrevented 이므로 여기 오지 않습니다.
    if (form.target && form.target !== "_self") return;
    clearTimeout(showTimer);
    showTimer = setTimeout(() => show("처리 중…"), DELAY_MS);
  });

  // 뒤로 가기로 돌아왔을 때(bfcache 복원 포함) 오버레이가 남지 않게 합니다.
  window.addEventListener("pageshow", hide);
  window.addEventListener("pagehide", hide);
})();
