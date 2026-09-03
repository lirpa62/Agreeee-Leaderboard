/**
 * 기록 제출 / 검토 서버
 *
 * 공개 리더보드는 Netlify 정적 파일이 그대로 서빙합니다.
 * 이 서버는 제출 접수와 관리자 검토만 담당하므로 부하가 거의 없습니다.
 */

require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const express = require("express");

const db = require("./db");
const chzzk = require("./chzzk");
const {
  validateSubmission,
  judgeFollowers,
  compareNames,
  checkGameTimeOutlier,
  validateTimeString,
  validateUrl,
  CHZZK_HOSTS,
  YOUTUBE_HOSTS,
} = require("./validate");
const dataFile = require("./dataFile");
const git = require("./git");
const captcha = require("./captcha");
const notify = require("./notify");

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!ADMIN_PASSWORD || !SESSION_SECRET) {
  console.error(
    "[치명적] ADMIN_PASSWORD 와 SESSION_SECRET 을 .env 에 설정해야 합니다.\n" +
      "         .env.example 을 참고하세요.",
  );
  process.exit(1);
}
if (ADMIN_PASSWORD === "change-me") {
  console.error("[치명적] ADMIN_PASSWORD 를 기본값에서 변경하세요.");
  process.exit(1);
}

app.set("trust proxy", 1);
// ⚠ /api/deploy 는 GitHub 서명 검증에 원본 바이트가 필요하므로
//   전역 JSON 파서를 건너뛰게 합니다. (파싱되면 서명이 깨집니다)
const skipDeploy = (mw) => (req, res, next) =>
  req.path === "/api/deploy" ? next() : mw(req, res, next);

app.use(skipDeploy(express.json({ limit: "32kb" })));
app.use(skipDeploy(express.urlencoded({ extended: false, limit: "32kb" })));

/**
 * CORS — 제출 폼은 Netlify(정적)에서, API 는 이 서버에서 서빙되므로
 * 교차 출처 요청이 됩니다. 허용 출처를 명시적으로 제한합니다.
 * ALLOWED_ORIGINS 에 쉼표로 구분해 지정하세요.
 */
const ALLOWED_ORIGINS = String(
  process.env.ALLOWED_ORIGINS ||
    "https://agreeee-leaderboard.netlify.app,http://localhost:8765",
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ── 간단한 요청 제한 (공개 폼이므로 무차별 제출 방지) ────────────────
const rateBuckets = new Map();
function rateLimit({ windowMs, max, key = "ip" }) {
  return (req, res, next) => {
    const id = `${key}:${req.ip}`;
    const now = Date.now();
    const bucket = rateBuckets.get(id) || { count: 0, reset: now + windowMs };
    if (now > bucket.reset) {
      bucket.count = 0;
      bucket.reset = now + windowMs;
    }
    bucket.count++;
    rateBuckets.set(id, bucket);
    if (bucket.count > max) {
      const wait = Math.ceil((bucket.reset - now) / 1000);
      notify.recordRejection("요청 제한 초과 (429)");
      return res
        .status(429)
        .json({ ok: false, errors: [`요청이 너무 잦습니다. ${wait}초 후 다시 시도해 주세요.`] });
    }
    next();
  };
}
// 오래된 버킷 정리
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateBuckets) if (now > v.reset) rateBuckets.delete(k);
}, 60_000).unref();

// ── 관리자 세션 (서명 쿠키, 외부 의존성 없이) ──────────────────────
function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
}
function issueToken() {
  const exp = Date.now() + 12 * 60 * 60 * 1000; // 12시간
  return `${exp}.${sign(String(exp))}`;
}
function verifyToken(token) {
  const [exp, sig] = String(token || "").split(".");
  if (!exp || !sig) return false;
  if (Number(exp) < Date.now()) return false;
  const expected = sign(exp);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1));
  }
  return out;
}
function requireAdmin(req, res, next) {
  if (verifyToken(parseCookies(req).admin)) return next();
  res.status(401).json({ ok: false, error: "로그인이 필요합니다." });
}

// ── 공개 API ────────────────────────────────────────────────────

/**
 * 폼 설정 — 캡차 사이트 키를 서버에서 내려줍니다.
 * (사이트 키는 공개값이지만, 코드에 하드코딩하지 않고 서버 설정을 따르게 합니다)
 */
app.get("/api/config", (req, res) => {
  res.json({
    ok: true,
    captcha: {
      enabled: captcha.isEnabled(),
      siteKey: process.env.TURNSTILE_SITE_KEY || "",
    },
  });
});

/** 제출 상태 조회 (접수 번호로) */
app.get(
  "/api/submissions/:id/status",
  rateLimit({ windowMs: 60_000, max: 60 }),
  (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ ok: false, error: "접수 번호가 올바르지 않습니다." });
    }
    const row = db.getPublicStatus(id);
    if (!row) {
      return res.status(404).json({ ok: false, error: "해당 접수 번호를 찾을 수 없습니다." });
    }
    res.json({ ok: true, submission: row });
  },
);

/**
 * 스트리머 이름으로 제출 검색.
 * 상태(대기/승인/반려)는 보여주지만 반려 사유는 제외합니다.
 * 상세 사유는 접수 번호를 아는 사람만 볼 수 있습니다. (db.findByName 주석 참고)
 */
app.get(
  "/api/submissions/search",
  rateLimit({ windowMs: 60_000, max: 30 }),
  (req, res) => {
    const name = String(req.query.name || "").trim();
    if (name.length < 2) {
      return res
        .status(400)
        .json({ ok: false, error: "스트리머 이름을 두 글자 이상 입력해 주세요." });
    }
    res.json({ ok: true, rows: db.findByName(name) });
  },
);

/** 검토 대기 목록 (리더보드 '검토 중' 섹션용) */
app.get(
  "/api/submissions/pending",
  rateLimit({ windowMs: 60_000, max: 60 }),
  (req, res) => {
    // 정적 리더보드가 호출하므로 캐시를 길게 둡니다.
    res.setHeader("Cache-Control", "public, max-age=120");
    res.json({ ok: true, rows: db.listPendingPublic(30) });
  },
);

/** 채널 조회 미리보기 (폼에서 이름/URL 확인용) */
app.get(
  "/api/channel",
  rateLimit({ windowMs: 60_000, max: 20 }),
  async (req, res) => {
    const { url, name } = req.query;
    if (!url && !name) {
      return res.status(400).json({ ok: false, error: "url 또는 name 이 필요합니다." });
    }
    const result = await chzzk.resolveChannel({
      channelUrl: url,
      streamerName: name,
    });
    res.json({ ok: true, ...result });
  },
);

/** 기록 제출 */
app.post(
  "/api/submissions",
  rateLimit({ windowMs: 10 * 60_000, max: 5 }),
  async (req, res) => {
    // 캡차를 가장 먼저 확인합니다.
    // (봇이 치지직 API 조회까지 유발하지 않도록)
    const captchaResult = await captcha.verify(
      req.body?.captchaToken,
      req.ip,
    );
    if (!captchaResult.ok) {
      notify.recordRejection(`캡차 실패 — ${captchaResult.reason}`);
      return res.status(400).json({ ok: false, errors: [captchaResult.reason] });
    }

    const checked = validateSubmission(req.body || {});
    if (!checked.ok) {
      notify.recordRejection("입력 검증 실패");
      return res.status(400).json({ ok: false, errors: checked.errors });
    }
    const v = checked.value;

    // 중복 대기 제출 방지
    const dup = db.findPendingDuplicate(v.kind, v.streamerName);
    if (dup) {
      return res.status(409).json({
        ok: false,
        errors: [
          "같은 이름으로 검토 대기 중인 제출이 이미 있습니다. 처리 후 다시 요청해 주세요.",
        ],
      });
    }

    // 채널 조회 — 실패해도 제출은 접수됩니다 (비공식 API 의존이므로)
    let channel = null;
    let verifyStatus = "error";
    let verifyNote = "";
    try {
      const r = await chzzk.resolveChannel({
        channelUrl: v.channelUrl,
        streamerName: v.streamerName,
      });
      verifyStatus = r.status;
      if (r.status === "exact") channel = r.channel;
      else if (r.candidates?.length) {
        verifyNote = `후보 ${r.candidates.length}개: ${r.candidates
          .map((c) => `${c.channelName}(${c.followerCount ?? "?"})`)
          .join(", ")}`;
      }
    } catch (e) {
      verifyNote = `조회 오류: ${e.message}`;
    }

    const judged = judgeFollowers(
      v.kind,
      channel?.followerCount ?? null,
      verifyStatus,
    );

    // 입력한 이름과 조회된 채널명이 다르면 검증 메모에 남깁니다.
    // (차단하지 않습니다 — '니니아*' 처럼 표기가 다른 경우가 정상입니다)
    // 회차 시간이 비정상적으로 길면 (약관 시간과 혼동했을 가능성) 메모에 남깁니다.
    const outlier = checkGameTimeOutlier(v.gameTime);
    if (outlier) {
      verifyNote = [verifyNote, outlier].filter(Boolean).join(" / ");
    }

    const nameCheck = compareNames(v.streamerName, channel?.channelName);
    if (nameCheck.match === "different") {
      verifyNote = [
        verifyNote,
        `⚠️ 이름 불일치: 입력 '${v.streamerName}' ↔ 채널 '${channel.channelName}'`,
      ]
        .filter(Boolean)
        .join(" / ");
    }

    const id = db.insertSubmission({
      ...v,
      channelId: channel?.channelId || null,
      channelName: channel?.channelName || null,
      followerCount: channel?.followerCount ?? null,
      verifyStatus,
      verifyNote: [verifyNote, judged.note].filter(Boolean).join(" / "),
      submitterIp: req.ip,
    });

    // 알림은 응답을 막지 않도록 await 하지 않습니다.
    notify.notifyNewSubmission(
      { ...v, id },
      {
        channelName: channel?.channelName || null,
        followerCount: channel?.followerCount ?? null,
        verdict: judged.verdict,
      },
    );

    res.status(201).json({
      ok: true,
      id,
      verify: {
        status: verifyStatus,
        channelName: channel?.channelName || null,
        followerCount: channel?.followerCount ?? null,
        verdict: judged.verdict,
        note: judged.note,
      },
      message:
        "제출이 접수되었습니다. 관리자가 증빙을 확인한 뒤 반영됩니다.",
    });
  },
);

// ── 관리자 ──────────────────────────────────────────────────────

app.post("/api/admin/login", rateLimit({ windowMs: 15 * 60_000, max: 10 }), (req, res) => {
  const given = String(req.body?.password || "");
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(ADMIN_PASSWORD).digest();
  if (!crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ ok: false, error: "비밀번호가 올바르지 않습니다." });
  }
  res.setHeader(
    "Set-Cookie",
    `admin=${issueToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200` +
      (process.env.NODE_ENV === "production" ? "; Secure" : ""),
  );
  res.json({ ok: true });
});

app.post("/api/admin/logout", (req, res) => {
  res.setHeader("Set-Cookie", "admin=; HttpOnly; Path=/; Max-Age=0");
  res.json({ ok: true });
});

app.get("/api/admin/submissions", requireAdmin, (req, res) => {
  const status = String(req.query.status || "pending");
  res.json({
    ok: true,
    counts: db.countByStatus(),
    rows: db.listSubmissions({ status, limit: 200 }),
  });
});

/** 팔로워 재조회 (제출 시점 이후 값이 바뀌었을 수 있으므로) */
app.post("/api/admin/submissions/:id/recheck", requireAdmin, async (req, res) => {
  const sub = db.getSubmission(Number(req.params.id));
  if (!sub) return res.status(404).json({ ok: false, error: "제출을 찾을 수 없습니다." });

  const r = await chzzk.resolveChannel({
    channelUrl: sub.channel_url,
    streamerName: sub.streamer_name,
  });
  const channel = r.status === "exact" ? r.channel : null;
  const judged = judgeFollowers(sub.kind, channel?.followerCount ?? null, r.status);

  // 검증 메모를 제출 시점과 같은 방식으로 다시 만듭니다.
  // (판정 기준이 바뀌었어도 재조회 한 번으로 정리됩니다)
  let note = "";
  if (r.status !== "exact" && r.candidates?.length) {
    note = `후보 ${r.candidates.length}개: ${r.candidates
      .map((c) => `${c.channelName}(${c.followerCount ?? "?"})`)
      .join(", ")}`;
  }

  const outlier = checkGameTimeOutlier(sub.game_time);
  if (outlier) note = [note, outlier].filter(Boolean).join(" / ");

  const nameCheck = compareNames(sub.streamer_name, channel?.channelName);
  if (nameCheck.match === "different") {
    note = [
      note,
      `⚠️ 이름 불일치: 입력 '${sub.streamer_name}' ↔ 채널 '${channel.channelName}'`,
    ]
      .filter(Boolean)
      .join(" / ");
  }

  note = [note, judged.note].filter(Boolean).join(" / ");

  // 화면에만 보여주지 않고 DB 에도 반영합니다.
  db.updateVerification(sub.id, {
    channelId: channel?.channelId,
    channelName: channel?.channelName,
    followerCount: channel?.followerCount,
    verifyStatus: r.status,
    verifyNote: note,
  });

  res.json({
    ok: true,
    status: r.status,
    channel,
    candidates: r.candidates || [],
    verdict: judged.verdict,
    note: judged.note,
    savedNote: note,
  });
});

/** 승인 → data.js 반영 (+ 선택적 Git 커밋) */
app.post("/api/admin/submissions/:id/approve", requireAdmin, async (req, res) => {
  const sub = db.getSubmission(Number(req.params.id));
  if (!sub) return res.status(404).json({ ok: false, error: "제출을 찾을 수 없습니다." });
  if (sub.status !== "pending") {
    return res.status(409).json({ ok: false, error: "이미 처리된 제출입니다." });
  }

  try {
    // 관리자가 이름을 고쳐 승인할 수 있습니다. (오타·표기 정정)
    // 값이 없으면 제출된 이름을 그대로 씁니다.
    const overrideName = String(req.body?.name || "").trim();
    const rawName = overrideName || sub.streamer_name;

    // 리그별 표기 접미사(* / 🎈)를 붙입니다.
    // 숏컷의 🎈는 '재도전도 함께 등록되는 경우'에만 붙습니다.
    const finalName = dataFile.decorateName(rawName, {
      isRetry: !!sub.is_retry,
      isShortcut: !!sub.is_shortcut,
      hasRetryToo: req.body?.hasRetryToo === true,
    });

    // 관리자가 시간도 고쳐 승인할 수 있습니다.
    // (증빙을 보니 제출값과 다른 경우 — 반려 후 재제출을 요구하지 않아도 됩니다)
    const gameCheck = validateTimeString(
      req.body?.gameTime || sub.game_time,
      "클리어한 회차 시간",
    );
    if (!gameCheck.ok) {
      return res.status(400).json({ ok: false, error: gameCheck.error });
    }

    // 스피드런은 약관 시간이 없습니다.
    const tosCheck = validateTimeString(
      req.body?.tosTime ?? sub.tos_time,
      "이용약관과 마주한 시간",
      { allowEmpty: true },
    );
    if (!tosCheck.ok) {
      return res.status(400).json({ ok: false, error: tosCheck.error });
    }

    const finalGameTime = gameCheck.value;
    const finalTosTime = sub.kind === "speedrun" ? null : tosCheck.value;

    const applied = dataFile.applySubmission({
      name: finalName,
      gameTime: finalGameTime,
      tosTime: finalTosTime,
      color: sub.color,
      arrayName: dataFile.arrayNameFor(sub),
      // 리더보드의 'NEW' 배지와 우클릭 메뉴에서 씁니다.
      // 제출 시각이 아니라 승인 시각을 기준으로 해야
      // 검토가 늦어져도 시청자에게 새 기록으로 보입니다.
      addedAt: new Date().toISOString(),
      channelUrl: sub.channel_url,
      clipUrl: sub.clip_url,
      vodUrl: sub.vod_url,
    });

    // 실제 등록된 값을 DB 에도 반영해 두어야
    // 나중에 승인 취소 시 같은 값으로 찾을 수 있습니다.
    if (
      finalName !== sub.streamer_name ||
      finalGameTime !== sub.game_time ||
      finalTosTime !== sub.tos_time
    ) {
      db.updateApprovedRecord(sub.id, finalName, finalGameTime, finalTosTime);
      sub.streamer_name = finalName;
      sub.game_time = finalGameTime;
      sub.tos_time = finalTosTime;
    }

    // 커밋·푸시는 하지 않습니다. Netlify 배포 크레딧을 아끼기 위해
    // 여러 건을 모아 '발행' 버튼으로 한 번에 처리합니다.
    db.setStatus(sub.id, "approved", String(req.body?.note || ""));

    const unpublished = db.countUnpublished();
    notify.notifyReviewed(sub, "approved", {
      note: req.body?.note,
      unpublished,
    });
    res.json({ ok: true, applied, unpublished });
  } catch (e) {
    // data.js 수정 실패 시 상태를 바꾸지 않습니다.
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/admin/submissions/:id/reject", requireAdmin, (req, res) => {
  const sub = db.getSubmission(Number(req.params.id));
  if (!sub) return res.status(404).json({ ok: false, error: "제출을 찾을 수 없습니다." });
  db.setStatus(sub.id, "rejected", String(req.body?.note || ""));
  notify.notifyReviewed(sub, "rejected", { note: req.body?.note });
  res.json({ ok: true });
});

/**
 * 승인 되돌리기 — data.js 에서 제거하고 다시 검토 대기로 보냅니다.
 *
 * '승인 취소'(reject)와 달리 반려하지 않습니다.
 * 값을 고쳐 다시 승인해야 하는 건에 씁니다.
 */
app.post("/api/admin/submissions/:id/reopen", requireAdmin, async (req, res) => {
  const sub = db.getSubmission(Number(req.params.id));
  if (!sub) return res.status(404).json({ ok: false, error: "제출을 찾을 수 없습니다." });
  if (sub.status !== "approved") {
    return res
      .status(409)
      .json({ ok: false, error: "승인된 제출만 되돌릴 수 있습니다." });
  }

  const wasPublished = Boolean(sub.published_at);

  try {
    // data.js 에서 먼저 제거합니다.
    // (남겨두면 리더보드에는 있는데 상태만 대기가 되어 어긋납니다)
    const reverted = dataFile.revertSubmission({
      name: sub.streamer_name,
      gameTime: sub.game_time,
      tosTime: sub.tos_time,
      arrayName: dataFile.arrayNameFor(sub),
    });

    // 이미 발행됐던 건이면 '삭제'를 발행해야 리더보드에서도 사라집니다.
    // 아직 발행 전이었다면 추가·삭제가 상쇄되므로 발행할 것이 없습니다.
    db.reopenSubmission(sub.id, String(req.body?.note || ""), wasPublished);

    const unpublished = db.countUnpublished();
    notify.notifyReviewed(sub, "reopened", {
      note: req.body?.note,
      // 발행 전이었다면 추가·삭제가 상쇄되어 발행할 것이 없습니다.
      unpublished: wasPublished ? unpublished : 0,
    });

    res.json({
      ok: true,
      reverted,
      wasPublished,
      unpublished,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * 승인 취소 — data.js 에서 기록을 제거합니다.
 *
 * reason:
 *   'mistake' : 단순 오등록 → 완전 삭제
 *   'casual'  : 캐주얼 모드 발각 → 삭제 후 하단 삭제 목록에 수동 추가 안내
 */
app.post("/api/admin/submissions/:id/revert", requireAdmin, async (req, res) => {
  const sub = db.getSubmission(Number(req.params.id));
  if (!sub) return res.status(404).json({ ok: false, error: "제출을 찾을 수 없습니다." });
  if (sub.status !== "approved") {
    return res
      .status(409)
      .json({ ok: false, error: "승인된 제출만 취소할 수 있습니다." });
  }

  const reason = req.body?.reason === "casual" ? "casual" : "mistake";

  try {
    const reverted = dataFile.revertSubmission({
      name: sub.streamer_name,
      gameTime: sub.game_time,
      tosTime: sub.tos_time,
      arrayName: dataFile.arrayNameFor(sub),
    });

    // 삭제도 발행 대상입니다. (커밋은 '발행' 시 한 번에)
    db.revertApproval(sub.id, reason, String(req.body?.note || ""));

    const unpublished = db.countUnpublished();
    notify.notifyReviewed(sub, "reverted", {
      reason,
      note: req.body?.note,
      unpublished,
    });

    res.json({
      ok: true,
      reverted,
      unpublished,
      // 캐주얼 모드는 기존 관례상 하단 삭제 목록에 남깁니다.
      followUp:
        reason === "casual"
          ? `index.html 의 '캐주얼 모드 사용으로 인한 기록 삭제' 목록에 ` +
            `${sub.streamer_name} 을(를) 추가해 주세요.`
          : null,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * 미발행 목록 조회.
 *
 * DB 기록만 믿으면 실제와 어긋날 수 있습니다.
 * (수동 커밋, 이전 버전의 건별 커밋 등으로 이미 반영된 경우)
 * 그래서 data.js 에 실제 변경이 있는지 함께 확인해 알려줍니다.
 */
app.get("/api/admin/unpublished", requireAdmin, async (req, res) => {
  const rows = db.listUnpublished();
  let dirty = null;
  try {
    dirty = await git.hasPendingChanges();
  } catch {
    dirty = null; // git 확인 실패 시 판단 보류
  }
  res.json({
    ok: true,
    rows,
    autoPush: git.AUTO_PUSH,
    // false 면 DB 에는 미발행으로 남아 있지만 파일은 이미 커밋된 상태입니다.
    hasFileChanges: dirty,
  });
});

/* ─────────────────── 기록 링크 관리 (검토와 별개 화면) ─────────────────── */

/** data.js 의 모든 기록을 링크와 함께 나열합니다. */
app.get("/api/admin/records", requireAdmin, (req, res) => {
  try {
    res.json({ ok: true, rows: dataFile.listRecords() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * 기록 하나의 링크를 추가·수정·삭제합니다.
 *
 * 값이 빈 문자열이면 그 링크를 지웁니다.
 * 기록(이름·시간) 자체는 이 화면에서 건드리지 않습니다.
 */
app.post("/api/admin/records/urls", requireAdmin, (req, res) => {
  const { arrayName, index } = req.body || {};
  if (typeof arrayName !== "string" || !Number.isInteger(index) || index < 0) {
    return res
      .status(400)
      .json({ ok: false, error: "arrayName 과 index 가 필요합니다." });
  }

  // 저장하기 전에 URL 을 검증합니다. 제출 폼과 같은 규칙을 씁니다.
  // (클립은 치지직만, 다시보기는 치지직 + 유튜브)
  const RULES = {
    channelUrl: [
      "채널 주소",
      CHZZK_HOSTS,
      "치지직 채널 주소(chzzk.naver.com)만 입력할 수 있습니다.",
    ],
    clipUrl: [
      "클립 주소",
      CHZZK_HOSTS,
      "치지직 클립 주소(chzzk.naver.com)만 입력할 수 있습니다.",
    ],
    vodUrl: [
      "다시보기 주소",
      [...CHZZK_HOSTS, ...YOUTUBE_HOSTS],
      "치지직 또는 유튜브 다시보기 주소만 입력할 수 있습니다.",
    ],
  };

  const urls = {};
  for (const [key, [label, hosts, hint]] of Object.entries(RULES)) {
    if (!(key in (req.body || {}))) continue;
    const raw = String(req.body[key] || "").trim();
    if (!raw) {
      urls[key] = ""; // 빈 값 = 삭제
      continue;
    }
    const err = validateUrl(raw, label, hosts, hint);
    if (err) return res.status(400).json({ ok: false, error: err });
    urls[key] = raw;
  }
  if (!Object.keys(urls).length) {
    return res.status(400).json({ ok: false, error: "수정할 링크가 없습니다." });
  }

  try {
    const updated = dataFile.updateRecordUrls(arrayName, index, urls);
    res.json({ ok: true, updated });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/**
 * 채널 확인 — 기록의 이름과 채널 주소가 맞는지 대조합니다.
 *
 * 두 가지 경우를 모두 처리합니다.
 *   1) 채널 주소가 있음 → 그 채널을 조회해 기록의 이름과 대조
 *   2) 채널 주소가 없음 → 이름으로 검색해 채울 후보를 제안
 *
 * 판정만 돌려주고 저장은 하지 않습니다. 실제 반영은 관리자가
 * 값을 확인한 뒤 '저장' 을 눌러야 이루어집니다.
 */
app.post("/api/admin/records/verify", requireAdmin, async (req, res) => {
  const { arrayName, index } = req.body || {};
  if (typeof arrayName !== "string" || !Number.isInteger(index) || index < 0) {
    return res
      .status(400)
      .json({ ok: false, error: "arrayName 과 index 가 필요합니다." });
  }

  let record;
  try {
    record = dataFile.listRecords().find(
      (r) => r.arrayName === arrayName && r.index === index,
    );
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
  if (!record) {
    return res.status(404).json({ ok: false, error: "기록을 찾을 수 없습니다." });
  }

  // 화면에서 편집 중인 값을 우선 씁니다. (저장 전에도 확인할 수 있게)
  const channelUrl =
    "channelUrl" in (req.body || {})
      ? String(req.body.channelUrl || "").trim()
      : record.channelUrl;

  if (channelUrl) {
    const err = validateUrl(
      channelUrl,
      "채널 주소",
      CHZZK_HOSTS,
      "치지직 채널 주소(chzzk.naver.com)만 입력할 수 있습니다.",
    );
    if (err) return res.status(400).json({ ok: false, error: err });
  }

  // data.js 의 이름에는 리그 표기(*, 🎈)가 붙어 있으므로 떼고 비교합니다.
  const plainName = dataFile.baseName(record.name);

  try {
    const result = await chzzk.resolveChannel({
      channelUrl,
      streamerName: plainName,
    });
    const channel = result.status === "exact" ? result.channel : null;

    // 스피드런은 3,000, 나머지는 10,000 이 등재 기준입니다.
    const kind = arrayName === "SPEEDRUN_DATA" ? "speedrun" : "record";
    const judged = judgeFollowers(
      kind,
      channel?.followerCount ?? null,
      result.status,
    );
    const nameCheck = channel
      ? compareNames(plainName, channel.channelName)
      : { match: "unknown" };

    res.json({
      ok: true,
      // 주소가 비어 있었는지 알려 주어야 화면에서 문구를 나눌 수 있습니다.
      hadUrl: Boolean(channelUrl),
      recordName: record.name,
      plainName,
      status: result.status,
      channel,
      candidates: result.candidates || [],
      nameMatch: nameCheck.match,
      verdict: judged.verdict,
      note: judged.note,
      threshold: kind === "speedrun" ? 3000 : 10000,
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: `조회에 실패했습니다: ${e.message}` });
  }
});

/**
 * 발행 — 미발행 건들을 하나의 커밋으로 묶어 푸시합니다.
 *
 * Netlify 는 배포 1회당 크레딧을 쓰므로(1 deploy = 15 credits),
 * 승인 10건을 개별 푸시하면 150 크레딧이 나갑니다.
 * 모아서 한 번만 발행하면 15 크레딧으로 끝납니다.
 */
app.post("/api/admin/publish", requireAdmin, async (req, res) => {
  const items = db.listUnpublished();
  if (!items.length) {
    return res
      .status(409)
      .json({ ok: false, error: "발행할 변경 사항이 없습니다." });
  }

  try {
    const result = await git.publishBatch(items);

    // data.js 에 변경이 없다면(수동 커밋 등) 발행 완료로 정리만 합니다.
    if (result.alreadyClean) {
      db.markPublished(items.map((i) => i.id));
      return res.json({
        ok: true,
        cleaned: true,
        count: items.length,
        message: result.reason,
      });
    }

    if (!result.published) {
      return res.status(500).json({ ok: false, error: result.reason });
    }

    db.markPublished(items.map((i) => i.id));
    notify.notifyPublished(result, items);

    res.json({ ok: true, ...result });
  } catch (e) {
    // 커밋·푸시에 실패하면 발행 표시를 하지 않아 다시 시도할 수 있게 둡니다.
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 관리자 화면 (정적)
app.use("/admin", requireAdminPage, express.static(path.join(__dirname, "..", "public", "admin")));
/**
 * 로그인 페이지와 그 페이지가 필요로 하는 정적 자원은 인증 없이 통과시킵니다.
 * (스타일·파비콘까지 막으면 로그인 화면이 깨진 채로 보입니다)
 */
const PUBLIC_ADMIN_FILES = new Set([
  "/login.html",
  "/login.js",
  "/admin.css",
  "/favicon.png",
]);

function requireAdminPage(req, res, next) {
  if (PUBLIC_ADMIN_FILES.has(req.path)) return next();
  if (verifyToken(parseCookies(req).admin)) return next();
  res.redirect("/admin/login.html");
}

/**
 * GitHub push 웹훅 — 푸시되면 서버가 스스로 갱신합니다.
 *
 * ⚠ 명령을 실행하는 엔드포인트이므로 서명 검증이 필수입니다.
 *   GITHUB_WEBHOOK_SECRET 이 없으면 아예 등록하지 않습니다.
 *
 * GitHub 저장소 → Settings → Webhooks → Add webhook
 *   Payload URL  : https://<도메인>/api/deploy
 *   Content type : application/json
 *   Secret       : GITHUB_WEBHOOK_SECRET 과 동일한 값
 *   Events       : Just the push event
 */
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || "";

if (GITHUB_WEBHOOK_SECRET) {
  // 서명 검증에 원본 바이트가 필요하므로 이 경로만 raw 로 받습니다.
  app.post(
    "/api/deploy",
    express.raw({ type: "*/*", limit: "5mb" }),
    (req, res) => {
      const sig = req.get("X-Hub-Signature-256") || "";
      const expected =
        "sha256=" +
        crypto
          .createHmac("sha256", GITHUB_WEBHOOK_SECRET)
          .update(req.body)
          .digest("hex");

      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        console.warn("[배포] 서명 검증 실패 — 요청을 거부했습니다.");
        return res.status(401).json({ ok: false, error: "invalid signature" });
      }

      // 푸시 이벤트만 처리 (ping 등은 200 으로 받아넘김)
      const event = req.get("X-GitHub-Event");
      if (event !== "push") {
        return res.json({ ok: true, skipped: event });
      }

      let branch = "";
      try {
        branch = String(JSON.parse(req.body.toString("utf8")).ref || "");
      } catch {
        /* 본문을 못 읽어도 배포는 진행합니다 */
      }
      // 기본 브랜치가 아니면 무시합니다.
      const target = process.env.DEPLOY_BRANCH || "main";
      if (branch && branch !== `refs/heads/${target}`) {
        return res.json({ ok: true, skipped: branch });
      }

      // 응답을 먼저 보내고 백그라운드로 실행합니다.
      // (GitHub 은 10초 안에 응답이 없으면 실패로 표시합니다)
      res.json({ ok: true, started: true });

      const script = path.join(__dirname, "..", "deploy", "auto-deploy.sh");
      execFile("bash", [script], { timeout: 180000 }, (err, stdout, stderr) => {
        const out = String(stdout || "").trim();
        if (out) console.log(out);
        if (err) {
          console.error(`[배포] 실패: ${err.message}`);
          if (stderr) console.error(String(stderr).trim());
        }
      });
    },
  );
}

app.get("/health", (req, res) => res.json({ ok: true }));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`제출 서버 실행 중 → http://localhost:${PORT}`);
    console.log(`관리자 화면      → http://localhost:${PORT}/admin/`);
    console.log(`data.js 경로     → ${dataFile.DATA_JS_PATH}`);
    console.log(`Git 자동 커밋    → ${git.AUTO_COMMIT ? "켜짐" : "꺼짐"}`);
    console.log(`캡차(Turnstile)  → ${captcha.isEnabled() ? "켜짐" : "꺼짐"}`);
    console.log(`Discord 알림     → ${notify.isEnabled() ? "켜짐" : "꺼짐"}`);
    if (!captcha.isEnabled()) {
      console.warn(
        "  ⚠ TURNSTILE_SECRET 이 없어 캡차가 꺼져 있습니다.\n" +
          "    공개 배포 전에 반드시 설정하세요. (server/README.md 참고)",
      );
    }
  });
}

module.exports = app;
