# OCI 서버 구축 가이드

리더보드 제출·검토 서버를 Oracle Cloud 프리티어에 올리는 절차입니다.

> **공개 리더보드는 이 서버와 무관합니다.** Netlify 정적 파일이 계속 서빙하므로,
> 이 서버가 죽어도 리더보드는 정상 동작합니다. 서버는 제출 접수와 관리자 검토만 합니다.
> 따라서 트래픽 부담이 거의 없어 프리티어로 충분합니다.

---

## 1. 인스턴스 생성

OCI 콘솔 → Compute → Instances → **Create Instance**

| 항목 | 값 | 비고 |
| --- | --- | --- |
| Shape | **VM.Standard.E2.1.Micro** | 1 OCPU / 1GB. 계정·지역에 따라 이것만 선택 가능할 수 있습니다. |
| 이미지 | **Canonical Ubuntu 24.04** (Minimal 아님) | 아래 설명 참고 |
| SSH 키 | 공개키 등록 | 접속에 필요합니다. |

**이미지 선택 기준**

- **`aarch64` 는 고르면 안 됩니다.** E2.1.Micro 는 x86(AMD) 셰이프라 ARM 이미지는
  부팅되지 않습니다. `aarch64` 는 A1(Ampere) 전용입니다.
- **Minimal 은 피하세요.** `build-essential`, `python3` 등을 따로 받아야 하는데,
  1 OCPU 에서는 그 시간이 더 아깝습니다. 프리티어 디스크는 넉넉합니다.
- **24.04 를 권합니다.** LTS 지원이 2029년까지로 길고 Node 22 와 검증된 조합입니다.
  20.04 는 2025년 5월 표준 지원이 끝났고, 26.04 는 아직 새것이라
  NodeSource 저장소가 해당 코드네임을 지원하지 않을 수 있습니다.

> **A1(Ampere) 을 쓸 수 있다면 그쪽이 훨씬 여유롭습니다** (4 OCPU / 24GB 까지 무료).
> 다만 재고 부족이나 정책 변경으로 선택지에 없을 수 있으며,
> **E2.1.Micro 로도 이 서버는 충분히 돌아갑니다.** 제출 접수와 검토만 하고
> 공개 트래픽은 Netlify 가 받기 때문입니다.

### 1GB 메모리에서 주의할 점

`better-sqlite3` 는 네이티브 모듈이지만, **v13 은 플랫폼별 바이너리를 패키지에 포함**해
배포합니다(`prebuilds/linux-x64.node`). E2.1.Micro 는 x86 이라 여기에 해당하므로
보통 컴파일이 일어나지 않고 설치가 금방 끝납니다.

그래도 `setup.sh` 는 대비책을 둡니다.

1. 스왑이 없으면 **2GB 스왑 파일을 만들고** `vm.swappiness=30` 을 설정합니다.
   (소스 빌드로 넘어가는 경우와, 운영 중 메모리 압박 대비)
2. 설치 후 `require('better-sqlite3')` 로 **실제 로드를 확인**하고,
   실패할 때만 소스 빌드로 넘어갑니다.

Node 프로세스 자체는 이 워크로드에서 100MB 안팎이고, nginx 가 50MB 정도이므로
1GB 로 운영에 무리는 없습니다.

## 2. 네트워크 열기 — **두 곳 모두** 해야 합니다

여기서 막히는 경우가 가장 많습니다. OCI 는 방화벽이 두 겹입니다.

**(1) OCI 보안 목록**
콘솔 → Networking → VCN → Subnet → Security List → Add Ingress Rules

| Source CIDR | Protocol | Port |
| --- | --- | --- |
| 0.0.0.0/0 | TCP | 80 |
| 0.0.0.0/0 | TCP | 443 |

**(2) 인스턴스 내부 방화벽**
`setup.sh` 가 iptables 규칙을 넣어줍니다. Ubuntu 이미지는 기본으로
모든 인바운드를 막고 있으니 이 단계를 건너뛰면 접속되지 않습니다.

## 3. 서버 설치

```bash
ssh ubuntu@<서버 공인 IP>

git clone <이 저장소 주소> ~/agreeee_leaderboard
bash ~/agreeee_leaderboard/server/deploy/setup.sh
```

스크립트가 하는 일: Node.js 22 설치, 빌드 도구 설치(`better-sqlite3` 는 네이티브
모듈이라 `build-essential` 이 필요합니다), 의존성 설치, `.env` 생성 및
`SESSION_SECRET` 자동 발급, iptables 개방, systemd 서비스 등록.

## 4. 환경 변수 채우기

```bash
nano ~/agreeee_leaderboard/server/.env
```

```ini
ADMIN_PASSWORD=<긴 비밀번호>
SESSION_SECRET=<setup.sh 가 자동 생성함>
PORT=3000

ALLOWED_ORIGINS=https://agreeee-leaderboard.netlify.app

TURNSTILE_SITE_KEY=0x4AAAAAAA...
TURNSTILE_SECRET=0x4AAAAAAA...

# 처음에는 꺼두고 git diff 로 결과를 확인하다가, 익숙해지면 켜세요.
GIT_AUTO_COMMIT=false
GIT_AUTO_PUSH=false
```

## 5. 시작 및 확인

```bash
sudo systemctl start agreeee-server
sudo systemctl status agreeee-server
journalctl -u agreeee-server -f          # 실시간 로그

curl http://localhost:3000/health        # {"ok":true}
```

## 6. 도메인 + HTTPS

Turnstile 과 쿠키 보안 때문에 **HTTPS 가 사실상 필수**입니다.
도메인을 하나 준비해 A 레코드를 서버 IP 로 연결한 뒤:

```bash
sudo cp ~/agreeee_leaderboard/server/deploy/nginx.conf \
        /etc/nginx/sites-available/agreeee-api
sudo nano /etc/nginx/sites-available/agreeee-api    # server_name 변경
sudo ln -sf /etc/nginx/sites-available/agreeee-api /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.example.com
```

## 7. 리더보드 연결

`submit.html` 의 meta 태그만 바꾸면 됩니다. (JS 수정 불필요)

```html
<meta name="api-base" content="https://api.example.com" />
```

커밋 후 푸시하면 Netlify 가 배포합니다.

## 8. Git 자동 커밋을 쓸 경우

승인 시 서버가 `data.js` 를 커밋·푸시하려면 저장소 쓰기 권한이 필요합니다.

```bash
# 커밋 작성자 설정
git -C ~/agreeee_leaderboard config user.name  "agreeee-bot"
git -C ~/agreeee_leaderboard config user.email "bot@example.com"

# 푸시 권한 — 배포 키(읽기/쓰기) 또는 파인그레인드 토큰 사용
ssh-keygen -t ed25519 -C "agreeee-server" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub    # → GitHub 저장소 Settings → Deploy keys (Allow write)
```

`GIT_AUTO_PUSH=true` 로 켜기 전에, 수동으로 `git push` 가 되는지 먼저 확인하세요.

---

## 운영 체크리스트

- [ ] `ADMIN_PASSWORD` 를 기본값에서 변경했는가
- [ ] HTTPS 가 적용되어 관리자 쿠키에 `Secure` 가 붙는가 (`NODE_ENV=production`)
- [ ] Turnstile 키를 넣어 캡차가 **켜짐** 으로 뜨는가 (기동 로그 확인)
- [ ] `ALLOWED_ORIGINS` 에 실제 리더보드 도메인만 들어 있는가
- [ ] 관리자 화면(`/admin/`)을 IP 제한할 것인지 결정했는가 (nginx.conf 주석 참고)
- [ ] SQLite 백업 방법을 정했는가 — `server/data/` 는 Git 에 올라가지 않습니다

```bash
# 백업 예시 (cron 에 등록)
sqlite3 ~/agreeee_leaderboard/server/data/submissions.db \
  ".backup '/home/ubuntu/backup/submissions-$(date +%F).db'"
```

## 자주 겪는 문제

| 증상 | 원인 |
| --- | --- |
| 브라우저에서 접속 안 됨 | OCI 보안 목록과 인스턴스 방화벽 **둘 중 하나만** 열었을 때가 대부분입니다. |
| `better-sqlite3` 설치 실패 | 1GB 인스턴스에서 컴파일 중 OOM 인 경우가 많습니다. `free -h` 로 스왑이 잡혔는지 확인하세요. `build-essential`·`python3` 누락도 원인입니다(`setup.sh` 가 설치). |
| 설치 중 프로세스가 갑자기 죽음 | 메모리 부족(OOM). `dmesg \| grep -i oom` 으로 확인되며, 스왑 생성 후 재시도하면 해결됩니다. |
| 폼에서 CORS 오류 | `ALLOWED_ORIGINS` 에 리더보드 도메인이 없거나 끝에 `/` 가 붙은 경우. |
| 캡차가 계속 실패 | 사이트 키/시크릿이 서로 다른 Turnstile 사이트의 것일 때. 기동 로그에 설정 오류가 찍힙니다. |
| 승인 시 커밋 실패 | 서버의 Git 사용자·푸시 권한 미설정. 8번 항목 참고. |
