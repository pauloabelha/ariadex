const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CORE_DIR = path.resolve(__dirname, "..", "core");

const BANNED_PATTERNS = [
  /\bwindow\b/,
  /\bdocument\b/,
  /\bMutationObserver\b/,
  /\bHTMLElement\b/,
  /\bchrome\b/,
  /\bbrowser\b/
];

test("core layer does not reference DOM or extension APIs", () => {
  const files = fs.readdirSync(CORE_DIR).filter((name) => name.endsWith(".js"));
  assert.ok(files.length > 0, "expected core JS files");

  for (const fileName of files) {
    const fullPath = path.join(CORE_DIR, fileName);
    const source = fs.readFileSync(fullPath, "utf8");

    for (const pattern of BANNED_PATTERNS) {
      assert.equal(
        pattern.test(source),
        false,
        `core file ${fileName} contains forbidden pattern ${pattern}`
      );
    }
  }
});
