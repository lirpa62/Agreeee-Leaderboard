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

/**
 * 항목 하나를 data.js 표기로 직렬화 (기존 포맷과 동일하게)
 *
 * name/gameTime/tosTime 은 기존 209건과 같은 필수 표기이고,
 * addedAt 과 URL 들은 새 제출 파이프라인으로 들어온 건에만 붙습니다.
 * (네이버 폼 시절 기록에는 없는 정보라 값이 있을 때만 씁니다)
 */
function serializeItem(item, indent = "  ") {
  const fields = [`name: ${JSON.stringify(item.name)}`];
  fields.push(`gameTime: ${JSON.stringify(item.gameTime)}`);
  if (item.tosTime !== undefined && item.tosTime !== null) {
    fields.push(`tosTime: ${JSON.stringify(item.tosTime)}`);
  }
  // 'NEW' 배지 판정용 등록 시각 (ISO 8601 UTC)
  if (item.addedAt) {
    fields.push(`addedAt: ${JSON.stringify(item.addedAt)}`);
  }
  // 우클릭 메뉴에서 여는 증빙 링크
  for (const key of ["channelUrl", "clipUrl", "vodUrl"]) {
    if (item[key]) fields.push(`${key}: ${JSON.stringify(item[key])}`);
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
  //
  // ⚠ 두 가지 주석 형태를 모두 고려해야 합니다.
  //   1) 줄 끝 주석:  `}, // 1시간 48분 39초`
  //      → 주석 앞 코드에만 쉼표를 붙여야 합니다.
  //   2) 통째로 주석인 줄:  `// { name: "계춘회*", ... },`
  //      → 이 줄은 코드가 아니므로 건너뛰고, 그 위의 실제 코드 줄을 봐야 합니다.
  //      실제 data.js 에 이런 템플릿 주석이 4개 있으며, 잘못 처리하면
  //      `, // {...}` 가 되어 배열에 빈 요소가 생깁니다.
  const trimmedBefore = before.replace(/\s*$/, "");
  const lines = trimmedBefore.split("\n");

  // 뒤에서부터 '코드가 있는' 마지막 줄을 찾습니다.
  let idx = lines.length - 1;
  while (idx >= 0 && stripLineComment(lines[idx]).trim() === "") {
    idx--;
  }
  if (idx < 0) idx = lines.length - 1;

  const targetLine = lines[idx];
  const codePart = stripLineComment(targetLine).replace(/\s*$/, "");
  const needsComma = !codePart.endsWith(",") && !codePart.endsWith("[");

  if (needsComma) {
    // 주석은 그대로 두고 코드 부분에만 쉼표를 붙입니다.
    const commentIdx = findLineCommentIndex(targetLine);
    lines[idx] =
      commentIdx === -1
        ? `${targetLine.replace(/\s*$/, "")},`
        : `${targetLine.slice(0, commentIdx).replace(/\s*$/, "")}, ${targetLine
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
function addColor(src, name, color, { overwrite = false } = {}) {
  if (!color) return src;
  const startRe = /const\s+STREAMER_COLORS\s*=\s*\{/;
  const m = startRe.exec(src);
  if (!m) return src;

  // 이미 등록된 이름 처리.
  // 기본은 건드리지 않고, overwrite 일 때만 값을 교체합니다.
  const existing = new RegExp(
    `((?:^|\\n)\\s*)(?:"${escapeRe(name)}"|${escapeRe(name)})(\\s*:\\s*)(?:"[^"]*"|'[^']*')`,
  );
  const found = existing.exec(src);
  if (found) {
    if (!overwrite) return src;
    const key = /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
    return (
      src.slice(0, found.index) +
      `${found[1]}${key}${found[2]}${JSON.stringify(color)}` +
      src.slice(found.index + found[0].length)
    );
  }

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

  // 등록 시각과 증빙 링크. 승인 취소 시에는 이름+기록으로만 항목을 찾으므로
  // 이 필드들이 붙어도 removeFromArray 의 매칭에는 영향이 없습니다.
  item.addedAt = submission.addedAt || new Date().toISOString();
  for (const key of ["channelUrl", "clipUrl", "vodUrl"]) {
    if (submission[key]) item[key] = submission[key];
  }

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

/**
 * data.js 에서 항목 하나를 제거합니다. (승인 취소용)
 *
 * 승인 이후 다른 기록이 추가됐을 수 있으므로 위치가 아니라
 * 이름 + 기록으로 정확히 찾습니다. 여러 개가 걸리면 중단합니다.
 */
function removeFromArray(src, arrayName, item) {
  const startRe = new RegExp(`const\\s+${arrayName}\\s*=\\s*\\[`);
  const startMatch = startRe.exec(src);
  if (!startMatch) {
    throw new Error(`data.js 에서 ${arrayName} 을(를) 찾을 수 없습니다.`);
  }

  const arrStart = startMatch.index + startMatch[0].length;

  // 배열 본문 범위를 찾습니다 (appendToArray 와 같은 방식).
  let i = arrStart;
  let depth = 1;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === "[") depth++;
    else if (ch === "]") depth--;
    else if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") i++;
        i++;
      }
    }
    i++;
  }
  if (depth !== 0) throw new Error(`${arrayName} 배열의 끝을 찾지 못했습니다.`);
  const arrEnd = i - 1;

  const body = src.slice(arrStart, arrEnd);

  // 최상위 객체 리터럴 `{...}` 들의 범위를 수집합니다.
  const entries = [];
  let d = 0;
  let objStart = -1;
  for (let j = 0; j < body.length; j++) {
    const ch = body[j];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      j++;
      while (j < body.length && body[j] !== quote) {
        if (body[j] === "\\") j++;
        j++;
      }
      continue;
    }
    if (ch === "{") {
      if (d === 0) objStart = j;
      d++;
    } else if (ch === "}") {
      d--;
      if (d === 0 && objStart !== -1) {
        entries.push({ start: objStart, end: j + 1 });
        objStart = -1;
      }
    }
  }

  // 이름 + gameTime 이 모두 일치하는 항목을 찾습니다.
  const matches = entries.filter((e) => {
    const text = body.slice(e.start, e.end);
    let parsed;
    try {
      parsed = vm.runInNewContext(`(${text})`, {}, { timeout: 1000 });
    } catch {
      return false;
    }
    return (
      parsed &&
      parsed.name === item.name &&
      parsed.gameTime === item.gameTime &&
      (item.tosTime === undefined ||
        item.tosTime === null ||
        parsed.tosTime === item.tosTime)
    );
  });

  if (matches.length === 0) {
    throw new Error(
      `${arrayName} 에서 '${item.name}' (${item.gameTime}) 기록을 찾지 못했습니다. ` +
        `이미 수동으로 삭제되었을 수 있습니다.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `'${item.name}' (${item.gameTime}) 과 일치하는 기록이 ${matches.length}개 있습니다. ` +
        `자동 삭제가 위험하므로 직접 확인해 주세요.`,
    );
  }

  const m = matches[0];
  // 항목 앞의 공백/줄바꿈과 뒤따르는 쉼표·줄끝 주석까지 함께 지웁니다.
  let from = m.start;
  while (from > 0 && (body[from - 1] === " " || body[from - 1] === "\t")) from--;
  if (from > 0 && body[from - 1] === "\n") from--;

  let to = m.end;
  if (body[to] === ",") to++;
  // 줄 끝 주석이 남지 않도록 줄바꿈 직전까지 훑습니다.
  const restOfLine = body.slice(to, body.indexOf("\n", to) + 1 || undefined);
  if (/^[ \t]*\/\/[^\n]*$/.test(restOfLine.replace(/\n$/, ""))) {
    to += restOfLine.replace(/\n$/, "").length;
  }

  const newBody = body.slice(0, from) + body.slice(to);
  return src.slice(0, arrStart) + newBody + src.slice(arrEnd);
}

/**
 * 승인된 기록을 data.js 에서 제거합니다. (승인 취소)
 * 쓰기 전 재파싱으로 검증하며, 실패하면 파일을 건드리지 않습니다.
 *
 * ⚠ STREAMER_COLORS 항목은 일부러 남깁니다.
 *   같은 스트리머가 다른 리그(숏컷/재도전/스피드런)에도 올라가 있을 수 있어,
 *   색상을 지우면 남은 기록의 색이 기본값으로 바뀝니다.
 *   불필요한 색상은 나중에 수동으로 정리하면 됩니다.
 */
function revertSubmission(submission, filePath = DATA_JS_PATH) {
  const before = readData(filePath);

  const item = { name: submission.name, gameTime: submission.gameTime };
  if (submission.tosTime) item.tosTime = submission.tosTime;

  const next = removeFromArray(before.src, submission.arrayName, item);

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
  if (afterArr.length !== beforeArr.length - 1) {
    throw new Error(
      `항목 수가 맞지 않습니다 (${beforeArr.length} → ${afterArr.length}).`,
    );
  }
  // 다른 배열이 훼손되지 않았는지 확인
  for (const name of ARRAY_NAMES) {
    if (name === submission.arrayName) continue;
    if (tmpCtx.__out[name].length !== before[name].length) {
      throw new Error(`${name} 이(가) 함께 변경되었습니다. 중단합니다.`);
    }
  }

  fs.writeFileSync(filePath, next, "utf8");
  return { removed: item, total: afterArr.length };
}

/**
 * 리그별 이름 표기 규칙 (기존 data.js 실측 기준)
 *
 *  RETRY_DATA    : 13개 전부 이름 뒤에 '*'
 *                  → 재도전으로 인정받았음을 표시
 *  SHORTCUT_DATA : 78개 중 '🎈'는 13개뿐
 *                  → 재도전에 성공한 사람에게만 붙습니다.
 *                    같은 사람이 숏컷/재도전 두 리그에 모두 있을 때
 *                    구분하기 위한 표시이며, 재도전하지 않은
 *                    숏컷 유저 65명에게는 붙지 않습니다.
 *  RECORD_DATA / SPEEDRUN_DATA : 접미사 없음
 *
 * 그래서 숏컷 제출에 무조건 🎈를 붙이면 안 되고,
 * '재도전도 함께 등록되는 경우'에만 붙여야 합니다.
 */
function decorateName(rawName, { isRetry, isShortcut, hasRetryToo } = {}) {
  // 이미 붙어 있으면 중복해서 붙이지 않습니다.
  const base = String(rawName || "").trim();

  if (isRetry) {
    return base.includes("*") ? base : `${base}*`;
  }
  if (isShortcut && hasRetryToo) {
    return base.includes("🎈") ? base : `${base}🎈`;
  }
  return base;
}

/** 표기용 접미사를 떼어낸 순수 이름 */
function baseName(name) {
  return String(name || "")
    .replace(/\*/g, "")
    .replace(/🎈/g, "")
    .trim();
}

/* ───────────────────── 링크 조회·수정 (관리 화면용) ───────────────────── */

const URL_KEYS = ["channelUrl", "clipUrl", "vodUrl"];

/**
 * 모든 기록을 링크와 함께 나열합니다. (관리 화면 목록용)
 *
 * 항목을 나중에 다시 찾을 수 있도록 배열 이름과 위치를 함께 돌려줍니다.
 * 같은 이름이 여러 리그에 있을 수 있어 이름만으로는 특정할 수 없습니다.
 */
function listRecords(filePath = DATA_JS_PATH) {
  const data = readData(filePath);
  const out = [];
  for (const arrayName of ARRAY_NAMES) {
    data[arrayName].forEach((item, index) => {
      out.push({
        arrayName,
        index,
        name: item.name,
        gameTime: item.gameTime,
        tosTime: item.tosTime ?? null,
        addedAt: item.addedAt ?? null,
        channelUrl: item.channelUrl ?? "",
        clipUrl: item.clipUrl ?? "",
        vodUrl: item.vodUrl ?? "",
      });
    });
  }
  return out;
}

/**
 * 항목 하나의 링크를 수정합니다. (추가·변경·삭제 모두)
 *
 * 값이 빈 문자열이면 해당 필드를 지웁니다.
 * data.js 를 통째로 다시 쓰면 주석과 서식이 사라지므로,
 * 해당 항목의 텍스트 범위만 찾아 그 부분만 다시 씁니다.
 *
 * @param {string} arrayName  RECORD_DATA 등
 * @param {number} index      배열 내 위치
 * @param {object} urls       { channelUrl?, clipUrl?, vodUrl? }
 */
function updateRecordUrls(arrayName, index, urls, filePath = DATA_JS_PATH) {
  if (!ARRAY_NAMES.includes(arrayName)) {
    throw new Error(`알 수 없는 배열입니다: ${arrayName}`);
  }
  const before = readData(filePath);
  const target = before[arrayName]?.[index];
  if (!target) {
    throw new Error(`${arrayName}[${index}] 항목을 찾을 수 없습니다.`);
  }

  // 수정 후의 항목을 만들어 직렬화합니다.
  const next = { name: target.name, gameTime: target.gameTime };
  if (target.tosTime !== undefined && target.tosTime !== null) {
    next.tosTime = target.tosTime;
  }
  if (target.addedAt) next.addedAt = target.addedAt;
  for (const key of URL_KEYS) {
    // 전달되지 않은 키는 기존 값을 유지하고, 빈 문자열이면 지웁니다.
    const value = key in urls ? String(urls[key] || "").trim() : target[key];
    if (value) next[key] = value;
  }

  const src = before.src;
  const { start, end } = findItemRange(src, arrayName, index);
  const indent = " ".repeat(2);
  // serializeItem 은 끝에 쉼표를 붙이므로 떼어내고 원본 범위에 맞춥니다.
  const replacement = serializeItem(next, indent).replace(/,$/, "").trimStart();
  const updated = src.slice(0, start) + replacement + src.slice(end);

  // 쓰기 전에 결과물을 다시 평가해 검증합니다.
  const ctx = { __out: null };
  vm.createContext(ctx);
  try {
    vm.runInContext(`${updated};__out={${ARRAY_NAMES.join(",")}};`, ctx, {
      timeout: 5000,
    });
  } catch (e) {
    throw new Error(`생성된 data.js 가 올바르지 않습니다: ${e.message}`);
  }
  for (const key of ARRAY_NAMES) {
    if (ctx.__out[key].length !== before[key].length) {
      throw new Error(
        `${key} 개수가 달라졌습니다 (${before[key].length} → ${ctx.__out[key].length}).`,
      );
    }
  }
  // 기록 자체가 바뀌지 않았는지 확인합니다. 링크만 고쳐야 합니다.
  const after = ctx.__out[arrayName][index];
  if (after.name !== target.name || after.gameTime !== target.gameTime) {
    throw new Error("수정 결과가 예상과 다릅니다. 중단합니다.");
  }

  fs.writeFileSync(filePath, updated, "utf8");
  return after;
}

/**
 * 스트리머 색상을 추가하거나 변경합니다.
 *
 * STREAMER_COLORS 는 이름을 키로 쓰는 표라서, 같은 사람이 여러 리그에
 * 있어도 색은 하나입니다. 리그 표기(*, 🎈)가 붙은 키도 함께 쓰이므로
 * data.js 에 실제로 존재하는 키를 그대로 고칩니다.
 *
 * @param {string} name  data.js 의 색상표 키 (표기 접미사 포함)
 * @param {string} color #RGB 또는 #RRGGBB
 */
function setStreamerColor(name, color, filePath = DATA_JS_PATH) {
  const key = String(name || "").trim();
  if (!key) throw new Error("이름이 비어 있습니다.");
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(color || ""))) {
    throw new Error("색상 코드는 #RRGGBB 형식이어야 합니다. (예: #00FFA3)");
  }

  const before = readData(filePath);
  const next = addColor(before.src, key, color, { overwrite: true });
  if (next === before.src) {
    throw new Error("색상표를 수정하지 못했습니다.");
  }

  // 쓰기 전에 검증합니다. 색상표만 바뀌어야 하고 기록은 그대로여야 합니다.
  const ctx = { __out: null };
  vm.createContext(ctx);
  try {
    vm.runInContext(
      `${next};__out={${ARRAY_NAMES.join(",")},STREAMER_COLORS};`,
      ctx,
      { timeout: 5000 },
    );
  } catch (e) {
    throw new Error(`생성된 data.js 가 올바르지 않습니다: ${e.message}`);
  }
  for (const arrayName of ARRAY_NAMES) {
    if (ctx.__out[arrayName].length !== before[arrayName].length) {
      throw new Error(`${arrayName} 개수가 달라졌습니다.`);
    }
  }
  if (ctx.__out.STREAMER_COLORS[key] !== color) {
    throw new Error("색상이 예상대로 반영되지 않았습니다.");
  }

  fs.writeFileSync(filePath, next, "utf8");
  return { name: key, color, previous: before.STREAMER_COLORS?.[key] ?? null };
}

/**
 * 재도전이 함께 등록될 때, 기존 숏컷 기록의 이름에 '🎈' 를 붙입니다.
 *
 * 표기 규칙상 🎈는 '숏컷과 재도전 양쪽에 있는 사람' 을 구분하는 표시입니다.
 * 그런데 숏컷은 예전에 등록되고 재도전이 나중에 승인되는 경우가 많아,
 * 재도전을 승인하는 시점에 기존 숏컷 항목을 찾아 고쳐 주어야 합니다.
 * (실제로 이 처리가 없어 '연이', '계춘회' 두 건에 🎈가 빠져 있었습니다)
 *
 * @returns {{updated: boolean, name?: string, reason?: string}}
 */
function markShortcutBalloon(rawName, filePath = DATA_JS_PATH) {
  const target = baseName(rawName);
  if (!target) return { updated: false, reason: "이름이 비어 있습니다." };

  const before = readData(filePath);
  const matches = [];
  before.SHORTCUT_DATA.forEach((item, index) => {
    if (baseName(item.name) === target) matches.push({ item, index });
  });

  if (!matches.length) {
    return { updated: false, reason: "기존 숏컷 기록이 없습니다." };
  }
  if (matches.length > 1) {
    // 같은 사람이 숏컷에 여러 번 있을 일은 없습니다. 있으면 사람이 봐야 합니다.
    return {
      updated: false,
      reason: `숏컷 기록이 ${matches.length}개 있어 자동으로 고치지 않았습니다.`,
    };
  }

  const { item, index } = matches[0];
  if (item.name.includes("🎈")) {
    return { updated: false, reason: "이미 🎈가 붙어 있습니다." };
  }

  const nextName = `${item.name}🎈`;
  const next = { name: nextName, gameTime: item.gameTime };
  if (item.tosTime !== undefined && item.tosTime !== null) {
    next.tosTime = item.tosTime;
  }
  if (item.addedAt) next.addedAt = item.addedAt;
  for (const key of URL_KEYS) {
    if (item[key]) next[key] = item[key];
  }

  const src = before.src;
  const { start, end } = findItemRange(src, "SHORTCUT_DATA", index);
  const replacement = serializeItem(next, "  ").replace(/,$/, "").trimStart();
  const updated = src.slice(0, start) + replacement + src.slice(end);

  // 쓰기 전에 결과물을 검증합니다.
  const ctx = { __out: null };
  vm.createContext(ctx);
  try {
    vm.runInContext(`${updated};__out={${ARRAY_NAMES.join(",")}};`, ctx, {
      timeout: 5000,
    });
  } catch (e) {
    throw new Error(`생성된 data.js 가 올바르지 않습니다: ${e.message}`);
  }
  for (const key of ARRAY_NAMES) {
    if (ctx.__out[key].length !== before[key].length) {
      throw new Error(`${key} 개수가 달라졌습니다.`);
    }
  }
  const after = ctx.__out.SHORTCUT_DATA[index];
  if (after.name !== nextName || after.gameTime !== item.gameTime) {
    throw new Error("수정 결과가 예상과 다릅니다. 중단합니다.");
  }

  fs.writeFileSync(filePath, updated, "utf8");
  return { updated: true, name: nextName, previous: item.name, index };
}

/**
 * 재도전 기록이 사라지면 기존 숏컷 기록의 '🎈' 도 떼어냅니다.
 *
 * 🎈는 '재도전도 함께 있는 사람' 이라는 뜻이므로, 승인 취소나
 * 대기 되돌리기로 재도전이 없어지면 표시도 함께 없애야 합니다.
 * 단, 같은 사람의 다른 재도전 기록이 아직 남아 있으면 그대로 둡니다.
 */
function unmarkShortcutBalloon(rawName, filePath = DATA_JS_PATH) {
  const target = baseName(rawName);
  if (!target) return { updated: false, reason: "이름이 비어 있습니다." };

  const before = readData(filePath);

  // 다른 재도전 기록이 남아 있으면 🎈를 유지해야 합니다.
  const stillHasRetry = before.RETRY_DATA.some(
    (i) => baseName(i.name) === target,
  );
  if (stillHasRetry) {
    return { updated: false, reason: "다른 재도전 기록이 남아 있습니다." };
  }

  const matches = [];
  before.SHORTCUT_DATA.forEach((item, index) => {
    if (baseName(item.name) === target && item.name.includes("🎈")) {
      matches.push({ item, index });
    }
  });
  if (!matches.length) {
    return { updated: false, reason: "🎈가 붙은 숏컷 기록이 없습니다." };
  }
  if (matches.length > 1) {
    return {
      updated: false,
      reason: `숏컷 기록이 ${matches.length}개 있어 자동으로 고치지 않았습니다.`,
    };
  }

  const { item, index } = matches[0];
  const nextName = item.name.replace(/🎈/g, "");
  const next = { name: nextName, gameTime: item.gameTime };
  if (item.tosTime !== undefined && item.tosTime !== null) {
    next.tosTime = item.tosTime;
  }
  if (item.addedAt) next.addedAt = item.addedAt;
  for (const key of URL_KEYS) {
    if (item[key]) next[key] = item[key];
  }

  const src = before.src;
  const { start, end } = findItemRange(src, "SHORTCUT_DATA", index);
  const replacement = serializeItem(next, "  ").replace(/,$/, "").trimStart();
  const updated = src.slice(0, start) + replacement + src.slice(end);

  const ctx = { __out: null };
  vm.createContext(ctx);
  try {
    vm.runInContext(`${updated};__out={${ARRAY_NAMES.join(",")}};`, ctx, {
      timeout: 5000,
    });
  } catch (e) {
    throw new Error(`생성된 data.js 가 올바르지 않습니다: ${e.message}`);
  }
  for (const key of ARRAY_NAMES) {
    if (ctx.__out[key].length !== before[key].length) {
      throw new Error(`${key} 개수가 달라졌습니다.`);
    }
  }

  fs.writeFileSync(filePath, updated, "utf8");
  return { updated: true, name: nextName, previous: item.name, index };
}

/**
 * 배열의 index 번째 항목이 차지하는 텍스트 범위를 찾습니다.
 *
 * 원본에는 주석과 주석 처리된 항목이 섞여 있으므로,
 * 문자열·주석을 감안해 중괄호 깊이를 세며 실제 항목만 셉니다.
 */
function findItemRange(src, arrayName, index) {
  const startRe = new RegExp(`const\\s+${arrayName}\\s*=\\s*\\[`);
  const m = startRe.exec(src);
  if (!m) throw new Error(`data.js 에서 ${arrayName} 을(를) 찾을 수 없습니다.`);

  let i = m.index + m[0].length;
  let depth = 0;
  let count = -1;
  let itemStart = -1;
  let quote = null;
  let inLineComment = false;

  for (; i < src.length; i++) {
    const ch = src[i];

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      inLineComment = true;
      i++;
      continue;
    }

    if (ch === "{") {
      if (depth === 0) {
        count++;
        itemStart = i;
      }
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && count === index) {
        return { start: itemStart, end: i + 1 };
      }
    } else if (ch === "]" && depth === 0) {
      break; // 배열 끝
    }
  }
  throw new Error(`${arrayName}[${index}] 의 위치를 찾지 못했습니다.`);
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
  revertSubmission,
  appendToArray,
  removeFromArray,
  arrayNameFor,
  decorateName,
  baseName,
  serializeItem,
  listRecords,
  updateRecordUrls,
  markShortcutBalloon,
  unmarkShortcutBalloon,
  setStreamerColor,
};
