"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const { DEFAULT_CATALOG_PATH, syncCatalogFromFixtures, loadCatalog } = require("../research/fixture_catalog.js");
const {
  DEFAULT_OUTPUT_DIR,
  renderConversationGraphReport
} = require("./render_conversation_graph_report.js");

function parseArgs(argv = []) {
  const args = {
    catalog: DEFAULT_CATALOG_PATH,
    outputDir: DEFAULT_OUTPUT_DIR,
    indexPath: null,
    sync: true,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || "");
    const next = index + 1 < argv.length ? argv[index + 1] : null;
    const readValue = () => {
      index += 1;
      return next;
    };

    if (token === "--help" || token === "-h") {
      args.help = true;
    } else if (token === "--catalog") {
      args.catalog = String(readValue() || "").trim() || DEFAULT_CATALOG_PATH;
    } else if (token === "--output-dir") {
      args.outputDir = String(readValue() || "").trim() || DEFAULT_OUTPUT_DIR;
    } else if (token === "--index-path") {
      args.indexPath = String(readValue() || "").trim() || null;
    } else if (token === "--no-sync") {
      args.sync = false;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

function usage() {
  return [
    "Usage: node scripts/render_conversation_graph_gallery.js [options]",
    "",
    "Options:",
    "  --catalog <path>       Fixture catalog JSON",
    "  --output-dir <dir>     Directory for generated graph reports",
    "  --index-path <path>    Explicit gallery HTML path",
    "  --no-sync              Do not refresh the fixture catalog from disk first",
    "  --help                 Show this message"
  ].join("\n");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
}

function defaultIndexPath(outputDir) {
  return path.join(path.resolve(outputDir), "index.html");
}

function summarizeLabel(record = {}) {
  const root = String(record.canonicalRootId || "").trim() || "unknown-root";
  const explored = String(record.exploredTweetId || "").trim() || "unknown-tweet";
  const count = Number(record.tweetCount || 0);
  return `${root} · explored ${explored} · ${count} tweets`;
}

function buildGalleryHtml({ fixtures, generatedAt }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ariadex Graph Gallery</title>
  <style>
    :root {
      --bg: #f5efe6;
      --panel: rgba(255, 251, 244, 0.94);
      --ink: #1f1b17;
      --muted: #6d655c;
      --line: #d8cfc2;
      --accent: #bc5b3c;
      --shadow: 0 14px 44px rgba(71, 48, 18, 0.12);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      background:
        radial-gradient(circle at top right, rgba(188, 91, 60, 0.14), transparent 28%),
        linear-gradient(180deg, #f7f2ea 0%, #efe7dc 100%);
      font-family: "Iowan Old Style", Georgia, serif;
    }
    .shell {
      max-width: 1480px;
      margin: 0 auto;
      padding: 18px;
      display: grid;
      grid-template-columns: 360px minmax(0, 1fr);
      gap: 16px;
      min-height: 100vh;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 24px;
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .sidebar {
      padding: 18px;
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr);
      gap: 14px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 34px;
      line-height: 1;
    }
    p {
      margin: 0;
      color: var(--muted);
      line-height: 1.45;
    }
    .search {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 12px 14px;
      font: inherit;
      background: rgba(255,255,255,0.88);
      color: var(--ink);
    }
    .list {
      display: grid;
      gap: 10px;
      overflow: auto;
      padding-right: 4px;
    }
    .card {
      border: 1px solid var(--line);
      border-radius: 18px;
      background: rgba(255,253,248,0.84);
      padding: 14px;
      cursor: pointer;
    }
    .card.active {
      border-color: #b98c74;
      box-shadow: 0 10px 24px rgba(71, 48, 18, 0.1);
      background: rgba(255,248,242,0.94);
    }
    .card-title {
      font-weight: 700;
      font-size: 14px;
      line-height: 1.25;
    }
    .card-meta {
      margin-top: 8px;
      font-size: 12px;
      color: var(--muted);
    }
    .card-text {
      margin-top: 8px;
      font-size: 13px;
      color: var(--muted);
      line-height: 1.35;
    }
    .viewer {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      min-height: 80vh;
    }
    .viewer-header {
      padding: 16px 18px;
      border-bottom: 1px solid var(--line);
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
    }
    .viewer-title {
      font-size: 16px;
      font-weight: 700;
    }
    .viewer-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 14px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.84);
      color: var(--ink);
      text-decoration: none;
      padding: 10px 12px;
      font-size: 13px;
      font-weight: 600;
    }
    iframe {
      width: 100%;
      height: 100%;
      min-height: 860px;
      border: 0;
      background: white;
    }
    .empty {
      padding: 24px;
      color: var(--muted);
    }
    @media (max-width: 1000px) {
      .shell {
        grid-template-columns: 1fr;
      }
      iframe {
        min-height: 640px;
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <aside class="panel sidebar">
      <section>
        <h1>Graph Gallery</h1>
        <p>Pick any persisted full-graph fixture and load its interactive conversation graph. Generated ${escapeHtml(generatedAt)}.</p>
      </section>
      <section>
        <input id="search" class="search" type="search" placeholder="search by root id, explored id, text, or path">
      </section>
      <section id="fixture-list" class="list"></section>
    </aside>
    <section class="panel viewer">
      <div class="viewer-header">
        <div>
          <div id="viewer-title" class="viewer-title">Select a persisted graph</div>
          <p id="viewer-subtitle"></p>
        </div>
        <div class="viewer-actions">
          <a id="open-report" class="button" href="#" target="_blank" rel="noreferrer">Open report</a>
          <a id="open-fixture" class="button" href="#" target="_blank" rel="noreferrer">Open fixture JSON</a>
        </div>
      </div>
      <iframe id="viewer-frame" title="Ariadex conversation graph viewer"></iframe>
      <div id="empty-state" class="empty" hidden>No persisted graph selected.</div>
    </section>
  </main>
  <script>
    const FIXTURES = ${safeJson(fixtures)};

    const searchEl = document.getElementById("search");
    const listEl = document.getElementById("fixture-list");
    const frameEl = document.getElementById("viewer-frame");
    const emptyEl = document.getElementById("empty-state");
    const viewerTitleEl = document.getElementById("viewer-title");
    const viewerSubtitleEl = document.getElementById("viewer-subtitle");
    const openReportEl = document.getElementById("open-report");
    const openFixtureEl = document.getElementById("open-fixture");

    let selectedReportPath = FIXTURES[0]?.reportPath || null;

    function truncate(text, limit = 140) {
      const value = String(text || "").trim();
      if (value.length <= limit) {
        return value;
      }
      return value.slice(0, Math.max(0, limit - 1)).trimEnd() + "…";
    }

    function escapeInline(value) {
      return String(value || "").replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char]));
    }

    function setSelection(record) {
      selectedReportPath = record?.reportPath || null;
      if (!record) {
        frameEl.hidden = true;
        emptyEl.hidden = false;
        viewerTitleEl.textContent = "Select a persisted graph";
        viewerSubtitleEl.textContent = "";
        openReportEl.href = "#";
        openFixtureEl.href = "#";
        return;
      }
      frameEl.hidden = false;
      emptyEl.hidden = true;
      frameEl.src = record.reportPath;
      viewerTitleEl.textContent = record.label;
      viewerSubtitleEl.textContent = "captured " + (record.capturedAt || "unknown") + " · " + record.fixturePath;
      openReportEl.href = record.reportPath;
      openFixtureEl.href = record.fixturePath;
    }

    function renderList() {
      const query = searchEl.value.trim().toLowerCase();
      const filtered = FIXTURES.filter((record) => {
        if (!query) {
          return true;
        }
        const haystack = [
          record.label,
          record.fixturePath,
          record.canonicalRootId,
          record.exploredTweetId,
          record.rootTextPreview,
          record.exploredTextPreview
        ].join(" ").toLowerCase();
        return haystack.includes(query);
      });

      listEl.innerHTML = filtered.map((record) => \`
        <article class="card \${record.reportPath === selectedReportPath ? "active" : ""}" data-report-path="\${record.reportPath}">
          <div class="card-title">\${escapeInline(record.label)}</div>
          <div class="card-meta">captured \${escapeInline(record.capturedAt || "unknown")} · \${escapeInline(String(record.tweetCount || 0))} tweets · root <code>\${escapeInline(record.canonicalRootId || "")}</code></div>
          <div class="card-text">\${escapeInline(truncate(record.exploredTextPreview || record.rootTextPreview || "No preview available.", 150))}</div>
        </article>
      \`).join("") || "<p>No persisted graphs matched your search.</p>";

      listEl.querySelectorAll("[data-report-path]").forEach((element) => {
        element.addEventListener("click", () => {
          const record = FIXTURES.find((entry) => entry.reportPath === element.getAttribute("data-report-path")) || null;
          setSelection(record);
          renderList();
        });
      });
    }

    searchEl.addEventListener("input", renderList);

    setSelection(FIXTURES[0] || null);
    renderList();
  </script>
</body>
</html>`;
}

async function renderConversationGraphGallery(rawArgs = process.argv.slice(2)) {
  const args = parseArgs(rawArgs);
  if (args.help) {
    return {
      exitCode: 0,
      stdout: `${usage()}\n`
    };
  }

  const catalogPath = path.resolve(args.catalog);
  if (args.sync) {
    await syncCatalogFromFixtures({ catalogPath });
  }
  const catalog = await loadCatalog(catalogPath);
  const fixtures = Array.isArray(catalog?.fixtures) ? catalog.fixtures : [];

  const generatedFixtures = [];
  for (const record of fixtures) {
    const fixturePath = String(record?.fixturePath || "").trim();
    if (!fixturePath) {
      continue;
    }
    const report = await renderConversationGraphReport([
      "--fixture",
      fixturePath,
      "--output-dir",
      path.resolve(args.outputDir)
    ]);
    generatedFixtures.push({
      ...record,
      label: summarizeLabel(record),
      reportPath: report.outputPath
    });
  }

  const indexPath = args.indexPath
    ? path.resolve(args.indexPath)
    : defaultIndexPath(args.outputDir);

  const html = buildGalleryHtml({
    fixtures: generatedFixtures,
    generatedAt: new Date().toISOString()
  });
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, `${html}\n`, "utf8");

  return {
    exitCode: 0,
    indexPath,
    fixtureCount: generatedFixtures.length
  };
}

async function main() {
  try {
    const result = await renderConversationGraphGallery(process.argv.slice(2));
    if (result?.stdout) {
      process.stdout.write(result.stdout);
      return;
    }
    process.stdout.write(`${result.indexPath}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}

module.exports = {
  buildGalleryHtml,
  parseArgs,
  renderConversationGraphGallery,
  usage
};
