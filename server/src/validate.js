/**
 * 제출 검증
 *
 * 팔로워 기준은 '클리어 시점' 인데 API 가 주는 값은 '현재' 입니다.
 * 따라서 경계에서 충분히 멀 때만 자동 판정하고,
 * 경계 근처는 관리자 확인으로 넘깁니다.
 */

const { formatParts, validateParts } = require("./time");

// 리그별 팔로워 기준
const THRESHOLDS = { record: 10000, speedrun: 3000 };

// 기준 ±20% 는 '경계 근처'로 보고 자동 판정하지 않습니다.
const MARGIN_RATIO = 0.2;

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
    return new URL(String(value).trim()).hostname;
  } catch {
    return "";
  }
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
  } else if (!isHttpUrl(channelUrl)) {
    errors.push("채널 주소가 올바른 URL 이 아닙니다.");
  } else if (!/(^|\.)chzzk\.naver\.com$/i.test(safeHost(channelUrl))) {
    errors.push("치지직 채널 주소(chzzk.naver.com)를 입력해 주세요.");
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
  if (clipUrl && !isHttpUrl(clipUrl)) errors.push("클립 주소가 올바르지 않습니다.");
  if (vodUrl && !isHttpUrl(vodUrl)) errors.push("다시보기 주소가 올바르지 않습니다.");
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
 *   pass   - 기준을 충분히 넘음 (자동 통과 가능)
 *   fail   - 기준에 충분히 못 미침 (반려 후보)
 *   review - 경계 근처이거나 조회 실패 → 사람이 확인
 */
function judgeFollowers(kind, followerCount, verifyStatus) {
  const threshold = THRESHOLDS[kind] ?? THRESHOLDS.record;

  if (verifyStatus !== "exact" || followerCount == null) {
    return {
      verdict: "review",
      note: "채널을 확정하지 못해 팔로워 자동 확인을 건너뛰었습니다.",
    };
  }

  const upper = threshold * (1 + MARGIN_RATIO);
  const lower = threshold * (1 - MARGIN_RATIO);

  if (followerCount >= upper) {
    return {
      verdict: "pass",
      note: `현재 팔로워 ${followerCount.toLocaleString()}명 (기준 ${threshold.toLocaleString()}명 충족)`,
    };
  }
  if (followerCount < lower) {
    return {
      verdict: "fail",
      note: `현재 팔로워 ${followerCount.toLocaleString()}명 — 기준 ${threshold.toLocaleString()}명에 미달합니다. (클리어 시점에는 달랐을 수 있으니 확인 필요)`,
    };
  }
  return {
    verdict: "review",
    note: `현재 팔로워 ${followerCount.toLocaleString()}명 — 기준(${threshold.toLocaleString()}명) 근처이므로 클리어 시점 확인이 필요합니다.`,
  };
}

module.exports = {
  validateSubmission,
  judgeFollowers,
  compareNames,
  THRESHOLDS,
  isHttpUrl,
};
