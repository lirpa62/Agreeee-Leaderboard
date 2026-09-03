#!/usr/bin/env bash
#
# GitHub push 를 받아 서버를 갱신합니다.
#
# server.js 의 /api/deploy 웹훅이 이 스크립트를 호출합니다.
# 직접 실행해도 됩니다:  bash ~/agreeee_leaderboard/server/deploy/auto-deploy.sh
#
# ⚠ 서버는 발행할 때 스스로 data.js 를 커밋합니다.
#   그래서 단순 `git pull` 은 분기(divergent) 상태에서 실패할 수 있어
#   rebase 로 서버 커밋을 원격 위에 얹습니다.

set -uo pipefail

REPO_DIR="${REPO_DIR:-$HOME/agreeee_leaderboard}"
SERVICE="${SERVICE_NAME:-agreeee-server}"
LOCK="/tmp/agreeee-deploy.lock"

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$1"; }

# 동시 실행 방지 (푸시가 연달아 오는 경우)
exec 9>"$LOCK"
if ! flock -n 9; then
  log "이미 배포가 진행 중입니다. 건너뜁니다."
  exit 0
fi

cd "$REPO_DIR" || { log "저장소를 찾을 수 없습니다: $REPO_DIR"; exit 1; }

BEFORE=$(git rev-parse HEAD)

# 발행으로 생긴 커밋이 아직 푸시되지 않았을 수 있으므로 rebase 로 받습니다.
log "git fetch"
if ! git fetch --quiet origin; then
  log "fetch 실패 — 네트워크나 권한을 확인하세요."
  exit 1
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
log "git rebase origin/$BRANCH"
if ! git rebase --quiet "origin/$BRANCH"; then
  log "rebase 실패 — 충돌을 수동으로 해결해야 합니다."
  git rebase --abort 2>/dev/null
  exit 1
fi

AFTER=$(git rev-parse HEAD)

if [ "$BEFORE" = "$AFTER" ]; then
  log "변경 사항이 없습니다. 재시작하지 않습니다."
  exit 0
fi

log "갱신됨: ${BEFORE:0:7} → ${AFTER:0:7}"

# server/ 가 바뀐 경우에만 의존성 설치와 재시작을 합니다.
# (정적 파일만 바뀌었다면 서버를 건드릴 이유가 없습니다)
if git diff --quiet "$BEFORE" "$AFTER" -- server/; then
  log "server/ 변경 없음 — 재시작을 건너뜁니다."
  exit 0
fi

if ! git diff --quiet "$BEFORE" "$AFTER" -- server/package.json server/package-lock.json; then
  log "의존성 변경 감지 — npm ci 실행"
  (cd "$REPO_DIR/server" && npm ci --omit=dev) || {
    log "npm ci 실패 — 재시작하지 않습니다."
    exit 1
  }
fi

log "서비스 재시작: $SERVICE"
sudo systemctl restart "$SERVICE"
sleep 2

if systemctl is-active --quiet "$SERVICE"; then
  log "재시작 완료 ✅"
else
  log "재시작 후 서비스가 실행 중이 아닙니다 ❌"
  journalctl -u "$SERVICE" -n 20 --no-pager
  exit 1
fi
