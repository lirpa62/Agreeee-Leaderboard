/**
 * Cloudflare Turnstile 검증
 *
 * 공개 폼이라 무차별 제출을 막아야 합니다.
 * Turnstile 은 무료이고 대부분의 사용자에게 클릭조차 요구하지 않습니다.
 *
 * TURNSTILE_SECRET 이 설정되지 않으면 캡차를 건너뜁니다.
 * (로컬 개발 편의를 위한 것이며, 운영에서는 반드시 설정하세요.
 *  서버 시작 시 경고를 출력합니다.)
 */

const VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const SECRET = process.env.TURNSTILE_SECRET || "";
const TIMEOUT_MS = 8000;

/** 캡차가 켜져 있는지 */
function isEnabled() {
  return Boolean(SECRET);
}

/**
 * 토큰 검증.
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
async function verify(token, remoteIp) {
  if (!isEnabled()) return { ok: true, reason: "disabled" };

  const value = String(token || "").trim();
  if (!value) {
    return { ok: false, reason: "캡차 인증이 필요합니다." };
  }
  // Turnstile 토큰 길이 상한 (비정상적으로 긴 입력 차단)
  if (value.length > 2048) {
    return { ok: false, reason: "캡차 토큰이 올바르지 않습니다." };
  }

  const body = new URLSearchParams();
  body.set("secret", SECRET);
  body.set("response", value);
  if (remoteIp) body.set("remoteip", remoteIp);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, reason: "캡차 검증 서버 응답 오류입니다." };
    }
    const json = await res.json();
    if (json.success === true) return { ok: true };

    const codes = Array.isArray(json["error-codes"]) ? json["error-codes"] : [];

    // 서버 설정 오류는 사용자가 아무리 다시 시도해도 풀리지 않으므로 로그를 남깁니다.
    if (
      codes.includes("invalid-input-secret") ||
      codes.includes("missing-input-secret")
    ) {
      console.error(
        "[캡차] TURNSTILE_SECRET 이 올바르지 않습니다. 설정을 확인하세요.",
        codes,
      );
      return { ok: false, reason: "캡차 설정 오류입니다. 관리자에게 문의해 주세요." };
    }

    // 토큰 재사용/만료 — 다시 인증하면 해결됩니다.
    if (codes.includes("timeout-or-duplicate")) {
      return {
        ok: false,
        reason: "캡차가 만료되었습니다. 다시 인증한 뒤 제출해 주세요.",
      };
    }
    return {
      ok: false,
      reason: "캡차 인증에 실패했습니다. 다시 인증한 뒤 제출해 주세요.",
    };
  } catch (e) {
    // 네트워크 실패 시 통과시키면 캡차가 무력화되므로 막습니다.
    return {
      ok: false,
      reason:
        e.name === "AbortError"
          ? "캡차 검증이 지연되었습니다. 잠시 후 다시 시도해 주세요."
          : "캡차 검증 중 오류가 발생했습니다.",
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { verify, isEnabled };
