/**
 * 기록 제출 / 검토 서버
 *
 * 공개 리더보드는 Netlify 정적 파일이 그대로 서빙합니다.
 * 이 서버는 제출 접수와 관리자 검토만 담당하므로 부하가 거의 없습니다.
 */

require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const express = require("express");

const db = require("./db");
const chzzk = require("./chzzk");
const {
  validateSubmission,
  judgeFollowers,
  compareNames,
  checkGameTimeOutlier,
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
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));

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
  res.json({
    ok: true,
    status: r.status,
    channel,
    candidates: r.candidates || [],
    verdict: judged.verdict,
    note: judged.note,
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

    const applied = dataFile.applySubmission({
      name: finalName,
      gameTime: sub.game_time,
      tosTime: sub.tos_time,
      color: sub.color,
      arrayName: dataFile.arrayNameFor(sub),
    });

    // 실제 등록된 이름을 DB 에도 반영해 두어야
    // 나중에 승인 취소 시 같은 이름으로 찾을 수 있습니다.
    if (finalName !== sub.streamer_name) {
      db.updateStreamerName(sub.id, finalName);
      sub.streamer_name = finalName;
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

/** 미발행 목록 조회 */
app.get("/api/admin/unpublished", requireAdmin, (req, res) => {
  res.json({
    ok: true,
    rows: db.listUnpublished(),
    autoPush: git.AUTO_PUSH,
  });
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
function requireAdminPage(req, res, next) {
  // 로그인 페이지는 통과
  if (req.path === "/login.html" || req.path === "/login.js") return next();
  if (verifyToken(parseCookies(req).admin)) return next();
  res.redirect("/admin/login.html");
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
