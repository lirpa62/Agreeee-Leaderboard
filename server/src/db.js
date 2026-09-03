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

/**
 * 승인 취소 사유를 저장할 컬럼 추가 (기존 DB 도 안전하게 갱신).
 * SQLite 는 IF NOT EXISTS 를 지원하지 않으므로 컬럼 존재를 먼저 확인합니다.
 */
const existingCols = new Set(
  db.prepare("PRAGMA table_info(submissions)").all().map((c) => c.name),
);
if (!existingCols.has("revert_reason")) {
  db.exec("ALTER TABLE submissions ADD COLUMN revert_reason TEXT");
}

/**
 * 발행(Git 커밋+푸시) 여부.
 *
 * Netlify 는 배포 1회당 크레딧을 소모하므로, 승인할 때마다 푸시하면
 * 승인 10건 = 배포 10회가 됩니다. 승인 시에는 data.js 만 고쳐 두고
 * 커밋·푸시는 모아서 한 번만 하기 위한 컬럼입니다.
 *
 *  NULL  : 아직 발행되지 않음 (data.js 에는 이미 반영됨)
 *  값 있음: 발행된 시각
 */
if (!existingCols.has("published_at")) {
  db.exec("ALTER TABLE submissions ADD COLUMN published_at TEXT");
}

/**
 * 이미 발행된 기록을 '대기로 되돌리기' 한 경우 표시합니다.
 *
 * 되돌리면 status 가 pending, reviewed_at 이 NULL 이 되어 일반적인
 * 미발행 조건에 걸리지 않습니다. 하지만 data.js 에서는 이미 제거됐으므로
 * 그 '삭제'를 발행해야 리더보드에서도 사라집니다.
 */
if (!existingCols.has("reopened_from_published")) {
  db.exec(
    "ALTER TABLE submissions ADD COLUMN reopened_from_published INTEGER NOT NULL DEFAULT 0",
  );
}

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
       SET status = ?, admin_note = ?, reviewed_at = datetime('now'),
           reopened_from_published = 0
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

/**
 * 실제 등록된 이름으로 갱신합니다.
 * 승인 시 관리자가 이름을 고치거나 접미사(*, 🎈)가 붙는 경우,
 * 이 값을 저장해 두어야 승인 취소 때 같은 이름으로 찾을 수 있습니다.
 */
function updateStreamerName(id, name) {
  return db
    .prepare("UPDATE submissions SET streamer_name = ? WHERE id = ?")
    .run(name, id);
}

/**
 * 실제 등록된 이름·시간으로 갱신합니다.
 *
 * 승인 시 관리자가 값을 고쳤다면 data.js 에 들어간 값과 DB 값이
 * 일치해야 합니다. 어긋나면 승인 취소 때 항목을 찾지 못합니다.
 */
function updateApprovedRecord(id, name, gameTime, tosTime) {
  return db
    .prepare(
      `UPDATE submissions
       SET streamer_name = ?, game_time = ?, tos_time = ?
       WHERE id = ?`,
    )
    .run(name, gameTime, tosTime, id);
}

/**
 * 채널 재조회 결과를 저장합니다.
 *
 * verify_note 는 제출 시점에 한 번 계산해 저장하는 값이라,
 * 판정 기준이 바뀌면 옛 문구가 그대로 남습니다.
 * 재조회로 갱신할 수 있게 해 두면 기준 변경 후에도 정리가 됩니다.
 * (관리자 화면의 '기준 충족' 배지도 이 문구를 보고 판단합니다)
 */
function updateVerification(id, { channelId, channelName, followerCount, verifyStatus, verifyNote }) {
  return db
    .prepare(
      `UPDATE submissions
       SET channel_id = ?, channel_name = ?, follower_count = ?,
           verify_status = ?, verify_note = ?
       WHERE id = ?`,
    )
    .run(
      channelId ?? null,
      channelName ?? null,
      followerCount ?? null,
      verifyStatus ?? null,
      verifyNote ?? null,
      id,
    );
}

/**
 * 승인 취소 — 상태를 되돌리고 사유를 남깁니다.
 *
 * ⚠ published_at 을 반드시 NULL 로 되돌려야 합니다.
 *   이미 발행된 기록을 취소하면 '삭제'라는 새로운 변경이 생기므로,
 *   다시 미발행 상태가 되어 발행 대상에 포함되어야 합니다.
 *   (지우지 않으면 data.js 에서는 사라졌는데 발행되지 않아
 *    리더보드에는 계속 남아 있게 됩니다)
 */
function revertApproval(id, reason, adminNote) {
  return db
    .prepare(
      `UPDATE submissions
       SET status = 'rejected', revert_reason = ?, admin_note = ?,
           reviewed_at = datetime('now'), published_at = NULL
       WHERE id = ? AND status = 'approved'`,
    )
    .run(reason, adminNote || null, id);
}

/**
 * 승인을 되돌려 다시 검토 대기로 만듭니다.
 *
 * '승인 취소'(reject)와 달리 반려하지 않고 대기 상태로 보냅니다.
 * 값을 고쳐 다시 승인할 건에 씁니다.
 *
 * ⚠ 이미 발행된 기록이라면 data.js 에서 제거된 것이 '삭제'라는 새 변경이
 *   되므로, 발행 대상으로 남겨야 합니다. 그래서 published_at 은
 *   여기서 지우지 않고 호출부(server.js)에서 판단합니다.
 */
function reopenSubmission(id, adminNote, wasPublished) {
  return db
    .prepare(
      `UPDATE submissions
       SET status = 'pending', reviewed_at = NULL, admin_note = ?,
           revert_reason = NULL, published_at = NULL,
           reopened_from_published = ?
       WHERE id = ? AND status = 'approved'`,
    )
    .run(adminNote || null, wasPublished ? 1 : 0, id);
}

/**
 * 제출자에게 보여줄 공개 정보만 추립니다.
 * IP, 관리자 메모 등 내부 정보는 제외합니다.
 */
function getPublicStatus(id) {
  const row = db
    .prepare(
      `SELECT id, kind, status, streamer_name, game_time, tos_time,
              is_shortcut, is_retry, is_casual,
              created_at, reviewed_at, revert_reason, published_at
       FROM submissions WHERE id = ?`,
    )
    .get(id);
  return row || null;
}

/**
 * 스트리머 이름으로 제출 검색.
 *
 * 이름은 리더보드에 이미 공개된 스트리머/채널명이므로 검색 자체는 안전합니다.
 * 다만 **반려 사유와 관리자 메모는 돌려주지 않습니다.**
 * 제출자가 곧 해당 스트리머라는 보장이 없어, 아무나 특정 스트리머의
 * 반려 이력을 들여다볼 수 있게 되기 때문입니다.
 * 상세 사유는 접수 번호를 아는 사람만 볼 수 있습니다. (getPublicStatus)
 */
function findByName(name) {
  const keyword = String(name || "").trim();
  if (!keyword) return [];
  return db
    .prepare(
      `SELECT id, kind, status, streamer_name, game_time, tos_time,
              is_shortcut, is_retry, is_casual, created_at, reviewed_at,
              published_at
       FROM submissions
       WHERE streamer_name LIKE ?
       ORDER BY
         CASE status WHEN 'pending' THEN 0 ELSE 1 END,
         created_at DESC
       LIMIT 20`,
    )
    .all(`%${keyword}%`);
}

/** 리더보드 '검토 중' 섹션에 보여줄 대기 목록 (최소 정보만) */
function listPendingPublic(limit = 30) {
  return db
    .prepare(
      `SELECT id, kind, streamer_name, game_time, tos_time,
              is_shortcut, is_retry, created_at
       FROM submissions
       WHERE status = 'pending'
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(limit);
}

/**
 * data.js 에는 반영됐지만 아직 발행(푸시)되지 않은 건들.
 * 승인뿐 아니라 승인취소(삭제)도 발행 대상입니다.
 */
function listUnpublished() {
  return db
    .prepare(
      `SELECT id, kind, status, streamer_name, game_time, tos_time,
              is_shortcut, is_retry, revert_reason, reviewed_at,
              reopened_from_published
       FROM submissions
       WHERE published_at IS NULL
         AND (
           -- 승인됐거나(추가), 승인취소됐거나(삭제)
           (reviewed_at IS NOT NULL
            AND (status = 'approved' OR revert_reason IS NOT NULL))
           -- 발행된 뒤 대기로 되돌린 건(삭제)
           OR reopened_from_published = 1
         )
       ORDER BY COALESCE(reviewed_at, created_at) ASC`,
    )
    .all();
}

function countUnpublished() {
  return db
    .prepare(
      `SELECT COUNT(*) AS n FROM submissions
       WHERE published_at IS NULL
         AND (
           (reviewed_at IS NOT NULL
            AND (status = 'approved' OR revert_reason IS NOT NULL))
           OR reopened_from_published = 1
         )`,
    )
    .get().n;
}

/** 발행 완료 표시 (여러 건을 한 트랜잭션으로) */
const markPublished = db.transaction((ids) => {
  const stmt = db.prepare(
    "UPDATE submissions SET published_at = datetime('now') WHERE id = ?",
  );
  for (const id of ids) stmt.run(id);
});

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
  updateStreamerName,
  updateApprovedRecord,
  updateVerification,
  revertApproval,
  reopenSubmission,
  getPublicStatus,
  findByName,
  listPendingPublic,
  listUnpublished,
  countUnpublished,
  markPublished,
  countByStatus,
  findPendingDuplicate,
};
