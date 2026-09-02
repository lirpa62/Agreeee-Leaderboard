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

처음에는 `GIT_AUTO_COMMIT=false` 로 두고 `git diff` 로 결과를 확인한 뒤,
익숙해지면 켜시길 권합니다.

## 팔로워 자동 확인

치지직 비공식 API 로 팔로워 수를 조회합니다. 실측 확인 사항:

- 쿠키/인증 없이 호출 가능하나 **브라우저 User-Agent 헤더가 필수**입니다.
- 응답의 `followerCount` 를 사용합니다.

**한계 — 반드시 이해하고 쓰세요.**

1. API 가 주는 값은 **'현재'** 팔로워이고, 기준은 **'클리어 시점'** 입니다.
   그래서 기준 ±20% 는 자동 판정하지 않고 관리자 확인으로 넘깁니다.
2. 이름 검색은 오매칭 위험이 있습니다. 실제로 `슈네1` 을 검색하면
   팔로워 1명짜리 `슈네11` 이 나오고, `풍월량` 은 252,158명과 22명 두 채널이 잡힙니다.
   따라서 **채널 URL 을 받는 것이 가장 안전**하며, 이름만으로는 후보를 보여주고
   사람이 고르게 합니다.
3. 비공식 API 라 예고 없이 바뀔 수 있습니다. 조회에 실패해도 **제출 자체는 접수**되며,
   관리자 화면에 '확인 필요' 로 표시됩니다.

## 운영 시 확인할 것

- `ADMIN_PASSWORD` 를 반드시 변경하고, HTTPS 뒤에서 운영하세요
  (쿠키에 `Secure` 가 붙도록 `NODE_ENV=production` 설정).
- 공개 폼이므로 어뷰징 대비가 필요합니다. 현재 IP 기준 간단한 요청 제한만
  들어 있으니, 실제 공개 전에 Cloudflare Turnstile 같은 캡차 추가를 권합니다.
- `data/` (SQLite) 는 Git 에 올라가지 않습니다. 백업을 따로 챙기세요.
