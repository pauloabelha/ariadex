"use strict";

const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const { loadConversationDataset } = require("../data/conversation_dataset_source.js");
const { DEFAULT_CATALOG_PATH, loadCatalog, syncCatalogFromFixtures } = require("../research/fixture_catalog.js");
const { buildGraphPayload, buildHtmlReport } = require("./render_conversation_graph_report.js");

const DEFAULT_PORT = 8792;

function sendJson(res, statusCode, value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(html);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(String(text || ""));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function galleryHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ariadex Live Graph Gallery</title>
  <style>
    :root {
      --bg: #f3f2ee;
      --panel: rgba(255, 255, 252, 0.94);
      --ink: #111111;
      --muted: #68707c;
      --line: #d8dde6;
      --accent: #ff5a36;
      --reply: #1473e6;
      --shadow: 0 18px 52px rgba(17, 17, 17, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      background:
        radial-gradient(circle at top right, rgba(255, 90, 54, 0.08), transparent 24%),
        radial-gradient(circle at left 18%, rgba(20, 115, 230, 0.06), transparent 18%),
        linear-gradient(180deg, #f8f8f5 0%, #eceff3 100%);
      font-family: "SF Pro Display", "Avenir Next", "Helvetica Neue", Arial, sans-serif;
    }
    .shell {
      max-width: 1600px;
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
      grid-template-rows: auto auto auto minmax(0, 1fr);
      gap: 14px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 34px;
      line-height: 1;
      letter-spacing: -0.03em;
    }
    h2 {
      margin: 0;
      font-size: 16px;
    }
    p {
      margin: 0;
      color: var(--muted);
      line-height: 1.45;
    }
    .search, .button {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 12px 14px;
      font: inherit;
      background: rgba(255,255,255,0.88);
      color: var(--ink);
    }
    .button {
      cursor: pointer;
      font-weight: 600;
    }
    .button.primary {
      background: var(--accent);
      border-color: transparent;
      color: white;
    }
    .button-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .list {
      display: grid;
      gap: 10px;
      overflow: auto;
      padding-right: 4px;
    }
    .fixture-card {
      border: 1px solid var(--line);
      border-radius: 18px;
      background: rgba(255,255,255,0.78);
      padding: 14px;
      cursor: pointer;
    }
    .fixture-card.active {
      border-color: #f1a48e;
      box-shadow: 0 10px 24px rgba(17, 17, 17, 0.08);
      background: rgba(255,248,244,0.92);
    }
    .fixture-title {
      font-size: 14px;
      font-weight: 700;
      line-height: 1.25;
    }
    .fixture-meta {
      margin-top: 8px;
      font-size: 12px;
      color: var(--muted);
    }
    .fixture-preview {
      margin-top: 8px;
      font-size: 13px;
      color: var(--muted);
      line-height: 1.35;
    }
    .viewer {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      min-height: 84vh;
    }
    .viewer-header {
      padding: 16px 18px;
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .viewer-title {
      font-size: 18px;
      font-weight: 700;
    }
    .viewer-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .viewer-actions a {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 10px 12px;
      background: rgba(255,255,255,0.86);
      color: var(--ink);
      text-decoration: none;
      font-size: 13px;
      font-weight: 600;
    }
    iframe {
      width: 100%;
      height: 100%;
      min-height: 920px;
      border: 0;
      background: white;
    }
    .status {
      min-height: 20px;
      font-size: 13px;
      color: var(--muted);
    }
    .empty {
      padding: 24px;
      color: var(--muted);
    }
    code {
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 12px;
    }
    @media (max-width: 1080px) {
      .shell {
        grid-template-columns: 1fr;
      }
      iframe {
        min-height: 680px;
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <aside class="panel sidebar">
      <section>
        <h1>Live Graphs</h1>
        <p>Pick any persisted fixture and load the interactive graph live. No manual file opening needed.</p>
      </section>
      <section>
        <input id="search" class="search" type="search" placeholder="search root id, explored id, text, or path">
      </section>
      <section class="button-row">
        <button id="refresh" class="button">Refresh Catalog</button>
        <button id="reload" class="button primary">Reload Graph</button>
      </section>
      <section>
        <div id="status" class="status"></div>
      </section>
      <section id="fixture-list" class="list"></section>
    </aside>
    <section class="panel viewer">
      <div class="viewer-header">
        <div>
          <div id="viewer-title" class="viewer-title">Select a persisted fixture</div>
          <p id="viewer-subtitle"></p>
        </div>
        <div class="viewer-actions">
          <a id="open-graph" href="#" target="_blank" rel="noreferrer">Open Graph</a>
          <a id="open-json" href="#" target="_blank" rel="noreferrer">Open Fixture JSON</a>
        </div>
      </div>
      <iframe id="viewer-frame" title="Ariadex live graph viewer"></iframe>
      <div id="empty" class="empty" hidden>No persisted fixture selected.</div>
    </section>
  </main>
  <script>
    const searchEl = document.getElementById("search");
    const refreshEl = document.getElementById("refresh");
    const reloadEl = document.getElementById("reload");
    const statusEl = document.getElementById("status");
    const fixtureListEl = document.getElementById("fixture-list");
    const viewerFrameEl = document.getElementById("viewer-frame");
    const viewerTitleEl = document.getElementById("viewer-title");
    const viewerSubtitleEl = document.getElementById("viewer-subtitle");
    const openGraphEl = document.getElementById("open-graph");
    const openJsonEl = document.getElementById("open-json");
    const emptyEl = document.getElementById("empty");

    let fixtures = [];
    let selectedFixturePath = "";

    function setStatus(text) {
      statusEl.textContent = text || "";
    }

    function truncate(text, limit = 150) {
      const value = String(text || "").trim();
      if (value.length <= limit) {
        return value;
      }
      return value.slice(0, Math.max(0, limit - 1)).trimEnd() + "…";
    }

    function escapeInline(value) {
      return String(value || "").replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char]));
    }

    function graphUrlForFixturePath(fixturePath) {
      const params = new URLSearchParams({ fixturePath });
      return "/graph?" + params.toString();
    }

    function selectedFixture() {
      return fixtures.find((entry) => entry.fixturePath === selectedFixturePath) || null;
    }

    function updateViewer() {
      const fixture = selectedFixture();
      if (!fixture) {
        viewerFrameEl.hidden = true;
        emptyEl.hidden = false;
        viewerTitleEl.textContent = "Select a persisted fixture";
        viewerSubtitleEl.textContent = "";
        openGraphEl.href = "#";
        openJsonEl.href = "#";
        return;
      }
      const graphUrl = graphUrlForFixturePath(fixture.fixturePath);
      viewerFrameEl.hidden = false;
      emptyEl.hidden = true;
      viewerFrameEl.src = graphUrl;
      viewerTitleEl.textContent = (fixture.canonicalRootId || "unknown-root") + " · explored " + (fixture.exploredTweetId || "unknown");
      viewerSubtitleEl.innerHTML = "captured " + escapeInline(fixture.capturedAt || "unknown") + " · <code>" + escapeInline(fixture.fixturePath) + "</code>";
      openGraphEl.href = graphUrl;
      openJsonEl.href = "/fixture?fixturePath=" + encodeURIComponent(fixture.fixturePath);
    }

    function renderFixtureList() {
      const query = searchEl.value.trim().toLowerCase();
      const filtered = fixtures.filter((fixture) => {
        if (!query) {
          return true;
        }
        const haystack = [
          fixture.fixturePath,
          fixture.canonicalRootId,
          fixture.exploredTweetId,
          fixture.rootTextPreview,
          fixture.exploredTextPreview
        ].join(" ").toLowerCase();
        return haystack.includes(query);
      });

      fixtureListEl.innerHTML = filtered.map((fixture) => \`
        <article class="fixture-card \${fixture.fixturePath === selectedFixturePath ? "active" : ""}" data-fixture-path="\${fixture.fixturePath}">
          <div class="fixture-title">\${escapeInline((fixture.canonicalRootId || "unknown-root") + " · explored " + (fixture.exploredTweetId || "unknown"))}</div>
          <div class="fixture-meta">captured \${escapeInline(fixture.capturedAt || "unknown")} · \${escapeInline(String(fixture.tweetCount || 0))} tweets</div>
          <div class="fixture-preview">\${escapeInline(truncate(fixture.exploredTextPreview || fixture.rootTextPreview || fixture.fixturePath))}</div>
        </article>
      \`).join("") || "<p>No fixtures matched your search.</p>";

      fixtureListEl.querySelectorAll("[data-fixture-path]").forEach((element) => {
        element.addEventListener("click", () => {
          selectedFixturePath = element.getAttribute("data-fixture-path") || "";
          renderFixtureList();
          updateViewer();
        });
      });
    }

    async function loadCatalog() {
      setStatus("Loading persisted fixtures...");
      const response = await fetch("/api/catalog");
      const data = await response.json();
      fixtures = Array.isArray(data.fixtures) ? data.fixtures : [];
      if (!selectedFixturePath && fixtures.length > 0) {
        selectedFixturePath = fixtures[0].fixturePath;
      }
      renderFixtureList();
      updateViewer();
      setStatus(fixtures.length > 0 ? "Ready." : "No persisted fixtures found.");
    }

    refreshEl.addEventListener("click", async () => {
      setStatus("Refreshing fixture catalog...");
      const response = await fetch("/api/catalog/sync", { method: "POST" });
      if (!response.ok) {
        setStatus("Failed to refresh fixture catalog.");
        return;
      }
      await loadCatalog();
    });

    reloadEl.addEventListener("click", () => {
      updateViewer();
    });

    searchEl.addEventListener("input", renderFixtureList);

    loadCatalog().catch((error) => {
      setStatus(error.message || String(error));
    });
  </script>
</body>
</html>`;
}

async function buildGraphHtmlForFixture(fixturePath) {
  const resolvedPath = path.resolve(String(fixturePath || ""));
  if (!resolvedPath) {
    throw new Error("Missing fixturePath");
  }
  const dataset = await loadConversationDataset({
    kind: "fixture",
    path: resolvedPath
  });
  const payload = buildGraphPayload(dataset, resolvedPath);
  const rawFixture = JSON.parse(await fs.readFile(resolvedPath, "utf8"));
  payload.capturedAt = String(rawFixture?.capturedAt || "").trim() || null;
  return buildHtmlReport(payload);
}

function createGraphGalleryServer({ catalogPath = DEFAULT_CATALOG_PATH } = {}) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");

      if (req.method === "GET" && url.pathname === "/") {
        sendHtml(res, 200, galleryHtml());
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/catalog") {
        const catalog = await loadCatalog(catalogPath);
        sendJson(res, 200, catalog);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/catalog/sync") {
        const catalog = await syncCatalogFromFixtures({ catalogPath });
        sendJson(res, 200, catalog);
        return;
      }

      if (req.method === "GET" && url.pathname === "/graph") {
        const fixturePath = String(url.searchParams.get("fixturePath") || "").trim();
        if (!fixturePath) {
          sendText(res, 400, "Missing fixturePath");
          return;
        }
        const html = await buildGraphHtmlForFixture(fixturePath);
        sendHtml(res, 200, html);
        return;
      }

      if (req.method === "GET" && url.pathname === "/fixture") {
        const fixturePath = String(url.searchParams.get("fixturePath") || "").trim();
        if (!fixturePath) {
          sendText(res, 400, "Missing fixturePath");
          return;
        }
        const raw = await fs.readFile(path.resolve(fixturePath), "utf8");
        sendJson(res, 200, JSON.parse(raw));
        return;
      }

      sendText(res, 404, "Not found");
    } catch (error) {
      sendJson(res, 500, { error: error.message || String(error) });
    }
  });
}

function parseArgs(argv = []) {
  const args = {
    port: DEFAULT_PORT,
    catalogPath: DEFAULT_CATALOG_PATH
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || "");
    const next = index + 1 < argv.length ? argv[index + 1] : null;
    const readValue = () => {
      index += 1;
      return next;
    };

    if (token === "--port") {
      args.port = Number(readValue() || DEFAULT_PORT) || DEFAULT_PORT;
    } else if (token === "--catalog") {
      args.catalogPath = String(readValue() || "").trim() || DEFAULT_CATALOG_PATH;
    } else if (token === "--help" || token === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

function usage() {
  return [
    "Usage: node scripts/graph_gallery_server.js [options]",
    "",
    "Options:",
    `  --port <n>            Server port (default: ${DEFAULT_PORT})`,
    "  --catalog <path>      Fixture catalog path",
    "  --help                Show this message"
  ].join("\n");
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }

    await syncCatalogFromFixtures({ catalogPath: args.catalogPath });

    const server = createGraphGalleryServer({ catalogPath: args.catalogPath });
    server.listen(args.port, "127.0.0.1", () => {
      process.stdout.write(`Ariadex graph gallery listening on http://127.0.0.1:${args.port}\n`);
    });
  } catch (error) {
    process.stderr.write(`${error.message || String(error)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}

module.exports = {
  DEFAULT_PORT,
  buildGraphHtmlForFixture,
  createGraphGalleryServer,
  galleryHtml,
  parseArgs,
  usage
};
