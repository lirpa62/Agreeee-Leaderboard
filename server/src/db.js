/**
 * 제출 저장소 (SQLite)
 *
 * 공개 리더보드는 여전히 Netlify 정적 파일이 서빙합니다.
 * 이 DB 는 '제출 → 검토 → 승인/반려' 흐름만 담당합니다.
 */

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "submissions.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS submissions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT NOT NULL,           -- 'record' | 'speedrun'
  status        TEXT NOT NULL DEFAULT 'pending', -- pending|approved|rejected

  streamer_name TEXT NOT NULL,
  color         TEXT,
  channel_url   TEXT,

  -- 검증 결과 (조회 실패해도 제출은 유효)
  channel_id    TEXT,
  channel_name  TEXT,
  follower_count INTEGER,
  verify_status TEXT,                    -- exact|ambiguous|not_found|error
  verify_note   TEXT,

  -- 기록
  game_time     TEXT NOT NULL,           -- data.js 표기
  tos_time      TEXT,                    -- 스피드런은 없음
  is_shortcut   INTEGER NOT NULL DEFAULT 0,
  is_retry      INTEGER NOT NULL DEFAULT 0,
  is_casual     INTEGER NOT NULL DEFAULT 0,

  -- 증빙
  clip_url      TEXT,
  vod_url       TEXT,

  submitter_ip  TEXT,
  admin_note    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_status  ON submissions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_created ON submissions(created_at DESC);
`);

const insertStmt = db.prepare(`
INSERT INTO submissions (
  kind, streamer_name, color, channel_url,
  channel_id, channel_name, follower_count, verify_status, verify_note,
  game_time, tos_time, is_shortcut, is_retry, is_casual,
  clip_url, vod_url, submitter_ip
) VALUES (
  @kind, @streamer_name, @color, @channel_url,
  @channel_id, @channel_name, @follower_count, @verify_status, @verify_note,
  @game_time, @tos_time, @is_shortcut, @is_retry, @is_casual,
  @clip_url, @vod_url, @submitter_ip
)
`);

function insertSubmission(row) {
  const info = insertStmt.run({
    kind: row.kind,
    streamer_name: row.streamerName,
    color: row.color || null,
    channel_url: row.channelUrl || null,
    channel_id: row.channelId || null,
    channel_name: row.channelName || null,
    follower_count: row.followerCount ?? null,
    verify_status: row.verifyStatus || null,
    verify_note: row.verifyNote || null,
    game_time: row.gameTime,
    tos_time: row.tosTime || null,
    is_shortcut: row.isShortcut ? 1 : 0,
    is_retry: row.isRetry ? 1 : 0,
    is_casual: row.isCasual ? 1 : 0,
    clip_url: row.clipUrl || null,
    vod_url: row.vodUrl || null,
    submitter_ip: row.submitterIp || null,
  });
  return info.lastInsertRowid;
}

function listSubmissions({ status = "pending", limit = 100 } = {}) {
  if (status === "all") {
    return db
      .prepare(
        "SELECT * FROM submissions ORDER BY created_at DESC LIMIT ?",
      )
      .all(limit);
  }
  return db
    .prepare(
      "SELECT * FROM submissions WHERE status = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(status, limit);
}

function getSubmission(id) {
  return db.prepare("SELECT * FROM submissions WHERE id = ?").get(id);
}

function setStatus(id, status, adminNote) {
  return db
    .prepare(
      `UPDATE submissions
       SET status = ?, admin_note = ?, reviewed_at = datetime('now')
       WHERE id = ?`,
    )
    .run(status, adminNote || null, id);
}

function countByStatus() {
  const rows = db
    .prepare("SELECT status, COUNT(*) AS n FROM submissions GROUP BY status")
    .all();
  const out = { pending: 0, approved: 0, rejected: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

/** 같은 스트리머의 중복 대기 제출 확인 (스팸/실수 방지) */
function findPendingDuplicate(kind, streamerName) {
  return db
    .prepare(
      `SELECT id FROM submissions
       WHERE kind = ? AND streamer_name = ? AND status = 'pending'`,
    )
    .get(kind, streamerName);
}

module.exports = {
  db,
  insertSubmission,
  listSubmissions,
  getSubmission,
  setStatus,
  countByStatus,
  findPendingDuplicate,
};
