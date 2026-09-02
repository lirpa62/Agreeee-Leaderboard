/**
 * 치지직 채널 조회 (비공식 API)
 *
 * 실측 확인 사항 (2026-09-03):
 *  - 쿠키/인증 없이 호출 가능
 *  - 단, 브라우저 User-Agent 가 없으면 응답이 오지 않음 (필수)
 *  - 검색/상세 응답 모두 followerCount 포함
 *
 * 비공식 API 이므로 예고 없이 스펙이 바뀔 수 있습니다.
 * 따라서 이 모듈의 실패가 '제출 자체'를 막지 않도록,
 * 호출부에서는 항상 null 가능성을 처리해야 합니다.
 */

const API_BASE = "https://api.chzzk.naver.com/service/v1";

// 이게 없으면 요청이 조용히 실패합니다. 반드시 유지하세요.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const TIMEOUT_MS = 8000;

// 채널 정보 캐시 (같은 채널을 반복 조회하지 않도록)
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        accept: "application/json, text/plain, */*",
        "User-Agent": USER_AGENT,
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 치지직 채널 URL 에서 채널 ID 추출.
 * 지원 형식:
 *   https://chzzk.naver.com/{channelId}
 *   https://chzzk.naver.com/live/{channelId}
 *   https://chzzk.naver.com/video/{videoNo}  → 채널ID 아님(null)
 *   채널ID 32자 hex 를 그대로 넣은 경우도 허용
 */
function extractChannelId(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;

  // 채널 ID 를 직접 넣은 경우
  if (/^[0-9a-f]{32}$/i.test(raw)) return raw.toLowerCase();

  let url;
  try {
    url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  if (!/(^|\.)chzzk\.naver\.com$/i.test(url.hostname)) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  for (const seg of segments) {
    if (/^[0-9a-f]{32}$/i.test(seg)) return seg.toLowerCase();
  }
  return null;
}

/** 채널 ID 로 상세 조회 (가장 정확한 경로) */
async function getChannelById(channelId) {
  const id = String(channelId || "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(id)) return null;

  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const json = await fetchJson(`${API_BASE}/channels/${id}`);
  const c = json?.content;
  if (!c || !c.channelId) return null;

  const value = {
    channelId: c.channelId,
    channelName: String(c.channelName || ""),
    followerCount: Number.isFinite(Number(c.followerCount))
      ? Number(c.followerCount)
      : null,
    verified: c.verifiedMark === true,
    source: "channelId",
  };
  cache.set(id, { at: Date.now(), value });
  return value;
}

/**
 * 이름 정제: 리더보드 표기에는 이모지/별표가 섞여 있어
 * 그대로 검색하면 결과가 나오지 않습니다. (예: "다주🎈", "니니아*")
 */
function cleanName(name) {
  return String(name || "")
    .replace(/\*/g, "")
    .replace(
      /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu,
      "",
    )
    .trim();
}

function normalizeForCompare(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("ko-KR");
}

/**
 * 닉네임으로 채널 검색.
 * 이름 검색은 오매칭 위험이 있으므로(예: "슈네1" → "슈네11"),
 * 정확히 일치하는 후보가 하나일 때만 확정하고,
 * 그 외에는 후보 목록을 돌려주어 사람이 고르게 합니다.
 */
async function searchChannelByName(name) {
  const keyword = cleanName(name);
  if (!keyword) return { status: "empty", candidates: [] };

  const json = await fetchJson(
    `${API_BASE}/search/channels?keyword=${encodeURIComponent(
      keyword,
    )}&offset=0&size=10`,
  );
  const rows = json?.content?.data;
  if (!Array.isArray(rows) || rows.length === 0) {
    return { status: "not_found", candidates: [] };
  }

  const candidates = rows
    .map((r) => r?.channel)
    .filter((c) => c && c.channelId)
    .map((c) => ({
      channelId: c.channelId,
      channelName: String(c.channelName || ""),
      followerCount: Number.isFinite(Number(c.followerCount))
        ? Number(c.followerCount)
        : null,
      verified: c.verifiedMark === true,
      source: "search",
    }));

  // 팔로워 많은 순으로 정렬해 사람이 고르기 쉽게 합니다.
  // (동명 사칭 채널이 실제로 존재합니다 — 예: "풍월량" 252,158명 vs 22명)
  const byFollowers = (a, b) => (b.followerCount || 0) - (a.followerCount || 0);

  const target = normalizeForCompare(keyword);
  const exact = candidates
    .filter((c) => normalizeForCompare(c.channelName) === target)
    .sort(byFollowers);

  if (exact.length === 1) {
    return { status: "exact", channel: exact[0], candidates };
  }
  if (exact.length > 1) {
    // 이름이 같은 채널이 여럿 → 자동 확정하지 않고 관리자가 선택
    return { status: "ambiguous", candidates: exact };
  }
  return {
    status: "ambiguous",
    candidates: candidates.sort(byFollowers).slice(0, 5),
  };
}

/**
 * 제출 검증용 채널 조회.
 * 채널 URL 이 있으면 그것을 우선 사용하고(정확),
 * 없으면 이름 검색으로 보조 조회합니다.
 */
async function resolveChannel({ channelUrl, streamerName }) {
  const id = extractChannelId(channelUrl);
  if (id) {
    const ch = await getChannelById(id);
    if (ch) return { status: "exact", channel: ch };
    return { status: "not_found", candidates: [] };
  }
  return await searchChannelByName(streamerName);
}

module.exports = {
  extractChannelId,
  getChannelById,
  searchChannelByName,
  resolveChannel,
  cleanName,
};
