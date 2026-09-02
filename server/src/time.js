/**
 * 시간 입력 정규화
 *
 * 기존 data.js 표기를 그대로 유지해야 합니다.
 *   gameTime: "14분 54.62초"  (스피드런은 소수점 2자리까지 씀)
 *   tosTime:  "1시간 30분 54초"
 *
 * 폼에서는 시/분/초를 분리해 받으므로, 여기서 그 표기로 되돌립니다.
 */

/** 기존 index.js 의 parseTime 과 동일한 규칙 (분 단위 실수) */
function parseTime(str) {
  const s = String(str || "");
  const h = s.match(/(\d+)시간/) ? parseInt(s.match(/(\d+)시간/)[1], 10) : 0;
  const m = s.match(/(\d+)분/) ? parseInt(s.match(/(\d+)분/)[1], 10) : 0;
  const sec = s.match(/([\d.]+)초/) ? parseFloat(s.match(/([\d.]+)초/)[1]) : 0;
  return h * 60 + m + sec / 60;
}

/**
 * 시/분/초 → data.js 표기 문자열.
 * decimals=true 면 초를 소수점 2자리로 (스피드런/본게임 기록용).
 * 0인 단위는 생략하되, 전체가 0이면 "0초".
 */
function formatParts({ hours = 0, minutes = 0, seconds = 0 }, decimals = false) {
  const h = Math.max(0, Math.floor(Number(hours) || 0));
  const m = Math.max(0, Math.floor(Number(minutes) || 0));
  const rawSec = Math.max(0, Number(seconds) || 0);

  const parts = [];
  if (h > 0) parts.push(`${h}시간`);
  if (m > 0) parts.push(`${m}분`);

  if (decimals) {
    // "54.62초" 처럼 소수점 2자리 고정
    if (rawSec > 0 || parts.length === 0) {
      parts.push(`${rawSec.toFixed(2)}초`);
    }
  } else {
    const s = Math.floor(rawSec + 1e-9);
    if (s > 0 || parts.length === 0) parts.push(`${s}초`);
  }

  return parts.join(" ");
}

/** 폼 입력값 검증: 범위와 형식이 상식적인지 */
function validateParts({ hours, minutes, seconds }, label) {
  const h = Number(hours) || 0;
  const m = Number(minutes) || 0;
  const s = Number(seconds) || 0;

  if (![h, m, s].every((n) => Number.isFinite(n) && n >= 0)) {
    return `${label}: 시간 값은 0 이상의 숫자여야 합니다.`;
  }
  if (m >= 60) return `${label}: 분은 0~59 사이여야 합니다.`;
  if (s >= 60) return `${label}: 초는 0 이상 60 미만이어야 합니다.`;
  if (h > 100) return `${label}: 시간 값이 비정상적으로 큽니다.`;
  if (h === 0 && m === 0 && s === 0) return `${label}: 시간을 입력해 주세요.`;
  return null;
}

module.exports = { parseTime, formatParts, validateParts };
