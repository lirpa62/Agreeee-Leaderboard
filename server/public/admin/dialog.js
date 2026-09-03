/**
 * XP 스타일 대화상자
 *
 * 브라우저 기본 alert/confirm/prompt 는 OS 크롬이 그대로 드러나
 * XP 연출이 깨지므로 직접 구현합니다.
 *
 * 모두 Promise 를 돌려주므로 await 로 쓸 수 있습니다.
 *   await xpAlert("저장했습니다.");
 *   if (await xpConfirm("삭제할까요?")) { ... }
 *   const pick = await xpChoose("사유는?", [{value:"a",label:"A"}, ...]);
 */

(function () {
  let overlay = null;
  let lastFocused = null;

  function build() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.className = "xp-dialog-overlay";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="xp-dialog" role="alertdialog" aria-modal="true"
           aria-labelledby="xpDlgTitle" aria-describedby="xpDlgMsg">
        <div class="xp-titlebar">
          <span class="xp-titlebar-icon" id="xpDlgIcon">📋</span>
          <span class="xp-titlebar-text" id="xpDlgTitle">알림</span>
          <span class="xp-btns">
            <button type="button" class="xp-btn close" id="xpDlgX"
                    title="닫기" aria-label="닫기">✕</button>
          </span>
        </div>
        <div class="xp-dialog-body">
          <span class="xp-dialog-icon" id="xpDlgSymbol">!</span>
          <p class="xp-dialog-msg" id="xpDlgMsg"></p>
        </div>
        <div class="xp-dialog-footer" id="xpDlgFooter"></div>
      </div>`;
    document.body.appendChild(overlay);
  }

  function close(resolve, value) {
    overlay.hidden = true;
    document.removeEventListener("keydown", overlay._onKey, true);
    if (lastFocused && typeof lastFocused.focus === "function") {
      lastFocused.focus();
    }
    lastFocused = null;
    resolve(value);
  }

  /**
   * @param {object} opts
   *   title    창 제목
   *   message  본문 (줄바꿈은 그대로 표시됨)
   *   symbol   아이콘 문자 ('!' 경고 / 'i' 정보 / '?' 질문)
   *   tone     'info' | 'warn' | 'danger'
   *   buttons  [{ value, label, kind }]  kind: 'primary'|'danger'|undefined
   *   cancelValue  X·Esc·바깥 클릭 시 돌려줄 값
   */
  function open(opts) {
    build();
    return new Promise((resolve) => {
      lastFocused = document.activeElement;

      const dlg = overlay.querySelector(".xp-dialog");
      dlg.className = `xp-dialog tone-${opts.tone || "info"}`;

      overlay.querySelector("#xpDlgTitle").textContent =
        opts.title || "이용약관에 동의하고 싶어";
      overlay.querySelector("#xpDlgIcon").textContent = opts.icon || "📋";
      overlay.querySelector("#xpDlgSymbol").textContent = opts.symbol || "!";
      // textContent 로 넣어 HTML 주입을 막습니다. 줄바꿈은 CSS 가 처리합니다.
      overlay.querySelector("#xpDlgMsg").textContent = opts.message || "";

      const footer = overlay.querySelector("#xpDlgFooter");
      footer.innerHTML = "";
      const buttons = opts.buttons || [{ value: true, label: "확인" }];

      buttons.forEach((b, i) => {
        const el = document.createElement("button");
        el.type = "button";
        el.className = `xp-button${b.kind ? " " + b.kind : ""}`;
        el.textContent = b.label;
        el.addEventListener("click", () => close(resolve, b.value));
        footer.appendChild(el);
        if (i === buttons.length - 1) setTimeout(() => el.focus(), 0);
      });

      const cancelValue =
        "cancelValue" in opts ? opts.cancelValue : false;

      overlay.querySelector("#xpDlgX").onclick = () =>
        close(resolve, cancelValue);
      overlay.onmousedown = (e) => {
        if (e.target === overlay) close(resolve, cancelValue);
      };

      overlay._onKey = (e) => {
        if (overlay.hidden) return;
        if (e.key === "Escape") {
          e.preventDefault();
          close(resolve, cancelValue);
        }
      };
      document.addEventListener("keydown", overlay._onKey, true);

      overlay.hidden = false;
    });
  }

  /** 알림 — 확인 버튼 하나 */
  window.xpAlert = (message, opts = {}) =>
    open({
      symbol: "!",
      tone: "info",
      ...opts,
      message,
      buttons: [{ value: true, label: "확인", kind: "primary" }],
      cancelValue: true,
    });

  /** 확인 — 예/아니오 */
  window.xpConfirm = (message, opts = {}) =>
    open({
      symbol: "?",
      tone: "warn",
      ...opts,
      message,
      buttons: [
        { value: false, label: "취소" },
        {
          value: true,
          label: opts.okLabel || "확인",
          kind: opts.danger ? "danger" : "primary",
        },
      ],
      cancelValue: false,
    });

  /** 선택 — 버튼으로 고르기 (prompt 대체) */
  window.xpChoose = (message, choices, opts = {}) =>
    open({
      symbol: "?",
      tone: "warn",
      ...opts,
      message,
      buttons: [{ value: null, label: "취소" }, ...choices],
      cancelValue: null,
    });
})();
