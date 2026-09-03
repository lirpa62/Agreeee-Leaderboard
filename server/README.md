# 기록 제출 · 검토 서버

리더보드 기록 등록 요청을 받고, 관리자가 검토해 `data.js` 에 반영하는 서버입니다.

## 설계 원칙

**공개 리더보드는 이 서버를 거치지 않습니다.** Netlify 정적 파일이 그대로 서빙합니다.
승인 시 서버가 DB 가 아니라 `data.js` 를 고치고 Git 에 커밋하면, Netlify 가 이를 감지해
자동 배포합니다. 덕분에

- 공개 트래픽은 100% Netlify 가 받아 OCI 프리티어에 부하가 없고
- 서버가 죽어도 리더보드는 계속 서비스되며
- 데이터 이력이 Git 에 남습니다.

## 실행

```bash
cd server
npm install
cp .env.example .env   # ADMIN_PASSWORD, SESSION_SECRET 반드시 변경
node src/server.js
```

- 제출 API: `POST /api/submissions`
- 채널 조회: `GET /api/channel?url=...` 또는 `?name=...`
- 관리자 화면: `/admin/`

## 환경 변수

| 이름 | 설명 |
| --- | --- |
| `ADMIN_PASSWORD` | 관리자 비밀번호 (필수) |
| `SESSION_SECRET` | 세션 서명 키 (필수, 긴 랜덤 문자열) |
| `PORT` | 포트 (기본 3000) |
| `DATA_JS_PATH` | `data.js` 경로 (기본 `../data.js`) |
| `ALLOWED_ORIGINS` | CORS 허용 출처 (쉼표 구분) |
| `GIT_AUTO_COMMIT` | 승인 시 자동 커밋 (기본 false) |
| `GIT_AUTO_PUSH` | 커밋 후 자동 푸시 (기본 false) |
| `TURNSTILE_SITE_KEY` | 캡차 사이트 키 (공개값) |
| `TURNSTILE_SECRET` | 캡차 시크릿 키 |
| `DISCORD_WEBHOOK_URL` | Discord 알림 웹훅 (비우면 비활성화) |
| `ADMIN_PUBLIC_URL` | 알림에 표시할 관리자 화면 주소 |

처음에는 `GIT_AUTO_COMMIT=false` 로 두고 `git diff` 로 결과를 확인한 뒤,
익숙해지면 켜시길 권합니다.

## 팔로워 자동 확인

치지직 비공식 API 로 팔로워 수를 조회합니다. 실측 확인 사항:

- 쿠키/인증 없이 호출 가능하나 **브라우저 User-Agent 헤더가 필수**입니다.
- 응답의 `followerCount` 를 사용합니다.

**한계 — 반드시 이해하고 쓰세요.**

1. API 가 주는 값은 **'현재'** 팔로워입니다.
   클리어 시점에 기준 미만이었더라도 현시점에 기준을 넘으면 등록 가능하므로,
   현재 값만으로 판정합니다.
2. 이름 검색은 오매칭 위험이 있습니다. 실제로 `슈네1` 을 검색하면
   팔로워 1명짜리 `슈네11` 이 나오고, `풍월량` 은 252,158명과 22명 두 채널이 잡힙니다.
   따라서 **채널 URL 을 받는 것이 가장 안전**하며, 이름만으로는 후보를 보여주고
   사람이 고르게 합니다.
3. 비공식 API 라 예고 없이 바뀔 수 있습니다. 조회에 실패해도 **제출 자체는 접수**되며,
   관리자 화면에 '확인 필요' 로 표시됩니다.

## 운영 시 확인할 것

- `ADMIN_PASSWORD` 를 반드시 변경하고, HTTPS 뒤에서 운영하세요
  (쿠키에 `Secure` 가 붙도록 `NODE_ENV=production` 설정).
- `data/` (SQLite) 는 Git 에 올라가지 않습니다. 백업을 따로 챙기세요.

## 캡차 (Cloudflare Turnstile)

공개 폼이라 무차별 제출을 막기 위해 Turnstile 을 사용합니다. 무료이고
대부분의 사용자는 클릭조차 하지 않습니다.

**설정 방법**

1. [Cloudflare 대시보드](https://dash.cloudflare.com) → Turnstile → 사이트 추가
2. 도메인에 리더보드 주소(`agreeee-leaderboard.netlify.app`)를 등록
3. 발급된 키를 `.env` 에 넣습니다.

```
TURNSTILE_SITE_KEY=0x4AAAAAAA...
TURNSTILE_SECRET=0x4AAAAAAA...
```

사이트 키는 서버가 `GET /api/config` 로 내려주므로 폼 코드를 고칠 필요가 없습니다.

**동작**

- `TURNSTILE_SECRET` 이 없으면 캡차가 **꺼진 채로** 동작하며 서버 시작 시 경고가 뜹니다.
  로컬 개발 편의를 위한 것이니 공개 배포 전에 반드시 설정하세요.
- 검증은 다른 모든 처리보다 **먼저** 수행합니다. 봇이 치지직 API 조회나
  DB 쓰기를 유발하지 못하게 하기 위함입니다.
- Cloudflare 검증 서버에 연결하지 못하면 **제출을 거부**합니다.
  (실패 시 통과시키면 캡차가 무력화되므로)
- Turnstile 토큰은 1회용이라, 제출 실패 시 폼이 자동으로 재발급받습니다.

**로컬 테스트용 키** (Cloudflare 공식 제공)

| 용도 | 사이트 키 | 시크릿 키 |
| --- | --- | --- |
| 항상 통과 | `1x00000000000000000000AA` | `1x0000000000000000000000000000000AA` |
| 항상 차단 | `2x00000000000000000000AB` | `2x0000000000000000000000000000000AA` |

테스트 키를 쓰면 위젯이 더미로 렌더링되며 "테스트 전용입니다" 문구가 표시됩니다.

## Discord 알림

새 제출이 들어오면 관리자 화면을 직접 열어보지 않아도 알 수 있도록
Discord 웹훅으로 알림을 보냅니다.

**설정 방법**

1. Discord 서버 → 서버 설정 → 연동 → 웹후크 → **새 웹후크**
2. 알림을 받을 채널을 고르고 **웹후크 URL 복사**
3. `.env` 에 넣습니다.

```ini
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
ADMIN_PUBLIC_URL=https://api.example.com/admin/
```

**알림 종류**

| 상황 | 내용 |
| --- | --- |
| 새 제출 | 스트리머·리그·기록·채널 확인 결과·자동 판정·증빙 링크, 관리자 화면 주소 |
| 승인 / 반려 | 처리 결과와 메모, Git 커밋 여부 |
| 승인 취소 | 삭제 사유(오등록/캐주얼 모드)와 Git 커밋 여부 |
| 어뷰징 의심 | 10분 내 거부가 12건을 넘으면 **한 번만** 경고 |

**동작 원칙**

- **알림 실패가 제출을 막지 않습니다.** 웹훅 서버가 죽어 있어도 제출은
  정상 접수되며(실측 응답 0.2초), 서버 로그에 경고만 남습니다.
- 전송은 요청 흐름을 막지 않고 큐에 쌓아 순차 처리하며,
  Discord 레이트리밋을 피하려 최소 1.2초 간격을 둡니다.
- 어뷰징 경고는 10분 창당 한 번만 보내 도배를 방지합니다.
- `DISCORD_WEBHOOK_URL` 이 없으면 조용히 비활성화됩니다.

## 발행 (Netlify 배포 크레딧 절약)

Netlify 는 **production 배포 1회당 15 크레딧**을 소모합니다(기본 제공 300).
승인할 때마다 푸시하면 승인 10건 = 배포 10회 = 150 크레딧이 나갑니다.

그래서 승인/승인취소 시에는 `data.js` 만 고쳐 두고, **커밋·푸시는 모아서
한 번에** 합니다. 승인 10건이라도 발행 1회면 15 크레딧입니다.

**흐름**

1. 승인 → `data.js` 즉시 수정 (커밋 없음, 미발행으로 기록)
2. 관리자 화면 상단에 `N건이 리더보드에 아직 반영되지 않았습니다` 표시
3. `🚀 발행하기` → 미발행 건 전체를 **하나의 커밋**으로 묶어 푸시
4. Netlify 배포 1회 실행

Discord 알림에도 승인/취소마다 미발행 건수가 함께 표시되어
발행을 잊지 않게 합니다.

**주의**

- 발행 전까지는 `data.js` 가 수정돼 있어도 **리더보드에 반영되지 않습니다.**
- `GIT_AUTO_PUSH=false` 면 커밋만 되고 푸시는 직접 하셔야 합니다.
  (관리자 화면에도 그렇게 안내됩니다)
- 승인 취소는 발행 여부와 무관하게 항상 발행 대상이 됩니다.
  이미 발행된 기록을 취소하면 '삭제'가 새 변경으로 잡혀 다시 미발행이 됩니다.

## 자동 배포 (GitHub 웹훅)

푸시할 때마다 서버에 SSH 로 들어가 `git pull` + 재시작을 하지 않아도
되도록, GitHub push 웹훅을 받아 서버가 스스로 갱신하게 할 수 있습니다.

**설정 방법**

1. 시크릿을 만들어 `.env` 에 넣습니다.

```bash
openssl rand -hex 32          # 출력값을 아래 두 곳에 같이 사용
```

```ini
GITHUB_WEBHOOK_SECRET=<위에서 만든 값>
DEPLOY_BRANCH=main
```

2. `sudo` 비밀번호 없이 재시작할 수 있게 허용합니다.

```bash
echo "$USER ALL=(root) NOPASSWD: /usr/bin/systemd-run, /bin/systemctl restart agreeee-server" \
  | sudo tee /etc/sudoers.d/agreeee-deploy
sudo chmod 440 /etc/sudoers.d/agreeee-deploy
sudo visudo -c   # 문법 확인 (틀리면 sudo 가 전부 막히므로 꼭 확인)
```

3. GitHub 저장소 → Settings → Webhooks → **Add webhook**

| 항목 | 값 |
| --- | --- |
| Payload URL | `https://<도메인>/api/deploy` |
| Content type | `application/json` |
| Secret | 1번에서 만든 값 |
| Events | Just the push event |

4. 서버를 재시작하면 적용됩니다.

**동작**

- 서명(`X-Hub-Signature-256`)을 검증해 GitHub 이 보낸 요청만 처리합니다.
  **`GITHUB_WEBHOOK_SECRET` 이 없으면 엔드포인트 자체가 등록되지 않습니다.**
- `DEPLOY_BRANCH` 가 아닌 브랜치 푸시는 무시합니다.
- `git fetch` 후 **rebase** 로 받습니다. 서버가 발행하며 만든 커밋이
  아직 푸시되지 않았을 수 있어 단순 pull 은 분기 상태에서 실패합니다.
- `server/` 가 바뀐 경우에만 재시작하고, `package.json` 이 바뀌었으면
  `npm ci` 를 먼저 실행합니다. 정적 파일만 바뀌었다면 아무것도 하지 않습니다.
- 동시 실행을 막기 위해 `flock` 으로 잠급니다.

**수동 실행**

```bash
bash ~/agreeee_leaderboard/server/deploy/auto-deploy.sh
```

## Netlify 배포 건너뛰기

이 저장소에는 공개 리더보드와 서버가 함께 있습니다. `server/` 만 바뀐
커밋까지 배포하면 크레딧이 낭비되므로(1 deploy = 15 credits),
루트의 `netlify.toml` 에서 그런 커밋의 빌드를 건너뜁니다.

건너뛰는 경로: `server/`, `screenshots/`, `README.md`,
`THIRD_PARTY_NOTICES.md`, `LICENSE`, `LICENSES/`, `.github/`

`data.js` 나 `index.html` 등 공개 사이트 파일이 하나라도 바뀌면 정상 배포됩니다.
