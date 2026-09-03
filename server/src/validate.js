/**
 * 제출 검증
 *
 * 팔로워 판정은 '현재' 값만 봅니다.
 * 클리어 시점에 기준 미만이었더라도 현시점에 기준을 넘으면 등록 가능합니다.
 *
 * URL 은 프로토콜과 호스트를 화이트리스트로 제한합니다.
 * 제출된 주소는 관리자 화면에 링크로 노출되므로,
 * javascript:/data: 같은 스킴이나 임의 도메인을 그대로 받으면 안 됩니다.
 */

const { formatParts, validateParts, parseTime } = require("./time");

// 리그별 팔로워 기준
const THRESHOLDS = { record: 10000, speedrun: 3000 };

/**
 * 클리어 회차 시간 이상값 기준.
 * 기존 기록 205건의 최대값이 33분인 반면 약관 시간은 중앙값이 4시간을 넘습니다.
 * 회차 시간에 1시간 이상이 들어오면 두 값을 바꿔 입력했을 가능성이 큽니다.
 */
const GAME_TIME_MAX_MIN = 33;
const GAME_TIME_WARN_MIN = 60;

/** URL 길이 상한 (비정상적으로 긴 입력 차단) */
const MAX_URL_LENGTH = 500;

function isHttpUrl(value) {
  if (!value) return false;
  try {
    const u = new URL(String(value).trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function safeHost(value) {
  try {
    return new URL(String(value).trim()).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** 호스트가 허용 목록에 있는지 (정확히 일치하거나 서브도메인) */
function hostMatches(host, allowed) {
  return allowed.some((d) => host === d || host.endsWith(`.${d}`));
}

// 증빙으로 받을 수 있는 도메인
const CHZZK_HOSTS = ["chzzk.naver.com"];
// 치지직 다시보기는 파트너가 아니면 일정 기간 후 삭제되므로 유튜브도 허용합니다.
const YOUTUBE_HOSTS = ["youtube.com", "youtu.be", "m.youtube.com"];

/**
 * URL 을 검증합니다.
 *
 * @param {string} value    입력값
 * @param {string} label    오류 메시지에 쓸 이름
 * @param {string[]} hosts  허용 호스트 목록
 * @param {string} hostHint 호스트 불일치 시 안내 문구
 * @returns {string|null}   오류 메시지 (없으면 null)
 */
function validateUrl(value, label, hosts, hostHint) {
  const url = String(value || "").trim();
  if (!url) return null; // 빈 값은 호출부에서 필수 여부를 판단

  if (url.length > MAX_URL_LENGTH) {
    return `${label}가 너무 깁니다. (${MAX_URL_LENGTH}자 이내)`;
  }
  // http/https 만 허용 — javascript:, data:, file: 등 차단
  if (!isHttpUrl(url)) {
    return `${label}는 http(s):// 로 시작하는 올바른 주소여야 합니다.`;
  }
  const host = safeHost(url);
  if (!hostMatches(host, hosts)) {
    return `${label}: ${hostHint}`;
  }
  return null;
}

/**
 * 제출한 이름과 조회된 채널명이 다른지 판정합니다.
 *
 * 표기 차이는 정상인 경우가 많으므로(예: '니니아*', '다주🎈')
 * 접미사·공백·대소문자를 정규화한 뒤 비교하고,
 * 차단이 아니라 '경고'로만 씁니다.
 */
function compareNames(submitted, channelName) {
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

  const a = norm(submitted);
  const b = norm(channelName);

  if (!b) return { match: "unknown" };
  if (a === b) return { match: "same" };
  // 한쪽이 다른 쪽을 포함하면 표기 차이일 가능성이 높습니다.
  if (a.includes(b) || b.includes(a)) return { match: "similar" };
  return { match: "different" };
}

/** 폼 입력 검증 → 정규화된 값 또는 오류 목록 */
function validateSubmission(body) {
  const errors = [];
  const kind = body.kind === "speedrun" ? "speedrun" : "record";

  const streamerName = String(body.streamerName || "").trim();
  if (!streamerName) errors.push("스트리머 이름을 입력해 주세요.");
  if (streamerName.length > 50)
    errors.push("스트리머 이름이 너무 깁니다. (50자 이내)");

  // 색상: #RGB / #RRGGBB 또는 빈 값
  const color = String(body.color || "").trim();
  if (color && !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) {
    errors.push("색상 코드는 #RRGGBB 형식이어야 합니다. (예: #00FFA3)");
  }

  // 채널 URL 은 필수입니다.
  // 이름 검색만으로는 오매칭 위험이 큽니다.
  // (예: '슈네1' → 팔로워 1명짜리 '슈네11', 동명 사칭 채널 존재)
  const channelUrl = String(body.channelUrl || "").trim();
  if (!channelUrl) {
    errors.push("치지직 채널 주소를 입력해 주세요.");
  } else {
    const err = validateUrl(
      channelUrl,
      "채널 주소",
      CHZZK_HOSTS,
      "치지직 채널 주소(chzzk.naver.com)만 입력할 수 있습니다.",
    );
    if (err) errors.push(err);
  }

  // 클리어 시간 (본 게임) — 필수
  const gameErr = validateParts(body.gameTime || {}, "클리어한 회차 시간");
  if (gameErr) errors.push(gameErr);

  // 약관 시간 — 본 기록만 필수, 스피드런은 받지 않음
  let tosTime = null;
  if (kind === "record") {
    const tosErr = validateParts(body.tosTime || {}, "이용약관과 마주한 시간");
    if (tosErr) errors.push(tosErr);
    else tosTime = formatParts(body.tosTime, false);
  }

  const clipUrl = String(body.clipUrl || "").trim();
  const vodUrl = String(body.vodUrl || "").trim();

  // 클립은 치지직만 (유튜브에는 '클립' 개념이 다름)
  const clipErr = validateUrl(
    clipUrl,
    "클립 주소",
    CHZZK_HOSTS,
    "치지직 클립 주소(chzzk.naver.com)만 입력할 수 있습니다.",
  );
  if (clipErr) errors.push(clipErr);

  // 다시보기는 치지직 + 유튜브
  // (치지직 다시보기는 파트너가 아니면 일정 기간 후 삭제됩니다)
  const vodErr = validateUrl(
    vodUrl,
    "다시보기 주소",
    [...CHZZK_HOSTS, ...YOUTUBE_HOSTS],
    "치지직 또는 유튜브 다시보기 주소만 입력할 수 있습니다.",
  );
  if (vodErr) errors.push(vodErr);

  if (!clipUrl && !vodUrl) {
    errors.push("클립 또는 다시보기 주소 중 하나는 반드시 필요합니다.");
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      kind,
      streamerName,
      color: color || null,
      channelUrl: channelUrl || null,
      // 본 게임 시간은 소수점 2자리까지 (스피드런 표기와 동일)
      gameTime: formatParts(body.gameTime, true),
      tosTime,
      isShortcut: !!body.isShortcut,
      isRetry: !!body.isRetry,
      isCasual: !!body.isCasual,
      clipUrl: clipUrl || null,
      vodUrl: vodUrl || null,
    },
  };
}

/**
 * 팔로워 수로 자동 판정.
 * 반환: { verdict, note }
 *   pass   - 기준 충족
 *   fail   - 기준 미달
 *   review - 채널을 확정하지 못해 판정 불가 → 사람이 확인
 *
 * 판정은 '현재' 팔로워 수만 봅니다.
 * 클리어 시점에 기준 미만이었더라도 현시점에 기준을 넘으면 등록 가능하므로,
 * 경계 근처를 따로 확인 대상으로 돌리지 않습니다.
 */
function judgeFollowers(kind, followerCount, verifyStatus) {
  const threshold = THRESHOLDS[kind] ?? THRESHOLDS.record;

  if (verifyStatus !== "exact" || followerCount == null) {
    return {
      verdict: "review",
      note: "채널을 확정하지 못해 팔로워 자동 확인을 건너뛰었습니다.",
    };
  }

  if (followerCount >= threshold) {
    return {
      verdict: "pass",
      note: `현재 팔로워 ${followerCount.toLocaleString()}명 (기준 ${threshold.toLocaleString()}명 충족)`,
    };
  }
  return {
    verdict: "fail",
    note: `현재 팔로워 ${followerCount.toLocaleString()}명 — 기준 ${threshold.toLocaleString()}명에 미달합니다.`,
  };
}

/**
 * 관리자가 승인 시 직접 고친 시간 문자열을 검증합니다.
 *
 * data.js 에 그대로 들어가는 값이라 표기가 어긋나면 차트·정렬이 깨집니다.
 * 기존 표기와 같은 형식('1시간 30분 54초', '14분 54.62초')만 허용합니다.
 *
 * @returns {{ok: true, value: string} | {ok: false, error: string}}
 */
function validateTimeString(value, label, { allowEmpty = false } = {}) {
  const raw = String(value || "").trim();
  if (!raw) {
    if (allowEmpty) return { ok: true, value: null };
    return { ok: false, error: `${label}을(를) 입력해 주세요.` };
  }
  if (raw.length > 40) {
    return { ok: false, error: `${label} 표기가 너무 깁니다.` };
  }
  // 허용: [N시간] [N분] [N(.NN)초] — 최소 한 단위는 있어야 합니다.
  const pattern =
    /^(?:(\d{1,3})시간)?\s*(?:(\d{1,2})분)?\s*(?:(\d{1,2}(?:\.\d{1,2})?)초)?$/;
  const m = pattern.exec(raw);
  if (!m || (!m[1] && !m[2] && !m[3])) {
    return {
      ok: false,
      error: `${label} 표기가 올바르지 않습니다. (예: 1시간 30분 54초 / 14분 54.62초)`,
    };
  }
  const min = m[2] ? Number(m[2]) : 0;
  const sec = m[3] ? Number(m[3]) : 0;
  if (min > 59) return { ok: false, error: `${label}: 분은 0~59 여야 합니다.` };
  if (sec >= 60) return { ok: false, error: `${label}: 초는 60 미만이어야 합니다.` };

  // 공백을 한 칸으로 정규화해 기존 표기와 맞춥니다.
  return { ok: true, value: raw.replace(/\s+/g, " ") };
}

/**
 * 회차 시간이 비정상적으로 긴지 확인합니다.
 * 제출을 막지는 않고 관리자에게 표시할 문구만 돌려줍니다.
 */
function checkGameTimeOutlier(gameTimeStr) {
  const mins = parseTime(gameTimeStr);
  if (mins >= GAME_TIME_WARN_MIN) {
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return `⚠️ 회차 시간이 ${h}시간 ${m}분으로 비정상적으로 깁니다 (기존 최대 ${GAME_TIME_MAX_MIN}분) — 약관 시간과 바뀌었을 수 있습니다`;
  }
  return null;
}

module.exports = {
  validateSubmission,
  judgeFollowers,
  compareNames,
  checkGameTimeOutlier,
  validateTimeString,
  validateUrl,
  THRESHOLDS,
  GAME_TIME_MAX_MIN,
  isHttpUrl,
};
