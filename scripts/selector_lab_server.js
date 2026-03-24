"use strict";

const http = require("node:http");
const path = require("node:path");

const { loadConversationDataset } = require("../data/conversation_dataset_source.js");
const { buildConversationArtifact } = require("../server/conversation_artifact.js");
const { listSelectorDefinitions, runRegisteredSelector } = require("../research/selectors/registry.js");
const { DEFAULT_CATALOG_PATH, loadCatalog, syncCatalogFromFixtures } = require("../research/fixture_catalog.js");

const DEFAULT_PORT = 8791;

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
      if (raw.length > 2_000_000) {
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function uiHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ariadex Selector Lab</title>
  <style>
    :root {
      --bg: #f2ece2;
      --panel: rgba(255, 250, 243, 0.92);
      --ink: #1f1a15;
      --muted: #6f665c;
      --line: #d8cec0;
      --accent: #1248d1;
      --accent-soft: #e4ecff;
      --ok: #1f7a4a;
      --warn: #a65b00;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, "Iowan Old Style", serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(18,72,209,0.12), transparent 35%),
        radial-gradient(circle at bottom right, rgba(166,91,0,0.10), transparent 35%),
        linear-gradient(180deg, #f8f2ea 0%, #eee4d6 100%);
    }
    .shell { max-width: 1480px; margin: 0 auto; padding: 28px 20px 48px; }
    h1, h2, h3 { margin: 0 0 10px; line-height: 1.08; }
    p { color: var(--muted); }
    .layout { display: grid; grid-template-columns: 360px 1fr; gap: 18px; }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 18px;
      box-shadow: 0 12px 40px rgba(64, 43, 18, 0.08);
    }
    .controls { position: sticky; top: 18px; align-self: start; }
    label { display: block; font-size: 14px; color: var(--muted); margin: 12px 0 6px; }
    select, textarea, button, input {
      width: 100%;
      border-radius: 12px;
      border: 1px solid var(--line);
      padding: 11px 12px;
      font: inherit;
      background: #fffdf9;
      color: var(--ink);
    }
    textarea { min-height: 130px; resize: vertical; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 13px; }
    button {
      margin-top: 16px;
      background: var(--accent);
      color: white;
      border-color: transparent;
      cursor: pointer;
      font-weight: 700;
    }
    button:disabled { opacity: 0.6; cursor: wait; }
    .results { display: grid; gap: 18px; }
    .stats { display: flex; flex-wrap: wrap; gap: 10px; margin: 14px 0 8px; }
    .pill {
      display: inline-block;
      padding: 6px 10px;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent);
      font-size: 13px;
      font-family: ui-monospace, SFMono-Regular, monospace;
    }
    .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 14px; }
    .tweet-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
    .tweet-card {
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 12px;
      background: rgba(255,255,255,0.5);
    }
    .metric-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 8px 0 10px;
    }
    .metric {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 999px;
      background: #f4ede2;
      color: var(--muted);
      font-size: 12px;
      font-family: ui-monospace, SFMono-Regular, monospace;
    }
    .badges { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
    .badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 999px;
      background: #efe6d8;
      color: var(--ink);
      font-size: 12px;
      font-family: ui-monospace, SFMono-Regular, monospace;
    }
    .tweet-id { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; color: var(--muted); }
    .tweet-author { font-weight: 700; margin: 6px 0; }
    .section { margin-top: 18px; }
    .status { min-height: 24px; margin-top: 12px; font-size: 14px; }
    .status.ok { color: var(--ok); }
    .status.warn { color: var(--warn); }
    .empty { font-style: italic; color: var(--muted); }
    @media (max-width: 980px) {
      .layout { grid-template-columns: 1fr; }
      .controls { position: static; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <h1>Ariadex Selector Lab</h1>
    <p>Choose a fixtured explored tweet, select an algorithm, and run it locally on the saved graph.</p>
    <div class="layout">
      <section class="card controls">
        <h2>Run Selector</h2>
        <label for="fixtureSelect">Fixtured Explored Tweet</label>
        <select id="fixtureSelect"></select>
        <div id="fixtureMeta" class="status"></div>

        <label for="algoSelect">Algorithm</label>
        <select id="algoSelect"></select>

        <label for="paramsInput">Params JSON</label>
        <textarea id="paramsInput">{}</textarea>

        <button id="runButton">Run Selector</button>
        <button id="refreshButton" type="button">Refresh Catalog</button>
        <div id="status" class="status"></div>
      </section>

      <section class="results">
        <article class="card">
          <h2 id="resultTitle">No run yet</h2>
          <div id="summary" class="stats"></div>
          <div id="notes" class="meta-grid"></div>
        </article>
        <article class="card">
          <h2>Mandatory Path</h2>
          <div id="mandatoryPath" class="tweet-grid"></div>
        </article>
        <article class="card">
          <h2>Selected Tweets</h2>
          <div id="selectedTweets" class="tweet-grid"></div>
        </article>
        <article class="card">
          <h2>References</h2>
          <div id="references"></div>
        </article>
        <article class="card">
          <h2>People</h2>
          <div id="people" class="tweet-grid"></div>
        </article>
      </section>
    </div>
  </main>
  <script>
    const fixtureSelect = document.getElementById("fixtureSelect");
    const algoSelect = document.getElementById("algoSelect");
    const paramsInput = document.getElementById("paramsInput");
    const runButton = document.getElementById("runButton");
    const refreshButton = document.getElementById("refreshButton");
    const statusNode = document.getElementById("status");
    const fixtureMetaNode = document.getElementById("fixtureMeta");
    const resultTitleNode = document.getElementById("resultTitle");
    const summaryNode = document.getElementById("summary");
    const notesNode = document.getElementById("notes");
    const mandatoryPathNode = document.getElementById("mandatoryPath");
    const selectedTweetsNode = document.getElementById("selectedTweets");
    const referencesNode = document.getElementById("references");
    const peopleNode = document.getElementById("people");

    let fixtures = [];
    let selectors = [];

    function setStatus(text, kind = "") {
      statusNode.textContent = text || "";
      statusNode.className = kind ? "status " + kind : "status";
    }

    function renderTweetCard(tweet) {
      const article = document.createElement("article");
      article.className = "tweet-card";
      const badges = [];
      if (tweet.pathRole) {
        badges.push("role=" + tweet.pathRole);
      }
      if (tweet.inboundPathRelation) {
        badges.push("from=" + tweet.inboundPathRelation);
      }
      if (tweet.outboundPathRelation) {
        badges.push("to=" + tweet.outboundPathRelation);
      }
      if (Number.isFinite(Number(tweet.pathIndex))) {
        badges.push("idx=" + tweet.pathIndex);
      }
      const badgeHtml = badges.length > 0
        ? "<div class='badges'>" + badges.map((badge) => "<span class='badge'>" + badge + "</span>").join("") + "</div>"
        : "";
      const metrics = [];
      if (Number.isFinite(Number(tweet.likes))) {
        metrics.push("likes=" + Number(tweet.likes || 0));
      }
      if (Number.isFinite(Number(tweet.followers))) {
        metrics.push("followers=" + Number(tweet.followers || 0));
      }
      if (Number.isFinite(Number(tweet.importanceScore))) {
        metrics.push("score=" + Number(tweet.importanceScore || 0).toFixed(2));
      }
      const metricHtml = metrics.length > 0
        ? "<div class='metric-row'>" + metrics.map((metric) => "<span class='metric'>" + metric + "</span>").join("") + "</div>"
        : "";
      article.innerHTML = \`<div class="tweet-id">\${tweet.id || ""}</div><div class="tweet-author">\${tweet.author || ""}</div>\${badgeHtml}\${metricHtml}<p>\${tweet.text || ""}</p>\`;
      return article;
    }

    function renderPersonCard(person) {
      const article = document.createElement("article");
      article.className = "tweet-card";
      const metrics = [
        "followers=" + Number(person.followers || 0),
        "tweets=" + Number(person.tweetCount || 0),
        "likes=" + Number(person.totalLikes || 0),
        "authorScore=" + Number(person.authorScore || 0).toFixed(2)
      ];
      article.innerHTML = "<div class='tweet-author'>" + (person.author || "") + "</div>"
        + "<div class='metric-row'>" + metrics.map((metric) => "<span class='metric'>" + metric + "</span>").join("") + "</div>"
        + "<p>" + (person.topTweetText || "") + "</p>";
      return article;
    }

    function renderPill(text) {
      const span = document.createElement("span");
      span.className = "pill";
      span.textContent = text;
      return span;
    }

    function selectedFixture() {
      return fixtures.find((entry) => entry.fixturePath === fixtureSelect.value) || null;
    }

    function updateFixtureMeta() {
      const fixture = selectedFixture();
      if (!fixture) {
        fixtureMetaNode.textContent = "";
        return;
      }
      fixtureMetaNode.textContent = "root=" + (fixture.canonicalRootId || "unknown") + " tweets=" + fixture.tweetCount + " captured=" + (fixture.capturedAt || "unknown");
    }

    async function loadCatalog() {
      const response = await fetch("/api/catalog");
      const data = await response.json();
      fixtures = Array.isArray(data.fixtures) ? data.fixtures : [];
      fixtureSelect.innerHTML = "";
      for (const fixture of fixtures) {
        const option = document.createElement("option");
        option.value = fixture.fixturePath;
        option.textContent = (fixture.exploredTweetId || "unknown") + " :: " + (fixture.exploredTextPreview || fixture.rootTextPreview || fixture.fixturePath);
        fixtureSelect.appendChild(option);
      }
      updateFixtureMeta();
    }

    async function loadSelectors() {
      const response = await fetch("/api/selectors");
      selectors = await response.json();
      algoSelect.innerHTML = "";
      for (const selector of selectors) {
        const option = document.createElement("option");
        option.value = selector.algorithmId;
        option.textContent = selector.algorithmId + " :: " + selector.label;
        algoSelect.appendChild(option);
      }
    }

    async function runSelector() {
      const fixture = selectedFixture();
      if (!fixture) {
        setStatus("Choose a fixtured explored tweet first.", "warn");
        return;
      }

      let params = {};
      try {
        params = JSON.parse(paramsInput.value || "{}");
      } catch (error) {
        setStatus("Params JSON is invalid: " + error.message, "warn");
        return;
      }

      runButton.disabled = true;
      setStatus("Running selector...", "ok");
      try {
        const response = await fetch("/api/run", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            fixturePath: fixture.fixturePath,
            exploredTweetId: fixture.exploredTweetId,
            algorithmId: algoSelect.value,
            params
          })
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Selector run failed");
        }

        resultTitleNode.textContent = data.algorithmId + " on " + data.exploredTweetId;
        summaryNode.innerHTML = "";
        summaryNode.appendChild(renderPill("selected " + data.selection.diagnostics.selectedTweetCount));
        summaryNode.appendChild(renderPill("path " + data.selection.diagnostics.mandatoryPathLength));
        summaryNode.appendChild(renderPill("refs " + data.selection.diagnostics.referenceCount));
        summaryNode.appendChild(renderPill("tweet refs " + data.selection.diagnostics.tweetReferenceCount));

        notesNode.innerHTML = "";
        const notes = Array.isArray(data.selection.diagnostics.notes) ? data.selection.diagnostics.notes : [];
        for (const note of notes) {
          const card = document.createElement("div");
          card.className = "card";
          card.textContent = note;
          notesNode.appendChild(card);
        }
        if (notes.length === 0) {
          const card = document.createElement("div");
          card.className = "card";
          card.textContent = "No extra diagnostic notes.";
          notesNode.appendChild(card);
        }

        mandatoryPathNode.innerHTML = "";
        for (const tweet of data.artifact.mandatoryPath || []) {
          mandatoryPathNode.appendChild(renderTweetCard(tweet));
        }
        selectedTweetsNode.innerHTML = "";
        for (const tweet of data.artifact.selectedTweets || []) {
          selectedTweetsNode.appendChild(renderTweetCard(tweet));
        }
        referencesNode.innerHTML = "";
        const externalRefs = data.references && Array.isArray(data.references.external) ? data.references.external : [];
        const tweetRefs = data.references && Array.isArray(data.references.tweets) ? data.references.tweets : [];
        const refs = [...externalRefs, ...tweetRefs];
        if (refs.length === 0) {
          referencesNode.innerHTML = '<p class="empty">No references.</p>';
        } else {
          if (externalRefs.length > 0) {
            const heading = document.createElement("h3");
            heading.textContent = "External References";
            referencesNode.appendChild(heading);
          }
          for (const ref of externalRefs) {
            const div = document.createElement("div");
            div.className = "tweet-card";
            div.innerHTML = "<div class='tweet-id'>" + (ref.canonicalUrl || "") + "</div><div class='tweet-author'>" + (ref.domain || "") + "</div><div class='metric-row'><span class='metric'>citations=" + (ref.citationCount || 0) + "</span><span class='metric'>weighted=" + Number(ref.weightedCitationScore || 0).toFixed(2) + "</span></div>";
            referencesNode.appendChild(div);
          }
          if (tweetRefs.length > 0) {
            const heading = document.createElement("h3");
            heading.textContent = "Tweet References";
            referencesNode.appendChild(heading);
          }
          for (const ref of tweetRefs) {
            const div = document.createElement("div");
            div.className = "tweet-card";
            div.innerHTML = "<div class='tweet-id'>" + (ref.canonicalUrl || "") + "</div><div class='tweet-author'>" + (ref.tweetId ? "tweet ref " + ref.tweetId : (ref.domain || "")) + "</div><div class='metric-row'><span class='metric'>citations=" + (ref.citationCount || 0) + "</span><span class='metric'>inDataset=" + (ref.isInDataset ? "yes" : "no") + "</span><span class='metric'>weighted=" + Number(ref.weightedCitationScore || 0).toFixed(2) + "</span></div>";
            referencesNode.appendChild(div);
          }
        }

        peopleNode.innerHTML = "";
        const people = data.people || [];
        if (people.length === 0) {
          peopleNode.innerHTML = '<p class="empty">No people.</p>';
        } else {
          for (const person of people) {
            peopleNode.appendChild(renderPersonCard(person));
          }
        }

        setStatus("Selector run complete.", "ok");
      } catch (error) {
        setStatus(error.message || String(error), "warn");
      } finally {
        runButton.disabled = false;
      }
    }

    fixtureSelect.addEventListener("change", updateFixtureMeta);
    runButton.addEventListener("click", runSelector);
    refreshButton.addEventListener("click", async () => {
      setStatus("Refreshing fixture catalog...", "ok");
      const response = await fetch("/api/catalog/sync", { method: "POST" });
      if (response.ok) {
        await loadCatalog();
        setStatus("Catalog refreshed.", "ok");
      } else {
        setStatus("Failed to refresh catalog.", "warn");
      }
    });

    Promise.all([loadCatalog(), loadSelectors()]).then(() => {
      setStatus("Ready.", "ok");
    }).catch((error) => {
      setStatus(error.message || String(error), "warn");
    });
  </script>
</body>
</html>`;
}

function buildPeopleSummary(artifact = {}) {
  const tweets = [
    ...(Array.isArray(artifact?.mandatoryPath) ? artifact.mandatoryPath : []),
    ...(Array.isArray(artifact?.selectedTweets) ? artifact.selectedTweets : [])
  ];
  const byAuthor = new Map();

  for (const tweet of tweets) {
    const author = String(tweet?.author || "").trim();
    if (!author) {
      continue;
    }
    if (!byAuthor.has(author)) {
      byAuthor.set(author, {
        author,
        followers: Number(tweet?.followers || 0),
        tweetCount: 0,
        totalLikes: 0,
        authorScore: 0,
        topTweetText: ""
      });
    }
    const entry = byAuthor.get(author);
    entry.followers = Math.max(entry.followers, Number(tweet?.followers || 0));
    entry.tweetCount += 1;
    entry.totalLikes += Number(tweet?.likes || 0);
    entry.authorScore += Number(tweet?.importanceScore || 0);
    if (!entry.topTweetText || String(tweet?.text || "").length > String(entry.topTweetText || "").length) {
      entry.topTweetText = String(tweet?.text || "").slice(0, 160);
    }
  }

  return [...byAuthor.values()].sort((a, b) => {
    if (b.authorScore !== a.authorScore) {
      return b.authorScore - a.authorScore;
    }
    if (b.followers !== a.followers) {
      return b.followers - a.followers;
    }
    return String(a.author).localeCompare(String(b.author));
  });
}

function createSelectorLabServer({ catalogPath = DEFAULT_CATALOG_PATH } = {}) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");

      if (req.method === "GET" && url.pathname === "/") {
        sendHtml(res, 200, uiHtml());
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

      if (req.method === "GET" && url.pathname === "/api/selectors") {
        sendJson(res, 200, listSelectorDefinitions());
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/run") {
        const rawBody = await readRequestBody(req);
        const body = rawBody ? JSON.parse(rawBody) : {};
        const fixturePath = path.resolve(String(body?.fixturePath || ""));
        const exploredTweetId = String(body?.exploredTweetId || "").trim();
        const algorithmId = String(body?.algorithmId || "").trim() || "path_anchored_v1";
        const params = body?.params && typeof body.params === "object" ? body.params : {};

        if (!fixturePath || !exploredTweetId) {
          sendJson(res, 400, { error: "fixturePath and exploredTweetId are required" });
          return;
        }

        const dataset = await loadConversationDataset({
          kind: "fixture",
          path: fixturePath
        });
        const selection = runRegisteredSelector({
          algorithmId,
          dataset,
          clickedTweetId: exploredTweetId,
          params
        });
        const artifact = buildConversationArtifact({
          dataset,
          selection,
          clickedTweetId: exploredTweetId,
          canonicalRootId: dataset.canonicalRootId
        });
        const people = buildPeopleSummary(artifact);

        sendJson(res, 200, {
          algorithmId,
          exploredTweetId,
          fixturePath,
          selection,
          artifact,
          references: {
            external: Array.isArray(artifact.references) ? artifact.references : [],
            tweets: Array.isArray(artifact.tweetReferences) ? artifact.tweetReferences : []
          },
          people
        });
        return;
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (error) {
      sendJson(res, 500, { error: error.message || String(error) });
    }
  });
}

async function main() {
  const port = Number(process.env.ARIADEX_SELECTOR_LAB_PORT || DEFAULT_PORT);
  await syncCatalogFromFixtures({});
  const server = createSelectorLabServer({});
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  process.stdout.write(`Ariadex Selector Lab running at http://127.0.0.1:${port}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  buildPeopleSummary,
  createSelectorLabServer,
  uiHtml
};
