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
const { validateSubmission, judgeFollowers } = require("./validate");
const dataFile = require("./dataFile");
const git = require("./git");

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
    const checked = validateSubmission(req.body || {});
    if (!checked.ok) {
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

    const id = db.insertSubmission({
      ...v,
      channelId: channel?.channelId || null,
      channelName: channel?.channelName || null,
      followerCount: channel?.followerCount ?? null,
      verifyStatus,
      verifyNote: [verifyNote, judged.note].filter(Boolean).join(" / "),
      submitterIp: req.ip,
    });

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
    const applied = dataFile.applySubmission({
      name: sub.streamer_name,
      gameTime: sub.game_time,
      tosTime: sub.tos_time,
      color: sub.color,
      arrayName: dataFile.arrayNameFor(sub),
    });

    let gitResult = { committed: false, reason: "" };
    try {
      gitResult = await git.commitDataFile(sub);
    } catch (e) {
      gitResult = { committed: false, reason: `커밋 실패: ${e.message}` };
    }

    db.setStatus(sub.id, "approved", String(req.body?.note || ""));
    res.json({ ok: true, applied, git: gitResult });
  } catch (e) {
    // data.js 수정 실패 시 상태를 바꾸지 않습니다.
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/admin/submissions/:id/reject", requireAdmin, (req, res) => {
  const sub = db.getSubmission(Number(req.params.id));
  if (!sub) return res.status(404).json({ ok: false, error: "제출을 찾을 수 없습니다." });
  db.setStatus(sub.id, "rejected", String(req.body?.note || ""));
  res.json({ ok: true });
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
  });
}

module.exports = app;
