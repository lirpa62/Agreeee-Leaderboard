const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const dataFile = require("../src/dataFile");

function fixture() {
  return `const STREAMER_COLORS = {
  Sample: "#123456",
};
const DEFAULT_COLOR = "#cccccc";
const RECORD_DATA = [];
const RETRY_DATA = [];
const SHORTCUT_DATA = [
  { name: "Sample", gameTime: "10분", tosTime: "20분" },
];
const SPEEDRUN_DATA = [];
`;
}

test("markShortcutBalloon preserves the existing streamer color", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agreeee-data-"));
  const filePath = path.join(dir, "data.js");
  fs.writeFileSync(filePath, fixture(), "utf8");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const result = dataFile.markShortcutBalloon("Sample", filePath);
  const updated = dataFile.readData(filePath);

  assert.equal(result.updated, true);
  assert.equal(updated.SHORTCUT_DATA[0].name, "Sample🎈");
  assert.equal(updated.STREAMER_COLORS.Sample, "#123456");
  assert.equal(updated.STREAMER_COLORS["Sample🎈"], "#123456");
});
