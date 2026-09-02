/**
 * 승인된 기록을 Git 에 커밋 (선택적으로 푸시)
 *
 * Netlify 가 푸시를 감지해 자동 배포하므로,
 * 이 커밋이 곧 리더보드 반영입니다.
 *
 * GIT_AUTO_COMMIT=false 면 파일만 수정하고 커밋하지 않습니다.
 * (처음에는 false 로 두고 수동으로 확인하다가, 익숙해지면 켜세요)
 */

const { execFile } = require("child_process");
const path = require("path");

const REPO_DIR = process.env.REPO_DIR || path.join(__dirname, "..", "..");
const AUTO_COMMIT = process.env.GIT_AUTO_COMMIT === "true";
const AUTO_PUSH = process.env.GIT_AUTO_PUSH === "true";

function run(args, cwd = REPO_DIR) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, timeout: 30000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(String(stdout).trim());
    });
  });
}

/**
 * data.js 변경분을 커밋합니다.
 * 커밋 대상을 data.js 로 한정해 다른 작업 중인 변경이 섞이지 않게 합니다.
 */
async function commitDataFile(submission, options = {}) {
  if (!AUTO_COMMIT) {
    return { committed: false, reason: "GIT_AUTO_COMMIT 이 꺼져 있습니다." };
  }

  const status = await run(["status", "--porcelain", "--", "data.js"]);
  if (!status) {
    return { committed: false, reason: "data.js 에 변경 사항이 없습니다." };
  }

  const league =
    submission.kind === "speedrun"
      ? "스피드런"
      : submission.is_shortcut
        ? "풍선 숏컷"
        : submission.is_retry
          ? "재도전 인정"
          : "명예의 전당";

  const message = options.revert
    ? `fix: ${submission.streamer_name} ${league} 기록 삭제\n\n` +
      `- 사유: ${
        options.reason === "casual" ? "캐주얼 모드 확인" : "오등록 정정"
      }\n` +
      `- 기록: ${submission.game_time}` +
      (submission.tos_time ? ` / 약관: ${submission.tos_time}` : "") +
      `\n- 제출 #${submission.id} 승인 취소`
    : `feat: ${submission.streamer_name} ${league} 기록 추가\n\n` +
      `- 기록: ${submission.game_time}` +
      (submission.tos_time ? ` / 약관: ${submission.tos_time}` : "") +
      `\n- 제출 #${submission.id}` +
      (submission.channel_name ? ` (채널: ${submission.channel_name})` : "") +
      (submission.follower_count != null
        ? ` 팔로워 ${submission.follower_count.toLocaleString()}명`
        : "");

  await run(["add", "--", "data.js"]);
  await run(["commit", "-m", message]);
  const sha = await run(["rev-parse", "--short", "HEAD"]);

  let pushed = false;
  if (AUTO_PUSH) {
    await run(["push"]);
    pushed = true;
  }
  return { committed: true, sha, pushed };
}

/**
 * 여러 건을 한 커밋으로 묶어 발행합니다.
 *
 * Netlify 는 배포 1회마다 크레딧을 소모하므로(1 deploy = 15 credits),
 * 승인할 때마다 푸시하면 승인 10건에 150 크레딧이 나갑니다.
 * data.js 는 승인 시 이미 수정해 두고, 커밋·푸시만 여기서 한 번에 합니다.
 *
 * @param {Array} items - db.listUnpublished() 결과
 */
async function publishBatch(items) {
  if (!items.length) {
    return { published: false, reason: "발행할 변경 사항이 없습니다." };
  }

  const status = await run(["status", "--porcelain", "--", "data.js"]);
  if (!status) {
    // 파일에 변경이 없는데 미발행 건이 남아 있다면,
    // 이미 수동으로 커밋했을 가능성이 큽니다. 발행 완료로 처리하도록 알립니다.
    return {
      published: false,
      alreadyClean: true,
      reason:
        "data.js 에 변경 사항이 없습니다. 이미 수동으로 커밋하셨다면 발행 완료로 표시됩니다.",
    };
  }

  const leagueOf = (s) =>
    s.kind === "speedrun"
      ? "스피드런"
      : s.is_shortcut
        ? "풍선 숏컷"
        : s.is_retry
          ? "재도전 인정"
          : "명예의 전당";

  const added = items.filter((i) => i.status === "approved");
  const removed = items.filter((i) => i.revert_reason);

  // 제목: 건수 요약 / 본문: 개별 내역
  const parts = [];
  if (added.length) parts.push(`기록 ${added.length}건 추가`);
  if (removed.length) parts.push(`${removed.length}건 삭제`);
  const subject = `feat: ${parts.join(", ")}`;

  const lines = [];
  for (const s of added) {
    lines.push(
      `- ${s.streamer_name} (${leagueOf(s)}) ${s.game_time}` +
        (s.tos_time ? ` / 약관 ${s.tos_time}` : "") +
        ` [#${s.id}]`,
    );
  }
  for (const s of removed) {
    lines.push(
      `- (삭제) ${s.streamer_name} — ${
        s.revert_reason === "casual" ? "캐주얼 모드 확인" : "오등록 정정"
      } [#${s.id}]`,
    );
  }

  const message = `${subject}\n\n${lines.join("\n")}`;

  await run(["add", "--", "data.js"]);
  await run(["commit", "-m", message]);
  const sha = await run(["rev-parse", "--short", "HEAD"]);

  let pushed = false;
  if (AUTO_PUSH) {
    await run(["push"]);
    pushed = true;
  }
  return { published: true, sha, pushed, count: items.length };
}

module.exports = {
  commitDataFile,
  publishBatch,
  REPO_DIR,
  AUTO_COMMIT,
  AUTO_PUSH,
};
