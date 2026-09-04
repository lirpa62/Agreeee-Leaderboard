/**
 * Discord 웹훅 알림
 *
 * ⚠ 원칙: 알림 실패가 제출·승인 처리를 막아서는 안 됩니다.
 *   모든 호출은 예외를 삼키고, 절대 await 로 요청 흐름을 막지 않습니다.
 *
 * DISCORD_WEBHOOK_URL 이 없으면 조용히 비활성화됩니다.
 */

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";
const ADMIN_URL = process.env.ADMIN_PUBLIC_URL || "";
const TIMEOUT_MS = 6000;

// Discord 레이트리밋(초당 ~5회)에 걸리지 않도록 최소 간격을 둡니다.
const MIN_INTERVAL_MS = 1200;
let lastSentAt = 0;
let queue = Promise.resolve();

const COLORS = {
  info: 0x3a93ff, // Luna 블루
  success: 0x3d8b37,
  warning: 0xe0a900,
  danger: 0xc1272d,
};

function isEnabled() {
  return Boolean(WEBHOOK_URL);
}

async function post(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok && res.status !== 204) {
      console.warn(`[알림] Discord 응답 ${res.status}`);
    }
  } catch (e) {
    // 네트워크 오류 등 — 로그만 남기고 넘어갑니다.
    console.warn(`[알림] 전송 실패: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** 순차 전송 + 최소 간격 유지 (호출자를 막지 않음) */
function send(payload) {
  if (!isEnabled()) return;
  queue = queue.then(async () => {
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastSentAt));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastSentAt = Date.now();
    await post(payload);
  });
}

function leagueOf(sub) {
  if (sub.kind === "speedrun") return "⚡ 스피드런";
  if (sub.is_shortcut || sub.isShortcut) return "🎈 풍선 숏컷";
  if (sub.is_retry || sub.isRetry) return "📜 재도전 인정";
  if (sub.is_casual || sub.isCasual) return "⚠️ 캐주얼 모드";
  return "🏆 명예의 전당";
}

/** Discord 임베드 필드 값은 비어 있으면 안 됩니다. */
function safe(value, fallback = "—") {
  const s = String(value ?? "").trim();
  return s.length ? s.slice(0, 1024) : fallback;
}

/** 새 제출 알림 */
function notifyNewSubmission(sub, verify = {}) {
  if (!isEnabled()) return;

  const verdictLabel =
    { pass: "✅ 기준 충족", fail: "❌ 기준 미달", review: "⚠️ 확인 필요" }[
      verify.verdict
    ] || "⚠️ 확인 필요";

  const fields = [
    { name: "리그", value: safe(leagueOf(sub)), inline: true },
    { name: "클리어 회차", value: safe(sub.gameTime), inline: true },
  ];
  if (sub.tosTime) {
    fields.push({ name: "이용약관", value: safe(sub.tosTime), inline: true });
  }
  fields.push({
    name: "채널 확인",
    value: safe(
      verify.channelName
        ? `${verify.channelName} · 팔로워 ${
            verify.followerCount != null
              ? verify.followerCount.toLocaleString() + "명"
              : "조회 실패"
          }`
        : "채널을 확정하지 못했습니다",
    ),
    inline: false,
  });
  fields.push({ name: "자동 판정", value: verdictLabel, inline: true });

  const evidence = [
    sub.clipUrl ? `[클립](${sub.clipUrl})` : null,
    sub.vodUrl ? `[다시보기](${sub.vodUrl})` : null,
  ].filter(Boolean);
  fields.push({
    name: "증빙",
    value: evidence.length ? evidence.join(" · ") : "없음",
    inline: true,
  });

  send({
    username: "리더보드 인정협회",
    embeds: [
      {
        title: `📝 새 기록 등록 요청 #${sub.id}`,
        description: `**${safe(sub.streamerName)}**`,
        color:
          verify.verdict === "pass"
            ? COLORS.success
            : verify.verdict === "fail"
              ? COLORS.danger
              : COLORS.warning,
        fields,
        footer: ADMIN_URL
          ? { text: `검토하기 → ${ADMIN_URL}` }
          : { text: "관리자 화면에서 검토해 주세요" },
        timestamp: new Date().toISOString(),
      },
    ],
  });
}

/** 승인 / 반려 / 승인취소 처리 알림 */
function notifyReviewed(sub, action, extra = {}) {
  if (!isEnabled()) return;

  const meta = {
    // 승인은 data.js 수정까지이고, 리더보드 반영은 '발행' 이후입니다.
    approved: { title: "✅ 승인 — 발행 대기", color: COLORS.success },
    rejected: { title: "🚫 반려", color: COLORS.danger },
    reverted: { title: "↩️ 승인 취소 — 기록 삭제", color: COLORS.danger },
    reopened: { title: "🔄 대기로 되돌림 — 재검토", color: COLORS.warning },
    // 관리자가 아니라 제출자 본인이 취소한 경우입니다.
    cancelled: { title: "🗑 제출자가 취소함", color: COLORS.info },
  }[action] || { title: action, color: COLORS.info };

  const fields = [
    { name: "리그", value: safe(leagueOf(sub)), inline: true },
    { name: "기록", value: safe(sub.game_time || sub.gameTime), inline: true },
  ];

  if (extra.reason) {
    fields.push({
      name: "사유",
      value: extra.reason === "casual" ? "캐주얼 모드 확인" : "오등록 정정",
      inline: true,
    });
  }
  // 발행은 배포 크레딧을 아끼려고 모아서 하므로,
  // 잊지 않도록 쌓인 미발행 건수를 함께 알립니다.
  if (typeof extra.unpublished === "number" && extra.unpublished > 0) {
    fields.push({
      name: "미발행",
      value: `${extra.unpublished}건 — 관리자 화면에서 '발행'을 눌러야 리더보드에 반영됩니다.`,
      inline: false,
    });
  }
  // 재도전 승인으로 기존 숏컷 기록의 이름이 함께 바뀐 경우
  if (extra.balloon?.updated) {
    fields.push({
      name: "숏컷 기록 표시",
      value: safe(`🎈 추가 — ${extra.balloon.previous} → ${extra.balloon.name}`),
      inline: false,
    });
  }
  if (extra.note) {
    fields.push({ name: "메모", value: safe(extra.note), inline: false });
  }

  send({
    username: "리더보드 인정협회",
    embeds: [
      {
        title: `${meta.title} #${sub.id}`,
        description: `**${safe(sub.streamer_name || sub.streamerName)}**`,
        color: meta.color,
        fields,
        timestamp: new Date().toISOString(),
      },
    ],
  });
}

/**
 * 거부(캡차·검증 실패)가 짧은 시간에 몰릴 때 경고.
 * 도배를 막기 위해 창(window)당 한 번만 보냅니다.
 */
const ABUSE_WINDOW_MS = 10 * 60 * 1000;
const ABUSE_THRESHOLD = 12;
let abuseCount = 0;
let abuseWindowStart = Date.now();
let abuseAlertedAt = 0;

function recordRejection(kind) {
  if (!isEnabled()) return;

  const now = Date.now();
  if (now - abuseWindowStart > ABUSE_WINDOW_MS) {
    abuseWindowStart = now;
    abuseCount = 0;
  }
  abuseCount++;

  // 임계치를 넘고, 같은 창에서 아직 안 알렸다면 한 번만 발송
  if (abuseCount === ABUSE_THRESHOLD && now - abuseAlertedAt > ABUSE_WINDOW_MS) {
    abuseAlertedAt = now;
    send({
      username: "리더보드 인정협회",
      embeds: [
        {
          title: "🚨 비정상 제출 시도 감지",
          description:
            `최근 10분 동안 거부된 요청이 ${abuseCount}건을 넘었습니다.\n` +
            `마지막 사유: ${safe(kind)}\n\n` +
            `어뷰징 시도일 수 있으니 서버 로그를 확인해 주세요.`,
          color: COLORS.danger,
          timestamp: new Date().toISOString(),
        },
      ],
    });
  }
}

/** 발행 완료 알림 */
function notifyPublished(result, items) {
  if (!isEnabled()) return;

  // 승인취소와 '대기로 되돌리기' 모두 data.js 에서 제거된 건입니다.
  const isRemoval = (i) => i.revert_reason || i.reopened_from_published;
  const added = items.filter((i) => !isRemoval(i));
  const removed = items.filter(isRemoval);

  const list = items
    .slice(0, 15)
    .map(
      (s) =>
        `${isRemoval(s) ? "➖" : "➕"} ${s.streamer_name} (${s.game_time})`,
    )
    .join("\n");

  send({
    username: "리더보드 인정협회",
    embeds: [
      {
        title: `🚀 발행 완료 — ${items.length}건`,
        description:
          list + (items.length > 15 ? `\n… 외 ${items.length - 15}건` : ""),
        color: COLORS.success,
        fields: [
          { name: "추가", value: `${added.length}건`, inline: true },
          { name: "삭제", value: `${removed.length}건`, inline: true },
          {
            name: "Git",
            value: safe(
              `커밋 ${result.sha}${result.pushed ? " · 푸시됨" : " · 푸시 안 함(수동 필요)"}`,
            ),
            inline: false,
          },
        ],
        timestamp: new Date().toISOString(),
      },
    ],
  });
}

module.exports = {
  isEnabled,
  notifyNewSubmission,
  notifyReviewed,
  notifyPublished,
  recordRejection,
};
