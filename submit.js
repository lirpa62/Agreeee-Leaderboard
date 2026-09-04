/* 기록 등록 요청 폼 */

/**
 * 제출 서버 주소.
 * 배포 시에는 이 파일을 고치지 말고 submit.html 의
 *   <meta name="api-base" content="https://api.example.com" />
 * 만 바꾸면 됩니다. (없으면 로컬 개발 주소를 씁니다)
 */
const API_BASE = (() => {
  const meta = document
    .querySelector('meta[name="api-base"]')
    ?.getAttribute("content")
    ?.trim();
  if (meta && !meta.startsWith("{{")) return meta.replace(/\/$/, "");
  return "http://localhost:3111";
})();

const $ = (id) => document.getElementById(id);

/* ---------------------------------------------------------
   XP 스타일 알림 대화상자
   브라우저 기본 alert 는 OS 크롬이 그대로 드러나 XP 연출이 깨지므로
   리더보드와 같은 모양의 모달을 씁니다.
   --------------------------------------------------------- */
let modalLastFocused = null;

function closeXpModal() {
  $("xpModalOverlay").hidden = true;
  if (modalLastFocused && typeof modalLastFocused.focus === "function") {
    modalLastFocused.focus();
  }
  modalLastFocused = null;
}

/**
 * @param {string} message  본문 (줄바꿈은 CSS 가 유지)
 * @param {object} opts     { title, icon, symbol }
 */
function xpModal(message, opts = {}) {
  const overlay = $("xpModalOverlay");
  modalLastFocused = document.activeElement;

  $("xpModalTitle").textContent = opts.title || "이용약관에 동의하고 싶어";
  $("xpModalIcon").textContent = opts.symbol || "!";
  $("xpModalMsg").textContent = message;

  overlay.hidden = false;
  $("xpModalOk").focus();
}

$("xpModalOk").addEventListener("click", closeXpModal);
$("xpModalX").addEventListener("click", closeXpModal);
$("xpModalOverlay").addEventListener("mousedown", (e) => {
  if (e.target === $("xpModalOverlay")) closeXpModal();
});
document.addEventListener("keydown", (e) => {
  if ($("xpModalOverlay").hidden) return;
  if (e.key === "Escape" || e.key === "Enter") {
    e.preventDefault();
    closeXpModal();
  }
});

/* ---------------------------------------------------------
   캡차 (Cloudflare Turnstile)
   서버가 켜져 있다고 알려줄 때만 위젯을 띄웁니다.
   --------------------------------------------------------- */
let captchaWidgetId = null;
let captchaEnabled = false;

function loadTurnstileScript() {
  return new Promise((resolve, reject) => {
    if (window.turnstile) return resolve();
    const s = document.createElement("script");
    s.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Turnstile 로드 실패"));
    document.head.appendChild(s);
  });
}

async function initCaptcha() {
  try {
    const res = await fetch(`${API_BASE}/api/config`);
    const json = await res.json();
    const cfg = json?.captcha;
    if (!cfg?.enabled || !cfg.siteKey) return; // 서버에서 꺼져 있으면 표시하지 않음

    await loadTurnstileScript();
    $("captchaRow").hidden = false;
    captchaWidgetId = window.turnstile.render("#captchaWidget", {
      sitekey: cfg.siteKey,
      language: "ko",
      // 만료되면 토큰을 비워 다시 인증하게 합니다.
      "expired-callback": () => window.turnstile.reset(captchaWidgetId),
    });
    captchaEnabled = true;
  } catch {
    // 캡차를 띄우지 못해도 폼은 쓸 수 있게 둡니다.
    // (서버가 캡차를 요구하면 제출 시 오류로 안내됩니다)
  }
}

function getCaptchaToken() {
  if (!captchaEnabled || !window.turnstile) return "";
  return window.turnstile.getResponse(captchaWidgetId) || "";
}

function resetCaptcha() {
  if (captchaEnabled && window.turnstile) {
    window.turnstile.reset(captchaWidgetId);
  }
}

initCaptcha();

/* 리그에 따라 약관 시간 / 체크박스 표시 전환 */
function syncKind() {
  const kind = document.querySelector('input[name="kind"]:checked').value;
  const isSpeedrun = kind === "speedrun";
  // 스피드런은 '클리어 회차 시간'만 받습니다.
  $("tosField").hidden = isSpeedrun;
  $("recordOnlyChecks").hidden = isSpeedrun;
}
document
  .querySelectorAll('input[name="kind"]')
  .forEach((el) => el.addEventListener("change", syncKind));

// ?kind=speedrun 으로 들어오면 스피드런이 선택된 채로 시작
const initialKind = new URLSearchParams(location.search).get("kind");
if (initialKind === "speedrun") {
  const el = document.querySelector('input[name="kind"][value="speedrun"]');
  if (el) el.checked = true;
}
syncKind();

/* ---------------------------------------------------------
   리그 선택 체크박스는 하나만 고를 수 있습니다.
   숏컷 / 재도전 / 캐주얼은 서로 다른 리그로 나뉘어(arrayNameFor)
   동시에 성립할 수 없습니다. 둘째를 고르면 안내하고 되돌립니다.
   --------------------------------------------------------- */
const LEAGUE_LABELS = {
  isShortcut: "풍선 숏컷 사용",
  isRetry: "노풍선 재도전",
  isCasual: "캐주얼 모드",
};

document.querySelectorAll("#recordOnlyChecks input[data-league]").forEach((el) => {
  el.addEventListener("change", () => {
    if (!el.checked) return;

    const others = [...document.querySelectorAll("#recordOnlyChecks input[data-league]")]
      .filter((o) => o !== el && o.checked);
    if (!others.length) return;

    // 이미 고른 항목이 있으면 방금 누른 것을 되돌립니다.
    el.checked = false;
    const already = LEAGUE_LABELS[others[0].id] || "다른 항목";
    const tried = LEAGUE_LABELS[el.id] || "이 항목";

    xpModal(
      `이미 '${already}'을(를) 선택하셨습니다.\n\n` +
        `'${tried}'와(과) 동시에 성립할 수 없습니다.\n` +
        `각 항목은 서로 다른 리그로 등재되기 때문입니다.\n\n` +
        `(제 3 조에 의거하여 인정협회는 중복 선택을 인정하지 않습니다)`,
      { title: "인정협회", symbol: "!" },
    );
  });
});

/* 색상 입력과 색상 선택기 연동 */
$("colorPicker").addEventListener("input", (e) => {
  $("color").value = e.target.value.toUpperCase();
});
$("color").addEventListener("input", (e) => {
  const v = e.target.value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) $("colorPicker").value = v;
});

/* ---------------------------------------------------------
   스트리머 이름 자동 추천
   이미 등록된 스트리머면 채널 주소·색상까지 함께 채워 줍니다.
   (재등록·갱신이 잦은데 매번 채널 주소를 찾아 붙이는 건 번거롭습니다)
   --------------------------------------------------------- */
const LEAGUE_TAG = {
  RECORD_DATA: "명예의 전당",
  RETRY_DATA: "재도전",
  SHORTCUT_DATA: "풍선 숏컷",
  SPEEDRUN_DATA: "스피드런",
};

let suggestRows = [];
let suggestIndex = -1;
let suggestTimer = null;
// 응답이 순서 없이 도착할 수 있어 마지막 요청만 반영합니다.
let suggestSeq = 0;

function closeSuggest() {
  $("nameSuggest").hidden = true;
  $("streamerName").setAttribute("aria-expanded", "false");
  suggestIndex = -1;
}

function renderSuggest() {
  const list = $("nameSuggest");
  if (!suggestRows.length) {
    closeSuggest();
    return;
  }

  list.innerHTML = "";
  suggestRows.forEach((row, i) => {
    const li = document.createElement("li");
    li.className = "suggest-item" + (i === suggestIndex ? " active" : "");
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", i === suggestIndex ? "true" : "false");
    li.dataset.index = String(i);

    const dot = document.createElement("span");
    dot.className = "suggest-dot";
    dot.style.background = row.color || "#888";

    const name = document.createElement("span");
    name.className = "suggest-name";
    name.textContent = row.name;

    const tags = document.createElement("span");
    tags.className = "suggest-tags";
    tags.textContent = (row.leagues || [])
      .map((l) => LEAGUE_TAG[l] || l)
      .join(" · ");

    li.append(dot, name, tags);
    list.appendChild(li);
  });

  list.hidden = false;
  $("streamerName").setAttribute("aria-expanded", "true");
}

/** 고른 스트리머의 값으로 폼을 채웁니다. */
function applySuggestion(row) {
  $("streamerName").value = row.name;
  if (row.channelUrl) $("channelUrl").value = row.channelUrl;
  if (row.color) {
    $("color").value = row.color.toUpperCase();
    if (/^#[0-9a-f]{6}$/i.test(row.color)) $("colorPicker").value = row.color;
  }
  closeSuggest();

  // 무엇이 채워졌는지 알려 주어야 사용자가 확인할 수 있습니다.
  const filled = [row.channelUrl && "채널 주소", row.color && "이름 색상"]
    .filter(Boolean)
    .join(", ");
  const out = $("channelResult");
  if (filled) {
    // 받침에 따라 조사를 고릅니다. ('채널 주소를' / '이름 색상을')
    const last = filled.charCodeAt(filled.length - 1);
    const hasJong = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 > 0;
    out.textContent =
      `✅ ${row.name} — ${filled}${hasJong ? "을" : "를"} 채웠습니다. ` +
      `확인해 주세요.`;
    out.className = "channel-result ok";
  }
}

async function fetchSuggest(q) {
  const seq = ++suggestSeq;
  try {
    const res = await fetch(
      `${API_BASE}/api/streamers?q=${encodeURIComponent(q)}`,
    );
    const json = await res.json();
    if (seq !== suggestSeq) return; // 더 최근 입력이 있으면 버립니다.
    suggestRows = json.ok ? json.rows : [];
    suggestIndex = -1;
    renderSuggest();
  } catch {
    // 추천은 편의 기능이라, 실패해도 직접 입력하면 됩니다.
    suggestRows = [];
    closeSuggest();
  }
}

$("streamerName").addEventListener("input", () => {
  const q = $("streamerName").value.trim();
  clearTimeout(suggestTimer);
  if (q.length < 1) {
    suggestRows = [];
    closeSuggest();
    return;
  }
  // 타자마다 요청하지 않도록 잠시 기다립니다.
  suggestTimer = setTimeout(() => fetchSuggest(q), 180);
});

$("streamerName").addEventListener("keydown", (e) => {
  if ($("nameSuggest").hidden || !suggestRows.length) return;

  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const dir = e.key === "ArrowDown" ? 1 : -1;
    suggestIndex =
      (suggestIndex + dir + suggestRows.length) % suggestRows.length;
    renderSuggest();
  } else if (e.key === "Enter") {
    // 목록에서 고르는 중이면 제출로 넘어가지 않게 막습니다.
    if (suggestIndex >= 0) {
      e.preventDefault();
      applySuggestion(suggestRows[suggestIndex]);
    }
  } else if (e.key === "Escape") {
    closeSuggest();
  }
});

$("nameSuggest").addEventListener("mousedown", (e) => {
  // blur 보다 먼저 처리해야 클릭이 목록에 닿습니다.
  const li = e.target.closest(".suggest-item");
  if (!li) return;
  e.preventDefault();
  applySuggestion(suggestRows[Number(li.dataset.index)]);
});

$("streamerName").addEventListener("blur", () => {
  // 클릭 처리(mousedown)가 끝난 뒤 닫습니다.
  setTimeout(closeSuggest, 120);
});

/* 채널 확인 (제출 전 미리보기) */
$("checkChannelBtn").addEventListener("click", async () => {
  const out = $("channelResult");
  const url = $("channelUrl").value.trim();
  const name = $("streamerName").value.trim();
  if (!url && !name) {
    out.textContent = "채널 주소나 스트리머 이름을 먼저 입력해 주세요.";
    out.className = "channel-result warn";
    return;
  }
  out.textContent = "확인 중…";
  out.className = "channel-result";
  try {
    const params = new URLSearchParams();
    if (url) params.set("url", url);
    else params.set("name", name);
    const res = await fetch(`${API_BASE}/api/channel?${params}`);
    const json = await res.json();

    if (json.status === "exact" && json.channel) {
      const f = json.channel.followerCount;
      const followers =
        f != null ? `${f.toLocaleString()}명` : "확인 불가";

      // 입력한 이름과 조회된 채널명이 실질적으로 다르면 알려줍니다.
      // (표기 차이는 흔하므로 차단하지 않고 안내만 합니다)
      const norm = (s) =>
        String(s || "")
          .replace(/\*/g, "")
          .replace(
            /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu,
            "",
          )
          .replace(/\s+/g, "")
          .trim()
          .toLocaleLowerCase("ko-KR");
      const a = norm(name);
      const b = norm(json.channel.channelName);
      const mismatch = a && b && a !== b && !a.includes(b) && !b.includes(a);

      if (mismatch) {
        out.textContent =
          `⚠️ 입력하신 이름 '${name}' 과(와) 채널명 '${json.channel.channelName}' 이 다릅니다. ` +
          `(팔로워 ${followers}) — 채널이 맞다면 그대로 제출하셔도 됩니다.`;
        out.className = "channel-result warn";
      } else {
        out.textContent = `✅ ${json.channel.channelName} · 팔로워 ${followers}`;
        out.className = "channel-result ok";
      }
    } else if (json.candidates?.length) {
      out.textContent =
        `⚠️ 채널을 확정하지 못했습니다. 후보: ` +
        json.candidates
          .map(
            (c) =>
              `${c.channelName}(${c.followerCount != null ? c.followerCount.toLocaleString() : "?"})`,
          )
          .join(", ") +
        " — 채널 주소를 입력하시면 정확해집니다.";
      out.className = "channel-result warn";
    } else {
      out.textContent =
        "⚠️ 채널을 찾지 못했습니다. 채널 주소를 입력해 주세요. (제출은 가능합니다)";
      out.className = "channel-result warn";
    }
  } catch {
    out.textContent = "채널 확인 서버에 연결할 수 없습니다. (제출은 가능합니다)";
    out.className = "channel-result warn";
  }
});

/* ---------------------------------------------------------
   URL 검증 (서버와 같은 규칙 — 제출 전에 미리 알려줍니다)
   서버에서도 반드시 다시 검증합니다. 클라이언트 검사는 우회 가능합니다.
   --------------------------------------------------------- */
const CHZZK_HOSTS = ["chzzk.naver.com"];
const YOUTUBE_HOSTS = ["youtube.com", "youtu.be", "m.youtube.com"];

function hostOf(url) {
  try {
    return new URL(String(url).trim()).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function checkUrlField(inputId, errorId, hosts, hint, { required = false } = {}) {
  const el = $(inputId);
  const box = $(errorId);
  const url = el.value.trim();

  const fail = (msg) => {
    box.hidden = false;
    box.textContent = msg;
    return false;
  };
  const ok = () => {
    box.hidden = true;
    box.textContent = "";
    return true;
  };

  if (!url) return required ? fail("필수 항목입니다.") : ok();
  if (url.length > 500) return fail("주소가 너무 깁니다. (500자 이내)");

  let u;
  try {
    u = new URL(url);
  } catch {
    return fail("올바른 주소 형식이 아닙니다.");
  }
  // http/https 외의 스킴은 허용하지 않습니다.
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return fail("http(s):// 로 시작하는 주소여야 합니다.");
  }

  const host = hostOf(url);
  const matched = hosts.some((d) => host === d || host.endsWith(`.${d}`));
  if (!matched) return fail(hint);

  return ok();
}

/**
 * 세 URL 항목을 모두 검사합니다.
 * @returns {{ok: boolean, failed: {label: string, msg: string}[]}}
 */
function validateUrlFields() {
  const a = checkUrlField(
    "channelUrl",
    "channelUrlError",
    CHZZK_HOSTS,
    "치지직 채널 주소(chzzk.naver.com)만 입력할 수 있습니다.",
    { required: true },
  );
  const b = checkUrlField(
    "clipUrl",
    "clipUrlError",
    CHZZK_HOSTS,
    "치지직 클립 주소(chzzk.naver.com)만 입력할 수 있습니다.",
  );
  const c = checkUrlField(
    "vodUrl",
    "vodUrlError",
    [...CHZZK_HOSTS, ...YOUTUBE_HOSTS],
    "치지직 또는 유튜브 다시보기 주소만 입력할 수 있습니다.",
  );

  // 실패한 항목을 모아 대화상자에서 함께 안내합니다.
  const failed = [];
  const pick = (ok, label, errorId) => {
    if (!ok) failed.push({ label, msg: $(errorId).textContent });
  };
  pick(a, "치지직 채널 주소", "channelUrlError");
  pick(b, "클립 주소", "clipUrlError");
  pick(c, "다시보기 주소", "vodUrlError");

  return { ok: a && b && c, failed };
}

// 입력에서 벗어날 때 즉시 안내
["channelUrl", "clipUrl", "vodUrl"].forEach((id) =>
  $(id).addEventListener("blur", validateUrlFields),
);

function numOr0(id) {
  const v = parseFloat($(id).value);
  return Number.isFinite(v) ? v : 0;
}

/* ---------------------------------------------------------
   클리어 회차 시간 이상값 경고
   기존 기록 205건의 클리어 회차 시간은 최대 33분입니다.
   반면 약관 시간은 중앙값이 4시간이 넘습니다.
   즉 회차 시간에 1시간 이상이 들어오면 두 값을 바꿔 넣었을
   가능성이 높으므로, 제출을 막지 않고 확인만 요청합니다.
   --------------------------------------------------------- */
const GAME_TIME_MAX_MIN = 33; // 현재 등록된 최대값
const GAME_TIME_WARN_MIN = 60; // 이 값을 넘으면 경고

function gameTimeMinutes() {
  return numOr0("gameH") * 60 + numOr0("gameM") + numOr0("gameS") / 60;
}

function checkGameTime() {
  const box = $("gameTimeWarn");
  const mins = gameTimeMinutes();

  if (mins >= GAME_TIME_WARN_MIN) {
    box.hidden = false;
    box.innerHTML =
      `⚠️ <strong>입력하신 값이 맞는지 확인해 주세요.</strong><br />` +
      `클리어한 회차 시간이 <strong>${Math.floor(mins / 60)}시간 ${Math.round(mins % 60)}분</strong>으로 입력되었습니다. ` +
      `현재 등록된 기록 중 가장 긴 회차 시간은 <strong>${GAME_TIME_MAX_MIN}분</strong>입니다.<br />` +
      `혹시 <strong>'이용약관과 마주한 시간'</strong>을 잘못 입력하신 것은 아닌지 확인해 주세요.`;
    return "warn";
  }

  if (mins > GAME_TIME_MAX_MIN) {
    box.hidden = false;
    box.innerHTML =
      `ℹ️ 현재 등록된 최고 기록(${GAME_TIME_MAX_MIN}분)보다 긴 시간입니다. ` +
      `값이 맞다면 그대로 제출하셔도 됩니다.`;
    return "notice";
  }

  box.hidden = true;
  box.innerHTML = "";
  return "ok";
}

["gameH", "gameM", "gameS"].forEach((id) =>
  $(id).addEventListener("input", checkGameTime),
);

function showErrors(list) {
  const box = $("errors");
  if (!list || !list.length) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  box.hidden = false;
  box.innerHTML =
    "<strong>다음 항목을 확인해 주세요.</strong><ul>" +
    list.map((e) => `<li>${e.replace(/[<>&]/g, "")}</li>`).join("") +
    "</ul>";
  box.scrollIntoView({ behavior: "smooth", block: "center" });
}

$("submitForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("submitBtn");
  const kind = document.querySelector('input[name="kind"]:checked').value;

  // URL 형식·도메인 확인 (서버에서도 다시 검증합니다)
  const urlCheck = validateUrlFields();
  if (!urlCheck.ok) {
    xpModal(
      `입력하신 주소를 확인해 주세요.\n\n` +
        urlCheck.failed.map((f) => `· ${f.label}\n   ${f.msg}`).join("\n") +
        `\n\n(제 1 조에 의거하여 인정협회는 확인할 수 없는 증빙을 인정하지 않습니다)`,
      { title: "증빙 확인", symbol: "!" },
    );
    // 첫 번째 문제 항목으로 이동
    const first = document.querySelector(".field-error:not([hidden])");
    if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  // 회차 시간이 비정상적으로 길면 한 번 더 확인받습니다. (막지는 않습니다)
  if (checkGameTime() === "warn") {
    const m = gameTimeMinutes();
    const ok = confirm(
      `클리어한 회차 시간이 ${Math.floor(m / 60)}시간 ${Math.round(m % 60)}분으로 입력되었습니다.\n\n` +
        `현재 등록된 기록 중 가장 긴 회차 시간은 ${GAME_TIME_MAX_MIN}분입니다.\n` +
        `'이용약관과 마주한 시간'을 잘못 입력하신 것은 아닌가요?\n\n` +
        `이대로 제출하시겠습니까?`,
    );
    if (!ok) {
      $("gameH").focus();
      return;
    }
  }

  // 캡차가 켜져 있는데 아직 인증하지 않았으면 서버에 보내기 전에 안내
  if (captchaEnabled && !getCaptchaToken()) {
    showErrors(["캡차 인증을 완료해 주세요."]);
    return;
  }

  const payload = {
    kind,
    captchaToken: getCaptchaToken(),
    streamerName: $("streamerName").value.trim(),
    channelUrl: $("channelUrl").value.trim(),
    color: $("color").value.trim(),
    gameTime: {
      hours: numOr0("gameH"),
      minutes: numOr0("gameM"),
      seconds: numOr0("gameS"),
    },
    clipUrl: $("clipUrl").value.trim(),
    vodUrl: $("vodUrl").value.trim(),
  };

  if (kind === "record") {
    payload.tosTime = {
      hours: numOr0("tosH"),
      minutes: numOr0("tosM"),
      seconds: numOr0("tosS"),
    };
    payload.isShortcut = $("isShortcut").checked;
    payload.isRetry = $("isRetry").checked;
    payload.isCasual = $("isCasual").checked;
  }

  btn.disabled = true;
  btn.textContent = "제출 중…";
  showErrors(null);

  try {
    const res = await fetch(`${API_BASE}/api/submissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();

    if (!json.ok) {
      // Turnstile 토큰은 1회용이므로 실패 시 반드시 재발급받아야 합니다.
      resetCaptcha();

      // 스피드런은 갱신제라 기존보다 느린 기록은 접수되지 않습니다.
      // 목록에 묻히지 않도록 다이얼로그로 분명하게 알립니다.
      if (json.reason === "slower_than_best") {
        const same = json.submitted === json.best;
        // 스피드런에 올린 적이 없어도 명예의 전당 회차 시간이
        // 스피드런 순위에 함께 오릅니다. 그 경우를 설명해 줍니다.
        const where =
          json.source === "record"
            ? `\n(명예의 전당에 등록된 회차 시간이 스피드런 순위에 함께 반영됩니다)`
            : "";
        xpModal(
          (same
            ? `이미 등록된 기록과 같은 시간입니다.`
            : `이미 등록된 기록보다 느립니다.`) +
            `\n\n현재 기록 : ${json.best}${where}\n제출한 기록 : ${json.submitted}\n\n` +
            `스피드런은 기존 기록을 넘어설 때만 갱신됩니다.\n` +
            `더 빠른 기록으로 다시 도전해 주세요!`,
          { title: "갱신되지 않는 기록", symbol: "!" },
        );
        return;
      }

      showErrors(json.errors || [json.error || "제출에 실패했습니다."]);
      return;
    }

    // 완료 화면
    $("submitForm").hidden = true;
    $("done").hidden = false;
    const v = json.verify || {};
    $("doneDetail").textContent =
      v.channelName && v.followerCount != null
        ? `접수 번호 #${json.id} · ${v.channelName} (팔로워 ${v.followerCount.toLocaleString()}명)`
        : `접수 번호 #${json.id}`;
    // 취소 코드는 이 응답에서만 옵니다. 이후에는 다시 볼 수 없습니다.
    $("doneToken").textContent = json.cancelToken || "(발급되지 않음)";
    // 상태 조회 페이지로 접수 번호를 넘겨 바로 확인할 수 있게 합니다.
    $("statusLink").href = `status.html?id=${json.id}`;
  } catch {
    resetCaptcha();
    showErrors([
      "제출 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    ]);
  } finally {
    btn.disabled = false;
    btn.textContent = "제출하기";
  }
});

$("againBtn").addEventListener("click", () => {
  $("submitForm").reset();
  $("channelResult").textContent = "";
  resetCaptcha(); // 이전 토큰은 이미 사용됨
  syncKind();
  $("done").hidden = true;
  $("submitForm").hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
});
