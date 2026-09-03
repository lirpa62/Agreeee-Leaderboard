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
# flock 이 없는 환경(예: macOS)에서는 잠금 없이 진행합니다.
# 없다고 배포를 건너뛰면 조용히 아무 일도 안 하게 되어 더 나쁩니다.
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK"
  if ! flock -n 9; then
    log "이미 배포가 진행 중입니다. 건너뜁니다."
    exit 0
  fi
else
  log "flock 이 없어 잠금 없이 진행합니다."
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

# ─────────────────────────── 재시작 ───────────────────────────
#
# ⚠ 이 스크립트는 웹훅을 받은 서버 프로세스의 자식으로 실행됩니다.
#   즉 '자기 자신을 재시작' 하는 상황이라 그냥 restart 를 부르면
#   명령이 끝나기 전에 스크립트까지 함께 죽습니다.
#   (systemd 는 재시작 시 서비스 cgroup 의 프로세스를 모두 정리합니다)
#
#   그래서 systemd-run 으로 서비스 밖에 일회성 유닛을 만들어 맡깁니다.
#   요청한 즉시 반환되고, 실제 재시작은 우리와 무관한 곳에서 수행됩니다.
#
#   또한 유닛의 NoNewPrivileges=true 때문에 이 프로세스에서는 sudo 가
#   아예 동작하지 않습니다(setuid 상승 금지). 그래서 sudo 로 감싸지 않고
#   polkit/sudoers 로 권한을 받은 systemd-run 을 직접 씁니다.

log "서비스 재시작 요청: $SERVICE"

if err=$(sudo -n systemd-run --unit="agreeee-redeploy-$$" --collect \
           /bin/systemctl restart "$SERVICE" 2>&1); then
  log "재시작을 systemd 에 넘겼습니다 ✅ (곧 새 프로세스로 교체됩니다)"
  exit 0
fi
log "systemd-run 실패: ${err:-(메시지 없음)}"

# systemd-run 이 없거나 권한이 없으면 setsid 로라도 떼어 냅니다.
if command -v setsid >/dev/null 2>&1 &&
   err=$(setsid --fork sudo -n /bin/systemctl restart "$SERVICE" 2>&1); then
  log "재시작을 백그라운드로 넘겼습니다 ✅"
  exit 0
fi
log "setsid 실패: ${err:-(메시지 없음)}"

log "재시작에 실패했습니다 ❌"
log "확인할 것:"
log "  1) sudoers — $(whoami) ALL=(root) NOPASSWD: /usr/bin/systemd-run, /bin/systemctl restart $SERVICE"
log "  2) 유닛의 NoNewPrivileges=true 가 켜져 있으면 sudo 자체가 막힙니다."
log "     (sudo: a password is required / must be setuid root 메시지가 그 증상입니다)"
exit 1
