#!/usr/bin/env node
/**
 * 기존 기록에 채널 주소(및 수동 수집한 클립·다시보기 주소)를 채워 넣습니다.
 *
 * 새 제출 파이프라인으로 들어온 기록은 승인할 때 URL 이 함께 기록되지만,
 * 네이버 폼으로 받던 시절의 205건에는 아무 링크도 없습니다.
 * 이 스크립트로 한 번에 보강합니다.
 *
 * ⚠ 채널 주소는 치지직 검색으로 자동 조회하지만, 동명이인·표기 차이 때문에
 *   틀릴 수 있습니다. 그래서 기본은 '검토용 파일 생성'까지만 하고,
 *   실제 data.js 수정은 사람이 확인한 뒤 --apply 로 따로 실행합니다.
 *
 * 사용법:
 *   1) 채널 주소 자동 조회 → 검토용 파일 생성
 *      node scripts/backfill-urls.js --lookup
 *
 *   2) url-backfill.json 을 열어 confirmed 를 직접 확인/수정
 *      (clipUrl, vodUrl 을 알고 있다면 여기에 함께 적으면 됩니다)
 *
 *   3) 확인이 끝나면 data.js 에 반영
 *      node scripts/backfill-urls.js --apply
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ARRAY_NAMES = [
  "RECORD_DATA",
  "RETRY_DATA",
  "SHORTCUT_DATA",
  "SPEEDRUN_DATA",
];

const DATA_JS =
  process.env.DATA_JS_PATH || path.join(__dirname, "..", "..", "data.js");
const OUT_FILE = path.join(__dirname, "url-backfill.json");

// 치지직 비공식 API 는 인증은 필요 없지만 브라우저 UA 를 요구합니다.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function readData(filePath) {
  const src = fs.readFileSync(filePath, "utf8");
  const ctx = { __out: null };
  vm.createContext(ctx);
  vm.runInContext(`${src};__out={${ARRAY_NAMES.join(",")}};`, ctx, {
    timeout: 5000,
  });
  return { src, ...ctx.__out };
}

/** data.js 표기의 장식(재도전 *, 숏컷 🎈)을 떼어낸 실제 이름 */
function cleanName(name) {
  return String(name).replace(/[*🎈]/g, "").trim();
}

/* ─────────────────────── 1단계: 채널 주소 조회 ─────────────────────── */

async function searchChannel(name) {
  const url =
    "https://api.chzzk.naver.com/service/v1/search/channels" +
    `?keyword=${encodeURIComponent(name)}&size=5`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const list = json?.content?.data || [];
  return list.map((d) => ({
    channelId: d.channel?.channelId,
    channelName: d.channel?.channelName,
    followerCount: d.channel?.followerCount,
  }));
}

async function lookup() {
  const data = readData(DATA_JS);

  // 같은 스트리머가 여러 리그에 있으므로 이름 기준으로 한 번만 조회합니다.
  const names = new Set();
  for (const key of ARRAY_NAMES) {
    for (const item of data[key]) names.add(cleanName(item.name));
  }
  const sorted = [...names].sort();
  console.log(`고유 스트리머 ${sorted.length}명 조회를 시작합니다.\n`);

  // 이미 만들어 둔 결과가 있으면 이어서 진행합니다(중단 후 재실행 대비).
  let prev = {};
  if (fs.existsSync(OUT_FILE)) {
    prev = JSON.parse(fs.readFileSync(OUT_FILE, "utf8"));
    console.log(`기존 ${Object.keys(prev).length}건을 이어서 사용합니다.\n`);
  }

  const out = { ...prev };
  let exact = 0;
  let ambiguous = 0;
  let notFound = 0;

  for (let i = 0; i < sorted.length; i++) {
    const name = sorted[i];
    // 사람이 이미 확인한 항목은 다시 조회하지 않습니다.
    if (out[name]?.confirmed) {
      exact++;
      continue;
    }

    let candidates = [];
    let error = null;
    try {
      candidates = await searchChannel(name);
    } catch (e) {
      error = e.message;
    }

    // 이름이 정확히 같은 채널이 하나뿐이면 그것으로 확정합니다.
    //
    // ⚠ 사칭 채널이 실제로 존재합니다. 예를 들어 '풍월량' 을 검색하면
    //   진짜(팔로워 25만)와 사칭(팔로워 22) 이 둘 다 이름이 정확히 같고,
    //   '서새봄' 은 진짜가 '서새봄냥 SEBOM' 이라 정확히 일치하지 않습니다.
    //   그래서 정확 일치가 여럿이면 자동 확정하지 않고 사람에게 넘깁니다.
    //   이 리더보드는 10,000 팔로우 이상만 등재하므로, 그 미만은 후보에서
    //   제외해 사칭 채널이 잘못 확정되는 일을 막습니다.
    const MIN_FOLLOWERS = 10000;
    const plausible = candidates.filter(
      (c) => (c.followerCount ?? 0) >= MIN_FOLLOWERS,
    );
    const hits = plausible.filter((c) => c.channelName === name);
    const pick = hits.length === 1 ? hits[0] : null;

    if (pick) exact++;
    else if (candidates.length) ambiguous++;
    else notFound++;

    out[name] = {
      // 확정된 경우에만 채워 둡니다. null 이면 사람이 골라야 합니다.
      confirmed: pick
        ? `https://chzzk.naver.com/${pick.channelId}`
        : null,
      // 판단 근거를 남겨 둡니다. 팔로워가 많은 순으로 정렬해 두면
      // 사람이 고를 때 진짜 채널이 맨 위에 옵니다.
      candidates: candidates
        .slice()
        .sort((a, b) => (b.followerCount ?? 0) - (a.followerCount ?? 0))
        .map((c) => ({
          name: c.channelName,
          followers: c.followerCount,
          url: `https://chzzk.naver.com/${c.channelId}`,
        })),
      ...(error ? { error } : {}),
      // 아는 경우 직접 채워 넣으세요. 비어 있으면 건너뜁니다.
      clipUrl: out[name]?.clipUrl || "",
      vodUrl: out[name]?.vodUrl || "",
    };

    const mark = pick ? "✅" : candidates.length ? "❓" : "❌";
    console.log(
      `[${String(i + 1).padStart(3)}/${sorted.length}] ${mark} ${name}` +
        (pick ? ` → ${pick.channelId}` : ` (후보 ${candidates.length}개)`),
    );

    // 조회가 몰리지 않게 간격을 둡니다.
    await new Promise((r) => setTimeout(r, 300));

    // 중간에 끊겨도 결과가 남도록 자주 저장합니다.
    if (i % 10 === 0) {
      fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), "utf8");
    }
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), "utf8");

  console.log(
    `\n완료 — 자동 확정 ${exact}건 / 확인 필요 ${ambiguous}건 / 못 찾음 ${notFound}건`,
  );
  console.log(`\n검토용 파일: ${OUT_FILE}`);
  console.log(
    `confirmed 가 null 인 항목을 candidates 를 보고 채운 뒤,\n` +
      `  node scripts/backfill-urls.js --apply\n` +
      `를 실행하면 data.js 에 반영됩니다.`,
  );
}

/* ─────────────────────── 2단계: data.js 에 반영 ─────────────────────── */

/**
 * 항목 하나에 URL 필드를 끼워 넣습니다.
 *
 * data.js 를 통째로 다시 쓰면 주석과 서식이 사라지므로,
 * 원본 텍스트에서 해당 항목만 찾아 필드를 덧붙입니다.
 */
function injectFields(src, item, urls) {
  // 이 항목의 시작 위치를 name 으로 찾습니다.
  // 이름은 유니크하지 않을 수 있으니 gameTime 까지 함께 확인합니다.
  const nameLit = JSON.stringify(item.name);
  const timeLit = JSON.stringify(item.gameTime);

  let from = 0;
  while (true) {
    const idx = src.indexOf(nameLit, from);
    if (idx === -1) return null;

    // 이 항목이 끝나는 `}` 위치를 찾습니다.
    const open = src.lastIndexOf("{", idx);
    const close = src.indexOf("}", idx);
    if (open === -1 || close === -1) return null;

    const body = src.slice(open, close);
    if (!body.includes(timeLit)) {
      from = idx + nameLit.length;
      continue;
    }
    // 이미 링크가 있으면 건너뜁니다(두 번 실행해도 안전).
    if (body.includes("channelUrl:")) return null;

    const fields = [];
    for (const key of ["channelUrl", "clipUrl", "vodUrl"]) {
      if (urls[key]) fields.push(`${key}: ${JSON.stringify(urls[key])}`);
    }
    if (!fields.length) return null;

    // 원본이 한 줄인지 여러 줄인지에 맞춰 붙입니다.
    const isMultiline = body.includes("\n");
    const insert = isMultiline
      ? fields.map((f) => `\n    ${f},`).join("")
      : `, ${fields.join(", ")}`;

    const before = src.slice(0, close).replace(/,?\s*$/, isMultiline ? "," : "");
    return before + insert + src.slice(close).replace(/^/, isMultiline ? "\n  " : " ");
  }
}

function apply() {
  if (!fs.existsSync(OUT_FILE)) {
    console.error(
      `${OUT_FILE} 이 없습니다. 먼저 --lookup 으로 조회하세요.`,
    );
    process.exit(1);
  }

  const table = JSON.parse(fs.readFileSync(OUT_FILE, "utf8"));
  const before = readData(DATA_JS);
  let src = before.src;

  let applied = 0;
  let skipped = 0;

  for (const key of ARRAY_NAMES) {
    for (const item of before[key]) {
      const entry = table[cleanName(item.name)];
      if (!entry) {
        skipped++;
        continue;
      }
      const urls = {
        channelUrl: entry.confirmed || "",
        clipUrl: entry.clipUrl || "",
        vodUrl: entry.vodUrl || "",
      };
      if (!urls.channelUrl && !urls.clipUrl && !urls.vodUrl) {
        skipped++;
        continue;
      }
      const next = injectFields(src, item, urls);
      if (next) {
        src = next;
        applied++;
      } else {
        skipped++;
      }
    }
  }

  // 쓰기 전에 결과물이 정상인지, 항목 수가 그대로인지 확인합니다.
  const ctx = { __out: null };
  vm.createContext(ctx);
  try {
    vm.runInContext(`${src};__out={${ARRAY_NAMES.join(",")}};`, ctx, {
      timeout: 5000,
    });
  } catch (e) {
    console.error(`생성된 data.js 가 올바르지 않습니다: ${e.message}`);
    process.exit(1);
  }
  for (const key of ARRAY_NAMES) {
    if (ctx.__out[key].length !== before[key].length) {
      console.error(
        `${key} 개수가 달라졌습니다 (${before[key].length} → ${ctx.__out[key].length}). 중단합니다.`,
      );
      process.exit(1);
    }
  }

  fs.writeFileSync(DATA_JS, src, "utf8");
  console.log(`반영 완료 — ${applied}건 추가, ${skipped}건 건너뜀`);
  console.log(`\ngit diff data.js 로 확인한 뒤 커밋하세요.`);
}

/* ──────────────────────────────────────────────────────────────────── */

const mode = process.argv[2];
if (mode === "--lookup") {
  lookup().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else if (mode === "--apply") {
  apply();
} else {
  console.log(
    `사용법:\n` +
      `  node scripts/backfill-urls.js --lookup   채널 주소 자동 조회\n` +
      `  node scripts/backfill-urls.js --apply    data.js 에 반영`,
  );
}
