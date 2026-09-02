#!/usr/bin/env bash
#
# OCI 인스턴스 초기 설정 스크립트 (Ubuntu 22.04 / 24.04 기준)
#
# 사용법:
#   ssh ubuntu@<서버IP>
#   git clone <저장소> ~/agreeee_leaderboard
#   bash ~/agreeee_leaderboard/server/deploy/setup.sh
#
# 이 스크립트는 '설치와 설정'만 합니다.
# .env 작성과 도메인/HTTPS 설정은 안내에 따라 직접 하셔야 합니다.

set -euo pipefail

REPO_DIR="${REPO_DIR:-$HOME/agreeee_leaderboard}"
SERVER_DIR="$REPO_DIR/server"
NODE_MAJOR=22

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m[주의] %s\033[0m\n' "$1"; }

if [ ! -d "$SERVER_DIR" ]; then
  echo "저장소를 찾을 수 없습니다: $SERVER_DIR"
  echo "먼저 git clone 을 하신 뒤 다시 실행해 주세요."
  exit 1
fi

say "시스템 패키지 업데이트"
sudo apt-get update -y
# better-sqlite3 네이티브 빌드에 필요합니다.
sudo apt-get install -y build-essential python3 git nginx

say "Node.js ${NODE_MAJOR} 설치"
if ! command -v node >/dev/null 2>&1 || \
   [ "$(node -p 'process.versions.node.split(".")[0]')" -lt "$NODE_MAJOR" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v

say "의존성 설치"
cd "$SERVER_DIR"
npm ci --omit=dev 2>/dev/null || npm install --omit=dev

say ".env 준비"
if [ ! -f "$SERVER_DIR/.env" ]; then
  cp "$SERVER_DIR/.env.example" "$SERVER_DIR/.env"
  # 세션 시크릿은 자동 생성해 둡니다.
  SECRET="$(openssl rand -hex 32)"
  sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=${SECRET}|" "$SERVER_DIR/.env"
  chmod 600 "$SERVER_DIR/.env"
  warn ".env 를 만들었습니다. ADMIN_PASSWORD 와 TURNSTILE_* 를 반드시 채우세요."
else
  echo ".env 가 이미 있어 건너뜁니다."
fi

say "방화벽 설정 (OCI 보안 목록도 따로 열어야 합니다)"
sudo iptables -I INPUT -p tcp --dport 80  -j ACCEPT || true
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT || true
if command -v netfilter-persistent >/dev/null 2>&1; then
  sudo netfilter-persistent save || true
fi

say "systemd 서비스 등록"
sudo cp "$SERVER_DIR/deploy/agreeee-server.service" /etc/systemd/system/
sudo sed -i "s|/home/ubuntu/agreeee_leaderboard|${REPO_DIR}|g" \
  /etc/systemd/system/agreeee-server.service
sudo sed -i "s|^User=.*|User=$(whoami)|" /etc/systemd/system/agreeee-server.service
sudo systemctl daemon-reload
sudo systemctl enable agreeee-server

cat <<EOF

────────────────────────────────────────────────────────
설치가 끝났습니다. 이제 아래를 직접 해주세요.

1) .env 채우기
     nano $SERVER_DIR/.env
   - ADMIN_PASSWORD      : 관리자 비밀번호
   - TURNSTILE_SITE_KEY  : Cloudflare Turnstile 사이트 키
   - TURNSTILE_SECRET    : Turnstile 시크릿 키
   - ALLOWED_ORIGINS     : https://agreeee-leaderboard.netlify.app
   - PORT                : 3000 (nginx 설정과 맞출 것)

2) 서버 시작
     sudo systemctl start agreeee-server
     sudo systemctl status agreeee-server
     journalctl -u agreeee-server -f     # 로그 보기

3) nginx + HTTPS
     sudo cp $SERVER_DIR/deploy/nginx.conf /etc/nginx/sites-available/agreeee-api
     sudo nano /etc/nginx/sites-available/agreeee-api   # server_name 을 실제 도메인으로
     sudo ln -sf /etc/nginx/sites-available/agreeee-api /etc/nginx/sites-enabled/
     sudo nginx -t && sudo systemctl reload nginx
     sudo apt-get install -y certbot python3-certbot-nginx
     sudo certbot --nginx -d <도메인>

4) OCI 콘솔에서 보안 목록(Security List)에 80, 443 인그레스 규칙 추가
   (인스턴스 방화벽만 열어서는 접속되지 않습니다)

5) 리더보드의 submit.js 에서 API_BASE 를 실제 도메인으로 변경 후 배포
────────────────────────────────────────────────────────
EOF
