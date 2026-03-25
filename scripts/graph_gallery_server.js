"use strict";

const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const { loadConversationDataset } = require("../data/conversation_dataset_source.js");
const { DEFAULT_CATALOG_PATH, loadCatalog, syncCatalogFromFixtures } = require("../research/fixture_catalog.js");
const { buildGraphPayload, buildHtmlReport } = require("./render_conversation_graph_report.js");

const DEFAULT_PORT = 8792;

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m"
};

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

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function colorForLevel(level) {
  switch (String(level || "").toLowerCase()) {
    case "tweet":
      return ANSI.blue;
    case "author":
      return ANSI.magenta;
    case "reference":
      return ANSI.green;
    case "error":
      return ANSI.red;
    case "system":
    default:
      return ANSI.cyan;
  }
}

function logToTerminal(level, message, extra = {}) {
  const color = colorForLevel(level);
  const now = new Date().toISOString();
  const parts = [];
  if (extra.author) {
    parts.push(`author=${extra.author}`);
  }
  if (extra.tweetId) {
    parts.push(`tweet=${extra.tweetId}`);
  }
  if (extra.url) {
    parts.push(`url=${extra.url}`);
  }
  const meta = parts.length > 0 ? ` ${ANSI.dim}${parts.join(" ")}${ANSI.reset}` : "";
  process.stdout.write(`${ANSI.dim}${now}${ANSI.reset} ${color}[graph:${String(level || "system")}]${ANSI.reset} ${String(message || "")}${meta}\n`);
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
  <title>Ariadex Live Graphs</title>
  <style>
    :root {
      --ink: #2f241a;
      --muted: #7b6957;
      --line: #d7c6b2;
      --accent: #b85c38;
      --paper: rgba(251, 245, 235, 0.92);
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      height: 100%;
      overflow: hidden;
      background:
        radial-gradient(circle at 12% 14%, rgba(196, 138, 58, 0.12), transparent 20%),
        radial-gradient(circle at 82% 22%, rgba(184, 92, 56, 0.1), transparent 18%),
        linear-gradient(180deg, #f7f1e7 0%, #efe4d4 100%);
      color: var(--ink);
      font-family: "Avenir Next", "Futura", "Helvetica Neue", Arial, sans-serif;
    }
    .app { height: 100%; display: grid; grid-template-rows: 56px minmax(0,1fr); }
    .topbar {
      display: grid;
      grid-template-columns: 220px minmax(220px, 420px) minmax(180px, 1fr) auto auto auto;
      gap: 10px;
      align-items: center;
      padding: 10px 14px;
      background: var(--paper);
      border-bottom: 1px solid var(--line);
      backdrop-filter: blur(10px);
    }
    .brand { font-size: 14px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
    select, input, button {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 9px 12px;
      background: #fffaf2;
      color: var(--ink);
      font: inherit;
    }
    button { cursor: pointer; }
    .primary { background: var(--accent); color: white; border-color: transparent; }
    .status { color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .viewer { position: relative; min-height: 0; }
    iframe { width: 100%; height: 100%; border: 0; background: white; }
    @media (max-width: 1100px) {
      .topbar { grid-template-columns: 1fr 1fr; grid-auto-rows: minmax(0,auto); }
    }
  </style>
</head>
<body>
  <main class="app">
    <div class="topbar">
      <div class="brand">Ariadex Live Graphs</div>
      <select id="fixtureSelect"></select>
      <input id="search" type="search" placeholder="search fixtures">
      <button id="refresh">Refresh Catalog</button>
      <button id="reload" class="primary">Reload Graph</button>
      <div id="status" class="status"></div>
    </div>
    <section class="viewer">
      <iframe id="viewer-frame" title="Ariadex live graph viewer"></iframe>
    </section>
  </main>
  <script>
    const fixtureSelect = document.getElementById("fixtureSelect");
    const searchEl = document.getElementById("search");
    const refreshEl = document.getElementById("refresh");
    const reloadEl = document.getElementById("reload");
    const statusEl = document.getElementById("status");
    const viewerFrameEl = document.getElementById("viewer-frame");

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
    function renderFixtureOptions() {
      const query = searchEl.value.trim().toLowerCase();
      const filtered = fixtures.filter((fixture) => {
        if (!query) return true;
        const haystack = [
          fixture.fixturePath,
          fixture.canonicalRootId,
          fixture.exploredTweetId,
          fixture.rootTextPreview,
          fixture.exploredTextPreview
        ].join(" ").toLowerCase();
        return haystack.includes(query);
      });
      fixtureSelect.innerHTML = filtered.map((fixture) => {
        const label = (fixture.canonicalRootId || "unknown-root") + " · explored " + (fixture.exploredTweetId || "unknown") + " · " + (fixture.tweetCount || 0) + " tweets";
        return '<option value="' + fixture.fixturePath + '">' + escapeInline(label) + '</option>';
      }).join("");
      if (filtered.length > 0) {
        if (!filtered.some((fixture) => fixture.fixturePath === selectedFixturePath)) {
          selectedFixturePath = filtered[0].fixturePath;
        }
        fixtureSelect.value = selectedFixturePath;
      }
    }

    function updateViewer() {
      const fixture = selectedFixture();
      if (!fixture) return;
      viewerFrameEl.src = graphUrlForFixturePath(fixture.fixturePath);
      setStatus("captured " + (fixture.capturedAt || "unknown") + " · " + fixture.fixturePath);
    }

    async function loadCatalog() {
      setStatus("Loading persisted fixtures...");
      const response = await fetch("/api/catalog");
      const data = await response.json();
      fixtures = Array.isArray(data.fixtures) ? data.fixtures : [];
      if (!selectedFixturePath && fixtures.length > 0) {
        selectedFixturePath = fixtures[0].fixturePath;
      }
      renderFixtureOptions();
      updateViewer();
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

    fixtureSelect.addEventListener("change", () => {
      selectedFixturePath = fixtureSelect.value;
      updateViewer();
    });

    searchEl.addEventListener("input", renderFixtureOptions);

    window.addEventListener("message", (event) => {
      const data = event.data;
      if (!data || data.source !== "ariadex-graph-report" || data.type !== "ariadex-log") {
        return;
      }
      const payload = data.payload || {};
      fetch("/api/log", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(payload)
      }).catch(() => {});
    });

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

      if (req.method === "POST" && url.pathname === "/api/log") {
        const raw = await readRequestBody(req);
        const payload = raw ? JSON.parse(raw) : {};
        logToTerminal(payload.level || "system", payload.message || "Graph event", payload);
        sendJson(res, 200, { ok: true });
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
