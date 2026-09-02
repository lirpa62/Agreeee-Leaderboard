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

/* 색상 입력과 색상 선택기 연동 */
$("colorPicker").addEventListener("input", (e) => {
  $("color").value = e.target.value.toUpperCase();
});
$("color").addEventListener("input", (e) => {
  const v = e.target.value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) $("colorPicker").value = v;
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
