/**
 * data.js 읽기/쓰기
 *
 * 승인 시 DB 가 아니라 data.js 를 갱신하고 Git 에 커밋합니다.
 * 이렇게 하면 공개 트래픽은 100% Netlify 정적 파일이 받고,
 * 서버가 죽어도 리더보드는 계속 서비스됩니다. (README 의 DB-less 판단 유지)
 *
 * ⚠ 이 파일은 운영 데이터를 직접 고칩니다.
 *   - 쓰기 전 항상 파싱 검증을 통과해야 합니다.
 *   - 색상표(STREAMER_COLORS)와 주석은 원본을 보존합니다.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const DATA_JS_PATH =
  process.env.DATA_JS_PATH ||
  path.join(__dirname, "..", "..", "data.js");

const ARRAY_NAMES = [
  "RECORD_DATA",
  "RETRY_DATA",
  "SHORTCUT_DATA",
  "SPEEDRUN_DATA",
];

/** data.js 를 평가해 배열들을 읽어옵니다. */
function readData(filePath = DATA_JS_PATH) {
  const src = fs.readFileSync(filePath, "utf8");
  const ctx = { __out: null };
  vm.createContext(ctx);
  vm.runInContext(
    `${src};__out={${ARRAY_NAMES.join(",")},STREAMER_COLORS,DEFAULT_COLOR};`,
    ctx,
    { timeout: 5000 },
  );
  return { src, ...ctx.__out };
}

/** 항목 하나를 data.js 표기로 직렬화 (기존 포맷과 동일하게) */
function serializeItem(item, indent = "  ") {
  const fields = [`name: ${JSON.stringify(item.name)}`];
  fields.push(`gameTime: ${JSON.stringify(item.gameTime)}`);
  if (item.tosTime !== undefined && item.tosTime !== null) {
    fields.push(`tosTime: ${JSON.stringify(item.tosTime)}`);
  }

  // 한 줄에 담기면 한 줄로, 길면 여러 줄로 (기존 파일 스타일과 동일)
  const oneLine = `${indent}{ ${fields.join(", ")} },`;
  if (oneLine.length <= 80) return oneLine;
  return (
    `${indent}{\n` +
    fields.map((f) => `${indent}  ${f},`).join("\n") +
    `\n${indent}},`
  );
}

/**
 * 지정한 배열에 항목을 추가한 새로운 data.js 소스를 만듭니다.
 * 원본의 다른 부분(색상표, 주석 등)은 건드리지 않습니다.
 */
function appendToArray(src, arrayName, item) {
  // `const NAME = [ ... ];` 블록의 닫는 `];` 위치를 찾습니다.
  const startRe = new RegExp(`const\\s+${arrayName}\\s*=\\s*\\[`);
  const startMatch = startRe.exec(src);
  if (!startMatch) {
    throw new Error(`data.js 에서 ${arrayName} 을(를) 찾을 수 없습니다.`);
  }

  // 대괄호 깊이를 세어 정확한 닫는 위치를 찾습니다(중첩 대비).
  let i = startMatch.index + startMatch[0].length;
  let depth = 1;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === "[") depth++;
    else if (ch === "]") depth--;
    else if (ch === '"' || ch === "'") {
      // 문자열 건너뛰기
      const quote = ch;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") i++;
        i++;
      }
    }
    i++;
  }
  if (depth !== 0) {
    throw new Error(`${arrayName} 배열의 끝을 찾지 못했습니다.`);
  }

  const closeIdx = i - 1; // ']' 위치
  const before = src.slice(0, closeIdx);
  const after = src.slice(closeIdx);

  // 마지막 항목 뒤에 쉼표가 없으면 붙입니다.
  // ⚠ 줄 끝 주석(`}, // 메모`)이 있을 수 있으므로 주석을 제외하고 판단해야 합니다.
  //   그냥 붙이면 "// 1시간 48분 39초," 처럼 주석 안에 쉼표가 들어갑니다.
  const trimmedBefore = before.replace(/\s*$/, "");
  const lines = trimmedBefore.split("\n");
  const lastLine = lines[lines.length - 1];
  const codePart = stripLineComment(lastLine).replace(/\s*$/, "");
  const needsComma = !codePart.endsWith(",") && !codePart.endsWith("[");

  if (needsComma) {
    // 주석은 그대로 두고 코드 부분에만 쉼표를 붙입니다.
    const commentIdx = findLineCommentIndex(lastLine);
    lines[lines.length - 1] =
      commentIdx === -1
        ? `${lastLine.replace(/\s*$/, "")},`
        : `${lastLine.slice(0, commentIdx).replace(/\s*$/, "")}, ${lastLine
            .slice(commentIdx)
            .trim()}`;
  }

  return `${lines.join("\n")}\n${serializeItem(item)}\n${after}`;
}

/** 문자열 리터럴 안의 //는 주석이 아니므로 따옴표를 감안해 찾습니다. */
function findLineCommentIndex(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
    } else if (ch === "/" && line[i + 1] === "/") {
      return i;
    }
  }
  return -1;
}

function stripLineComment(line) {
  const idx = findLineCommentIndex(line);
  return idx === -1 ? line : line.slice(0, idx);
}

/** 색상표에 항목 추가 (이미 있으면 그대로 둡니다) */
function addColor(src, name, color) {
  if (!color) return src;
  const startRe = /const\s+STREAMER_COLORS\s*=\s*\{/;
  const m = startRe.exec(src);
  if (!m) return src;

  // 이미 등록된 이름이면 건드리지 않습니다.
  const existing = new RegExp(
    `(^|\\n)\\s*(?:"${escapeRe(name)}"|${escapeRe(name)})\\s*:`,
  );
  if (existing.test(src)) return src;

  const insertAt = m.index + m[0].length;
  const key = /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
  return (
    src.slice(0, insertAt) +
    `\n  ${key}: ${JSON.stringify(color)},` +
    src.slice(insertAt)
  );
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 승인된 제출을 data.js 에 반영합니다.
 * 쓰기 전에 결과물을 다시 파싱해 검증하며, 실패하면 파일을 건드리지 않습니다.
 */
function applySubmission(submission, filePath = DATA_JS_PATH) {
  const { src } = readData(filePath);

  const item = { name: submission.name, gameTime: submission.gameTime };
  if (submission.tosTime) item.tosTime = submission.tosTime;

  let next = appendToArray(src, submission.arrayName, item);
  next = addColor(next, submission.name, submission.color);

  // 검증: 결과물이 정상적으로 평가되고 항목 수가 정확히 1 늘었는지
  const before = readData(filePath);
  const tmpCtx = { __out: null };
  vm.createContext(tmpCtx);
  try {
    vm.runInContext(
      `${next};__out={${ARRAY_NAMES.join(",")},STREAMER_COLORS};`,
      tmpCtx,
      { timeout: 5000 },
    );
  } catch (e) {
    throw new Error(`생성된 data.js 가 올바르지 않습니다: ${e.message}`);
  }

  const afterArr = tmpCtx.__out[submission.arrayName];
  const beforeArr = before[submission.arrayName];
  if (afterArr.length !== beforeArr.length + 1) {
    throw new Error(
      `항목 수가 맞지 않습니다 (${beforeArr.length} → ${afterArr.length}).`,
    );
  }
  const added = afterArr[afterArr.length - 1];
  if (added.name !== item.name || added.gameTime !== item.gameTime) {
    throw new Error("추가된 항목이 예상과 다릅니다.");
  }

  fs.writeFileSync(filePath, next, "utf8");
  return { added, total: afterArr.length };
}

/** 제출 종류 → data.js 배열 이름 */
function arrayNameFor(sub) {
  if (sub.kind === "speedrun") return "SPEEDRUN_DATA";
  if (sub.is_shortcut) return "SHORTCUT_DATA";
  if (sub.is_retry) return "RETRY_DATA";
  return "RECORD_DATA";
}

module.exports = {
  DATA_JS_PATH,
  readData,
  applySubmission,
  appendToArray,
  arrayNameFor,
  serializeItem,
};
