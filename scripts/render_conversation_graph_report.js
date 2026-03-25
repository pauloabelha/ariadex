"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const { loadConversationDataset } = require("../data/conversation_dataset_source.js");
const { buildConversationGraph } = require("../core/conversation_graph.js");
const { rankConversationGraph } = require("../core/conversation_rank.js");

const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), "research", "runs", "conversation_graphs");

function parseArgs(argv = []) {
  const args = {
    fixture: null,
    output: null,
    outputDir: DEFAULT_OUTPUT_DIR,
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
    } else if (token === "--fixture") {
      args.fixture = String(readValue() || "").trim() || null;
    } else if (token === "--output") {
      args.output = String(readValue() || "").trim() || null;
    } else if (token === "--output-dir") {
      args.outputDir = String(readValue() || "").trim() || DEFAULT_OUTPUT_DIR;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

function usage() {
  return [
    "Usage: node scripts/render_conversation_graph_report.js --fixture <path> [options]",
    "",
    "Options:",
    "  --fixture <path>       Full-graph fixture JSON",
    "  --output <path>        Explicit HTML output path",
    "  --output-dir <dir>     Output directory for generated HTML",
    "  --help                 Show this message"
  ].join("\n");
}

function defaultOutputPath({ outputDir, fixturePath, canonicalRootId }) {
  const fixtureName = path.basename(String(fixturePath || "fixture"), path.extname(String(fixturePath || ""))).replace(/[^a-zA-Z0-9_-]+/g, "-");
  const rootPart = String(canonicalRootId || "root").replace(/[^a-zA-Z0-9_-]+/g, "-");
  return path.join(path.resolve(outputDir), `${fixtureName}__${rootPart}__graph.html`);
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

function readMetric(tweet, metricKey, fallbackKey) {
  const metricValue = Number(tweet?.metrics?.[metricKey]);
  if (Number.isFinite(metricValue) && metricValue >= 0) {
    return metricValue;
  }
  const fallbackValue = Number(tweet?.[fallbackKey]);
  if (Number.isFinite(fallbackValue) && fallbackValue >= 0) {
    return fallbackValue;
  }
  return 0;
}

function computeReach(tweet) {
  const likes = readMetric(tweet, "like_count", "likes");
  const reposts = readMetric(tweet, "retweet_count", "reposts");
  const replies = readMetric(tweet, "reply_count", "replies");
  const quotes = readMetric(tweet, "quote_count", "quote_count");
  return (likes * 1.0) + (reposts * 2.0) + (replies * 2.3) + (quotes * 2.7);
}

function followerCount(tweet) {
  const count = Number(tweet?.author_profile?.public_metrics?.followers_count);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

function inferParentId(tweet) {
  if (!tweet) {
    return null;
  }
  if (tweet.quote_of) {
    return String(tweet.quote_of);
  }
  if (tweet.reply_to) {
    return String(tweet.reply_to);
  }
  const refs = Array.isArray(tweet.referenced_tweets) ? tweet.referenced_tweets : [];
  const quoted = refs.find((entry) => String(entry?.type || "").toLowerCase() === "quoted" && entry?.id);
  if (quoted?.id) {
    return String(quoted.id);
  }
  const replied = refs.find((entry) => String(entry?.type || "").toLowerCase() === "replied_to" && entry?.id);
  if (replied?.id) {
    return String(replied.id);
  }
  return null;
}

function buildPathToRoot(tweetById, startTweetId) {
  const path = [];
  const visited = new Set();
  let currentId = String(startTweetId || "").trim();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    path.push(currentId);
    const tweet = tweetById.get(currentId);
    const parentId = inferParentId(tweet);
    if (!parentId || !tweetById.has(parentId)) {
      break;
    }
    currentId = parentId;
  }

  return path.reverse();
}

function buildGraphPayload(dataset, fixturePath) {
  const tweets = Array.isArray(dataset?.tweets) ? dataset.tweets : [];
  const tweetById = new Map();
  for (const tweet of tweets) {
    if (tweet?.id) {
      tweetById.set(String(tweet.id), tweet);
    }
  }

  const graph = buildConversationGraph(tweets);
  const ranking = rankConversationGraph(graph);
  const scoreById = ranking?.scoreById instanceof Map ? ranking.scoreById : new Map();

  const authorAggregate = new Map();
  const nodes = tweets.map((tweet) => {
    const id = String(tweet.id);
    const author = String(tweet.author || "@unknown");
    const isClicked = dataset?.clickedTweetId ? id === String(dataset.clickedTweetId) : false;
    const isRoot = dataset?.canonicalRootId ? id === String(dataset.canonicalRootId) : false;
    const parentId = inferParentId(tweet);
    const kind = tweet.repost_of
      ? "repost"
      : (tweet.quote_of ? "quote" : (tweet.reply_to ? "reply" : "rootish"));
    const node = {
      id,
      author,
      authorName: String(tweet?.author_profile?.name || author),
      text: String(tweet?.text || "").trim(),
      url: String(tweet?.url || "").trim(),
      external_urls: Array.isArray(tweet?.external_urls) ? tweet.external_urls.map((value) => String(value || "").trim()).filter(Boolean) : [],
      parentId,
      kind,
      isRoot,
      isClicked,
      score: Number(scoreById.get(id) || 0),
      reach: computeReach(tweet),
      followers: followerCount(tweet),
      likes: readMetric(tweet, "like_count", "likes"),
      replies: readMetric(tweet, "reply_count", "replies"),
      quotes: readMetric(tweet, "quote_count", "quote_count"),
      reposts: readMetric(tweet, "retweet_count", "reposts")
    };
    if (kind !== "repost") {
      if (!authorAggregate.has(author)) {
        authorAggregate.set(author, { author, totalScore: 0, tweetCount: 0 });
      }
      const entry = authorAggregate.get(author);
      entry.totalScore += node.score;
      entry.tweetCount += 1;
    }
    return node;
  });

  const edges = (Array.isArray(graph?.edges) ? graph.edges : []).map((edge, index) => ({
    id: `${String(edge?.type || "edge")}:${String(edge?.source || "")}:${String(edge?.target || "")}:${index}`,
    source: String(edge?.source || ""),
    target: String(edge?.target || ""),
    type: String(edge?.type || "reply")
  }));

  const clickedPath = buildPathToRoot(tweetById, dataset?.clickedTweetId);
  const authorPalette = ["#1473e6", "#ff5a36", "#16a34a", "#8b5cf6", "#ffcc00", "#ef4444", "#06b6d4", "#f97316"];
  const topAuthors = [...authorAggregate.values()]
    .sort((a, b) => b.totalScore - a.totalScore || b.tweetCount - a.tweetCount || String(a.author).localeCompare(String(b.author)))
    .slice(0, authorPalette.length)
    .map((entry, index) => ({ ...entry, color: authorPalette[index] }));
  const authorColorByAuthor = Object.fromEntries(topAuthors.map((entry) => [entry.author, entry.color]));

  const referenceMap = new Map();
  for (const node of nodes) {
    for (const rawUrl of node.external_urls) {
      let normalized = "";
      try {
        const parsed = new URL(rawUrl);
        const host = parsed.hostname.toLowerCase();
        if (["x.com", "twitter.com", "www.x.com", "www.twitter.com", "t.co"].includes(host)) {
          continue;
        }
        parsed.hash = "";
        normalized = parsed.toString();
      } catch {
        continue;
      }
      if (!referenceMap.has(normalized)) {
        let domain = "";
        try {
          domain = new URL(normalized).hostname.replace(/^www\./, "");
        } catch {}
        referenceMap.set(normalized, { url: normalized, domain, count: 0, tweetIds: [] });
      }
      const entry = referenceMap.get(normalized);
      entry.count += 1;
      if (!entry.tweetIds.includes(node.id)) {
        entry.tweetIds.push(node.id);
      }
    }
  }

  return {
    fixturePath,
    canonicalRootId: dataset?.canonicalRootId || null,
    clickedTweetId: dataset?.clickedTweetId || null,
    capturedAt: null,
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      repostCount: nodes.filter((node) => node.kind === "repost").length,
      quoteCount: nodes.filter((node) => node.kind === "quote").length,
      replyCount: nodes.filter((node) => node.kind === "reply").length
    },
    clickedPath,
    topAuthors,
    authorColorByAuthor,
    topReferences: [...referenceMap.values()].sort((a, b) => b.count - a.count || String(a.url).localeCompare(String(b.url))).slice(0, 16),
    topByScore: [...nodes].filter((node) => node.kind !== "repost").sort((a, b) => b.score - a.score || b.reach - a.reach).slice(0, 12),
    nodes,
    edges
  };
}

function buildHtmlReport(payload) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ariadex Flat Graph</title>
  <style>
    :root {
      --bg: #f3ede3;
      --paper: rgba(252, 248, 241, 0.96);
      --paper-strong: #fffaf2;
      --ink: #2f241a;
      --muted: #7b6957;
      --line: #d7c6b2;
      --root: #6a7b4f;
      --reply: #b85c38;
      --quote: #c48a3a;
      --repost: #b9ab99;
      --path: #d6b04d;
      --selected: #2f241a;
      --shadow: 0 18px 44px rgba(88, 58, 29, 0.14);
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
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 16px;
      background: rgba(251, 245, 235, 0.92);
      border-bottom: 1px solid var(--line);
      backdrop-filter: blur(8px);
    }
    .title { font-size: 14px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
    .meta { color: var(--muted); font-size: 12px; }
    .controls { display: flex; align-items: center; gap: 10px; }
    .controls input, .controls button {
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 9px 12px;
      background: var(--paper-strong);
      color: var(--ink);
      font: inherit;
    }
    .controls button { cursor: pointer; }
    .controls button:hover { background: #f3e6d7; }
    .score-control {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 250px;
      padding: 8px 12px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--paper-strong);
    }
    .score-control label {
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
      white-space: nowrap;
    }
    .score-control input[type="range"] {
      width: 100%;
      padding: 0;
      border: 0;
      background: transparent;
      accent-color: #b85c38;
    }
    .score-value {
      font-size: 12px;
      color: var(--muted);
      min-width: 48px;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .viewport { position: relative; overflow: hidden; }
    .stage { position: absolute; inset: 0; transform-origin: 0 0; }
    .edges { position: absolute; inset: 0; pointer-events: none; overflow: visible; }
    .nodes { position: absolute; inset: 0; }
    .node {
      position: absolute;
      width: 280px;
      min-height: 120px;
      padding: 12px 14px;
      border-radius: 16px;
      border: 3px solid var(--reply);
      background: var(--paper);
      box-shadow: var(--shadow);
      cursor: pointer;
      user-select: none;
      isolation: isolate;
      transform-origin: top left;
      transition:
        width 220ms cubic-bezier(0.2, 0.8, 0.2, 1),
        min-height 220ms cubic-bezier(0.2, 0.8, 0.2, 1),
        box-shadow 220ms cubic-bezier(0.2, 0.8, 0.2, 1),
        transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1),
        background 220ms ease,
        opacity 180ms ease;
    }
    .node.expanded {
      width: 420px;
      min-height: 220px;
      z-index: 5;
    }
    .node.expanded.expanding {
      width: 280px;
      min-height: 120px;
      transform: translateY(6px) scale(0.985);
      opacity: 0.96;
    }
    .node.expanded.collapsing {
      width: 280px;
      min-height: 120px;
      transform: translateY(4px) scale(0.985);
      opacity: 0.92;
    }
    .node.reply { border-color: var(--reply); }
    .node.quote { border-color: var(--quote); }
    .node.repost { border-color: var(--repost); opacity: 0.75; }
    .node.rootish { border-color: var(--root); }
    .node.path { box-shadow: 0 0 0 3px rgba(214,176,77,0.34), var(--shadow); }
    .node.selected { box-shadow: 0 0 0 4px rgba(47,36,26,0.16), 0 24px 56px rgba(88,58,29,0.18); transform: translateY(-2px); }
    .node.author-match { background: #fff9f0; }
    .node.reference-match {
      outline: 3px solid rgba(184,92,56,0.42);
      outline-offset: 5px;
      box-shadow:
        0 0 0 10px rgba(184,92,56,0.10),
        0 24px 48px rgba(120, 86, 57, 0.22);
      z-index: 16;
    }
    .node-stack {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 0;
      transition: transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 180ms ease;
    }
    .node-stack-card {
      position: absolute;
      inset: 0;
      border-radius: 16px;
      border: 2px solid rgba(123, 105, 87, 0.18);
      background: rgba(246, 237, 225, 0.88);
      box-shadow: 0 10px 24px rgba(88, 58, 29, 0.08);
      transition: transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 180ms ease;
    }
    .node-stack-card.layer-1 { transform: translate(8px, 8px) rotate(0.8deg); }
    .node-stack-card.layer-2 { transform: translate(14px, 14px) rotate(-1.2deg); }
    .node-stack-card.layer-3 { transform: translate(20px, 20px) rotate(0.9deg); }
    .node-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .node-header-main { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .node-body { position: relative; z-index: 1; }
    .node.expanded .node-stack-card.layer-1 { transform: translate(12px, 12px) rotate(1.2deg); }
    .node.expanded .node-stack-card.layer-2 { transform: translate(22px, 18px) rotate(-1.8deg); }
    .node.expanded .node-stack-card.layer-3 { transform: translate(30px, 26px) rotate(1.2deg); }
    .node-fold {
      position: absolute;
      top: 10px;
      right: 10px;
      width: 22px;
      height: 22px;
      border-radius: 0 10px 0 10px;
      background: rgba(47, 36, 26, 0.08);
      border: 1px solid rgba(47, 36, 26, 0.12);
      cursor: pointer;
      opacity: 0;
      transform: scale(0.88);
      transition: opacity 180ms ease, transform 180ms ease, background 180ms ease;
    }
    .node.expanded .node-fold { opacity: 1; transform: scale(1); }
    .node-fold::after {
      content: "";
      position: absolute;
      right: 4px;
      top: 4px;
      width: 8px;
      height: 8px;
      border-top: 2px solid rgba(47, 36, 26, 0.45);
      border-right: 2px solid rgba(47, 36, 26, 0.45);
      transform: rotate(0deg);
    }
    .node-author {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 999px;
      color: white;
      font-size: 11px;
      font-weight: 700;
      max-width: 170px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .node-author-name {
      display: block;
      font-size: 12px;
      font-weight: 800;
      line-height: 1.1;
      max-width: 170px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .node-author-handle {
      display: block;
      font-size: 10px;
      font-weight: 600;
      line-height: 1.1;
      opacity: 0.9;
      max-width: 170px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .attach-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 999px;
      border: 1px solid rgba(123, 105, 87, 0.25);
      background: rgba(255, 250, 242, 0.9);
      color: #8c6a2c;
      font-size: 12px;
      font-weight: 700;
      flex: 0 0 auto;
      cursor: pointer;
    }
    .node-score {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 5px 8px;
      border-radius: 999px;
      border: 1px solid rgba(123, 105, 87, 0.24);
      background: rgba(239, 228, 212, 0.92);
      color: #5a4633;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.02em;
      flex: 0 0 auto;
    }
    .node-kind { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; }
    .node-text { margin-top: 10px; font-size: 13px; line-height: 1.35; color: var(--ink); }
    .node-text.expanded {
      white-space: pre-wrap;
      max-height: none;
    }
    .deck-list {
      display: grid;
      gap: 8px;
      margin-top: 10px;
    }
    .deck-card {
      border: 1px solid var(--line);
      border-radius: 12px;
      background: rgba(255, 250, 242, 0.9);
      padding: 9px 10px;
    }
    .deck-card-title {
      font-size: 11px;
      color: var(--muted);
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .node-body .node-text { transition: opacity 180ms ease; }
    .node-footer { margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; color: var(--muted); font-size: 11px; }
    .metric { padding: 4px 7px; border-radius: 999px; background: #efe4d4; }
    .overlay {
      position: absolute;
      right: 16px;
      top: 16px;
      width: 320px;
      max-height: calc(100% - 32px);
      overflow: auto;
      background: rgba(251, 245, 235, 0.94);
      border: 1px solid var(--line);
      border-radius: 18px;
      box-shadow: var(--shadow);
      padding: 14px;
      backdrop-filter: blur(8px);
    }
    .reference-rail {
      position: absolute;
      left: 16px;
      top: 16px;
      width: 250px;
      max-height: calc(100% - 88px);
      overflow: auto;
      background: rgba(251, 245, 235, 0.94);
      border: 1px solid var(--line);
      border-radius: 18px;
      box-shadow: var(--shadow);
      padding: 14px;
      backdrop-filter: blur(8px);
    }
    .reference-rail h3 { margin: 0 0 10px; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
    .overlay h2, .overlay h3 { margin: 0 0 10px; }
    .section { margin-top: 16px; }
    .chip-list { display: grid; gap: 8px; }
    .chip {
      border: 1px solid var(--line);
      background: rgba(255,250,242,0.86);
      border-radius: 12px;
      padding: 10px 12px;
      cursor: pointer;
    }
    .chip:hover { background: #f2e6d8; }
    .chip strong { display: block; margin-bottom: 4px; }
    .chip small { color: var(--muted); display: block; }
    .reference-chip.active {
      background: #f2e0c8;
      box-shadow: inset 0 0 0 2px rgba(196, 138, 58, 0.35);
    }
    .help {
      position: absolute;
      left: 282px;
      bottom: 16px;
      padding: 10px 12px;
      background: rgba(251,245,235,0.92);
      border: 1px solid var(--line);
      border-radius: 12px;
      color: var(--muted);
      font-size: 12px;
    }
  </style>
</head>
<body>
  <main class="app">
    <div class="topbar">
      <div>
        <div class="title">Ariadex Flat Graph</div>
        <div class="meta">root ${escapeHtml(payload.canonicalRootId || "unknown")} · explored ${escapeHtml(payload.clickedTweetId || "unknown")} · tweets ${payload.stats.nodeCount}</div>
      </div>
      <div class="controls">
        <input id="search" type="search" placeholder="search tweet, author, id">
        <div class="score-control">
          <label for="scoreThreshold">Score</label>
          <input id="scoreThreshold" type="range" min="0" max="100" value="0">
          <span id="scoreValue" class="score-value">0.000</span>
        </div>
        <button id="resetView">Reset View</button>
        <button id="toggleReposts">Hide Reposts</button>
      </div>
    </div>
    <div class="viewport" id="viewport">
      <div class="stage" id="stage">
        <svg class="edges" id="edges"></svg>
        <div class="nodes" id="nodes"></div>
      </div>
      <aside class="reference-rail">
        <h3>Canonical References</h3>
        <div class="chip-list" id="referenceRail"></div>
      </aside>
      <aside class="overlay">
        <h2 id="inspectorTitle">Tweet</h2>
        <div id="inspectorMeta" class="meta"></div>
        <div id="inspectorText" class="section"></div>
        <div class="section">
          <h3>Top Authors</h3>
          <div class="chip-list" id="authors"></div>
        </div>
        <div class="section">
          <h3>References</h3>
          <div class="chip-list" id="references"></div>
        </div>
      </aside>
      <div class="help">Drag to pan. Mouse wheel to zoom. Click a tweet to focus it. Click an author or reference chip to highlight related tweets.</div>
    </div>
  </main>
  <script>
    const GRAPH = ${safeJson(payload)};
    const viewport = document.getElementById("viewport");
    const stage = document.getElementById("stage");
    const edgesSvg = document.getElementById("edges");
    const nodesRoot = document.getElementById("nodes");
    const authorsRoot = document.getElementById("authors");
    const referencesRoot = document.getElementById("references");
    const referenceRailRoot = document.getElementById("referenceRail");
    const inspectorTitle = document.getElementById("inspectorTitle");
    const inspectorMeta = document.getElementById("inspectorMeta");
    const inspectorText = document.getElementById("inspectorText");
    const searchInput = document.getElementById("search");
    const scoreThresholdInput = document.getElementById("scoreThreshold");
    const scoreValue = document.getElementById("scoreValue");
    const resetViewButton = document.getElementById("resetView");
    const toggleRepostsButton = document.getElementById("toggleReposts");

    const authorColorByAuthor = GRAPH.authorColorByAuthor || {};
    const clickedPathSet = new Set(Array.isArray(GRAPH.clickedPath) ? GRAPH.clickedPath : []);
    const nodeById = new Map(GRAPH.nodes.map((node) => [node.id, node]));
    const maxScore = GRAPH.nodes.reduce((max, node) => Math.max(max, Number(node.score || 0)), 0);
    const childrenByParent = new Map();
    for (const node of GRAPH.nodes) {
      const parentId = String(node.parentId || "").trim();
      if (!parentId) continue;
      if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
      childrenByParent.get(parentId).push(node);
    }
    for (const list of childrenByParent.values()) {
      list.sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
    }

    const state = {
      selectedId: GRAPH.clickedTweetId || GRAPH.canonicalRootId || GRAPH.nodes[0]?.id || "",
      expandedCardId: "",
      animateExpandId: "",
      focusedAuthor: "",
      focusedReference: "",
      hideReposts: true,
      search: "",
      scoreThreshold: Math.min(0.01, maxScore),
      scale: 0.85,
      tx: 80,
      ty: 60,
      dragging: false,
      dragX: 0,
      dragY: 0
    };
    state.focusedAuthor = nodeById.get(state.selectedId)?.author || "";
    state.expandedCardId = state.selectedId;

    function updateScoreUi() {
      scoreThresholdInput.value = maxScore > 0 ? String(Math.round((state.scoreThreshold / maxScore) * 100)) : "0";
      scoreValue.textContent = state.scoreThreshold.toFixed(3);
    }

    function emitLog(level, message, extra = {}) {
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({
            source: "ariadex-graph-report",
            type: "ariadex-log",
            payload: { level, message, ...extra }
          }, "*");
        }
      } catch {}
    }

    function escapeInline(value) {
      return String(value || "").replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char]));
    }

    function authorTagColor(author) {
      return authorColorByAuthor[String(author || "").trim()] || "#9aa3af";
    }

    function visibleNodes() {
      const query = state.search.trim().toLowerCase();
      return GRAPH.nodes.filter((node) => {
        if (state.hideReposts && node.kind === "repost") return false;
        if (Number(node.score || 0) < state.scoreThreshold && node.id !== state.selectedId && !clickedPathSet.has(node.id)) return false;
        if (!query) return true;
        const haystack = [node.id, node.author, node.authorName, node.text].join(" ").toLowerCase();
        return haystack.includes(query);
      });
    }

    function buildDisplayItems(nodes) {
      const items = [];
      const pathIds = new Set(Array.isArray(GRAPH.clickedPath) ? GRAPH.clickedPath : []);
      const visibleById = new Map(nodes.map((node) => [node.id, node]));
      const childrenByVisibleParent = new Map();
      for (const node of nodes) {
        const parentId = String(node.parentId || "").trim();
        if (!parentId || !visibleById.has(parentId)) continue;
        if (!childrenByVisibleParent.has(parentId)) childrenByVisibleParent.set(parentId, []);
        childrenByVisibleParent.get(parentId).push(node);
      }

      const assigned = new Set();
      const sameDeckLink = (left, right) => {
        if (!left || !right) return false;
        if (left.author !== right.author) return false;
        if (left.kind === "repost" || right.kind === "repost") return false;
        if (pathIds.has(left.id) || pathIds.has(right.id)) return false;
        return true;
      };
      const appendSingle = (node) => {
        items.push({
          id: node.id,
          parentId: node.parentId,
          kind: node.kind,
          author: node.author,
          authorName: node.authorName,
          representative: node,
          members: [node],
          external_urls: node.external_urls || [],
          isGroup: false
        });
        assigned.add(node.id);
      };

      for (const node of nodes) {
        if (assigned.has(node.id)) continue;
        if (pathIds.has(node.id) || node.kind === "repost") {
          appendSingle(node);
          continue;
        }

        let root = node;
        while (true) {
          const parent = visibleById.get(String(root.parentId || ""));
          if (!sameDeckLink(root, parent)) break;
          root = parent;
        }

        const queue = [root];
        const members = [];
        const seen = new Set();
        while (queue.length > 0) {
          const current = queue.shift();
          if (!current || seen.has(current.id) || assigned.has(current.id)) continue;
          if (!sameDeckLink(root, current) && current.id !== root.id) continue;
          seen.add(current.id);
          members.push(current);
          const parent = visibleById.get(String(current.parentId || ""));
          if (sameDeckLink(current, parent) && !seen.has(parent.id)) {
            queue.push(parent);
          }
          for (const child of childrenByVisibleParent.get(current.id) || []) {
            if (sameDeckLink(current, child) && !seen.has(child.id)) {
              queue.push(child);
            }
          }
        }

        if (members.length <= 1) {
          appendSingle(node);
          continue;
        }

        const memberIdSet = new Set(members.map((member) => member.id));
        const parentOutsideGroupByMember = (member) => {
          const parentId = String(member.parentId || "").trim();
          return parentId && !memberIdSet.has(parentId) ? parentId : "";
        };
        members.sort((left, right) => {
          const leftIsRoot = parentOutsideGroupByMember(left) ? 1 : 0;
          const rightIsRoot = parentOutsideGroupByMember(right) ? 1 : 0;
          if (leftIsRoot !== rightIsRoot) return rightIsRoot - leftIsRoot;
          return String(left.id).localeCompare(String(right.id));
        });
        const representative = members[0];
        const mergedUrls = [...new Set(members.flatMap((member) => Array.isArray(member.external_urls) ? member.external_urls : []))];
        items.push({
          id: "group:" + representative.id,
          parentId: parentOutsideGroupByMember(representative) || representative.parentId,
          kind: representative.kind,
          author: representative.author,
          authorName: representative.authorName,
          representative,
          members,
          external_urls: mergedUrls,
          isGroup: true
        });
        for (const member of members) {
          assigned.add(member.id);
        }
      }

      return items;
    }

    function computeLayout(items) {
      const visibleSet = new Set(items.map((item) => item.id));
      const positioned = new Map();
      const centerX = 860;
      const pathGap = 220;
      const branchGapX = 118;
      const branchGapY = 34;
      const padX = 26;
      const padY = 24;
      const dimsById = new Map(items.map((item) => [item.id, dimensionForItem(item)]));

      const pathIds = items.filter((item) => clickedPathSet.has(item.id)).map((item) => item.id);
      pathIds.forEach((id, index) => {
        const dims = dimsById.get(id) || { w: 280, h: 124 };
        positioned.set(id, { x: centerX, y: 120 + (index * pathGap), w: dims.w, h: dims.h });
      });

      if (pathIds.length === 0 && GRAPH.canonicalRootId && visibleSet.has(GRAPH.canonicalRootId)) {
        const dims = dimsById.get(GRAPH.canonicalRootId) || { w: 280, h: 124 };
        positioned.set(GRAPH.canonicalRootId, { x: centerX, y: 120, w: dims.w, h: dims.h });
      }

      const fallbackAnchor = pathIds[pathIds.length - 1] || GRAPH.canonicalRootId || items[0]?.id || "";
      const parentBuckets = new Map();
      for (const item of items) {
        if (positioned.has(item.id)) continue;
        const parentId = positioned.has(item.parentId) ? item.parentId : fallbackAnchor;
        if (!parentBuckets.has(parentId)) {
          parentBuckets.set(parentId, { reply: [], quote: [], repost: [] });
        }
        const bucket = parentBuckets.get(parentId);
        const side = item.kind === "quote" ? "quote" : (item.kind === "repost" ? "repost" : "reply");
        bucket[side].push(item);
      }

      for (const [parentId, bucket] of parentBuckets.entries()) {
        const parent = positioned.get(parentId) || { x: centerX, y: 120, w: 280, h: 124 };
        const place = (list, xDir, yStartOffset) => {
          list.forEach((item, index) => {
            const dims = dimsById.get(item.id) || { w: 280, h: 124 };
            positioned.set(item.id, {
              x: parent.x + (xDir * ((parent.w / 2) + (dims.w / 2) + branchGapX)),
              y: parent.y + yStartOffset + (index * (dims.h + branchGapY)),
              w: dims.w,
              h: dims.h
            });
          });
        };
        const verticalSpan = (list) => list.reduce((total, item, index) => {
          const dims = dimsById.get(item.id) || { h: 124 };
          return total + dims.h + (index === list.length - 1 ? 0 : branchGapY);
        }, 0);
        place(bucket.reply, -1, -Math.max(0, verticalSpan(bucket.reply) / 2));
        place(bucket.quote, 1, -Math.max(0, verticalSpan(bucket.quote) / 2));
        place(bucket.repost, 1.65, -Math.max(0, verticalSpan(bucket.repost) / 2));
      }

      const unplaced = items.filter((item) => !positioned.has(item.id));
      unplaced.forEach((item, index) => {
        const dims = dimsById.get(item.id) || { w: 280, h: 124 };
        positioned.set(item.id, { x: 80 + ((index % 3) * 360), y: 120 + (index * (dims.h + 40)), w: dims.w, h: dims.h });
      });

      const lockedIds = new Set(pathIds);
      if (GRAPH.canonicalRootId && visibleSet.has(GRAPH.canonicalRootId)) {
        lockedIds.add(GRAPH.canonicalRootId);
      }

      const overlapAmount = (left, right) => {
        const dx = (left.x + (left.w / 2)) - (right.x + (right.w / 2));
        const dy = (left.y + (left.h / 2)) - (right.y + (right.h / 2));
        const ox = ((left.w + right.w) / 2) + padX - Math.abs(dx);
        const oy = ((left.h + right.h) / 2) + padY - Math.abs(dy);
        if (ox <= 0 || oy <= 0) {
          return null;
        }
        return { dx, dy, ox, oy };
      };

      const itemIds = items.map((item) => item.id);
      for (let iteration = 0; iteration < 16; iteration += 1) {
        let moved = false;
        for (let i = 0; i < itemIds.length; i += 1) {
          for (let j = i + 1; j < itemIds.length; j += 1) {
            const leftId = itemIds[i];
            const rightId = itemIds[j];
            const left = positioned.get(leftId);
            const right = positioned.get(rightId);
            if (!left || !right) continue;
            const overlap = overlapAmount(left, right);
            if (!overlap) continue;
            moved = true;
            const leftLocked = lockedIds.has(leftId);
            const rightLocked = lockedIds.has(rightId);
            const pushX = overlap.ox + 2;
            const pushY = overlap.oy + 2;
            if (pushX < pushY) {
              const direction = overlap.dx >= 0 ? 1 : -1;
              if (leftLocked && rightLocked) {
                right.x -= direction * pushX;
              } else if (leftLocked) {
                right.x -= direction * pushX;
              } else if (rightLocked) {
                left.x += direction * pushX;
              } else {
                left.x += direction * (pushX / 2);
                right.x -= direction * (pushX / 2);
              }
            } else {
              const direction = overlap.dy >= 0 ? 1 : -1;
              if (leftLocked && rightLocked) {
                right.y -= direction * pushY;
              } else if (leftLocked) {
                right.y -= direction * pushY;
              } else if (rightLocked) {
                left.y += direction * pushY;
              } else {
                left.y += direction * (pushY / 2);
                right.y -= direction * (pushY / 2);
              }
            }
          }
        }
        if (!moved) break;
      }

      return positioned;
    }

    function applyTransform() {
      stage.style.transform = \`translate(\${state.tx}px, \${state.ty}px) scale(\${state.scale})\`;
    }

    function bestNodeForReference(referenceUrl) {
      return GRAPH.nodes
        .filter((item) => Array.isArray(item.external_urls) && item.external_urls.includes(referenceUrl))
        .sort((left, right) => right.score - left.score || right.reach - left.reach || String(left.id).localeCompare(String(right.id)))[0] || null;
    }

    function dimensionForItem(item) {
      const score = Number(item?.representative?.score || 0);
      const scoreRatio = maxScore > 0 ? Math.sqrt(Math.max(0, score) / maxScore) : 0;
      let factor = 0.94 + (scoreRatio * 0.16);
      if (item.members.some((member) => clickedPathSet.has(member.id))) factor += 0.03;
      if (item.representative?.isRoot || item.id === GRAPH.canonicalRootId) factor += 0.04;
      if (item.members.some((member) => member.id === state.selectedId)) factor += 0.05;
      if (item.id === state.expandedCardId) factor += 0.08;
      factor = Math.max(0.92, Math.min(1.18, factor));
      return {
        w: Math.round(280 * factor),
        h: Math.round(124 * factor)
      };
    }

    function render() {
      const nodes = visibleNodes();
      const items = buildDisplayItems(nodes);
      const layout = computeLayout(items);
      const visibleRawSet = new Set(nodes.map((node) => node.id));
      const rawToDisplayId = new Map();
      for (const item of items) {
        for (const member of item.members) {
          rawToDisplayId.set(member.id, item.id);
        }
      }
      if (state.expandedCardId && rawToDisplayId.has(state.expandedCardId)) {
        state.expandedCardId = rawToDisplayId.get(state.expandedCardId);
      }

      nodesRoot.innerHTML = "";
      edgesSvg.innerHTML = "";
      edgesSvg.setAttribute("width", "2800");
      edgesSvg.setAttribute("height", "2400");
      edgesSvg.setAttribute("viewBox", "0 0 2800 2400");

      for (const edge of GRAPH.edges) {
        if (!visibleRawSet.has(edge.source) || !visibleRawSet.has(edge.target)) continue;
        const sourceId = rawToDisplayId.get(edge.source);
        const targetId = rawToDisplayId.get(edge.target);
        if (!sourceId || !targetId || sourceId === targetId) continue;
        const source = layout.get(sourceId);
        const target = layout.get(targetId);
        if (!source || !target) continue;
        const x1 = source.x + (source.w / 2);
        const y1 = source.y + (source.h / 2);
        const x2 = target.x + (target.w / 2);
        const y2 = target.y + (target.h / 2);
        const isSelectedEdge = edge.source === state.selectedId || edge.target === state.selectedId;
        const isQuote = edge.type === "quote";
        const isRepost = edge.type === "repost";
        const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
        line.setAttribute("d", \`M \${x1} \${y1} C \${(x1 + x2) / 2} \${y1}, \${(x1 + x2) / 2} \${y2}, \${x2} \${y2}\`);
        line.setAttribute("fill", "none");
        line.setAttribute("stroke", isQuote ? "#b85c38" : (isRepost ? "#cbc3b8" : "#5f88c6"));
        line.setAttribute("stroke-opacity", isSelectedEdge ? (isQuote ? "0.95" : "0.82") : (isQuote ? "0.42" : (isRepost ? "0.16" : "0.28")));
        line.setAttribute("stroke-width", isSelectedEdge ? (isQuote ? "4.5" : "3.2") : (isQuote ? "3.2" : (isRepost ? "1.4" : "2.2")));
        line.setAttribute("stroke-linecap", isQuote ? "round" : "butt");
        if (isQuote) {
          line.setAttribute("stroke-dasharray", isSelectedEdge ? "12 8" : "9 7");
        } else if (isRepost) {
          line.setAttribute("stroke-dasharray", "2 9");
        }
        edgesSvg.appendChild(line);
      }

      const renderedEdgeKeys = new Set();
      edgesSvg.querySelectorAll("path").forEach((pathElement) => {
        const key = pathElement.getAttribute("d");
        if (key) renderedEdgeKeys.add(key);
      });

      for (const item of items) {
        const node = item.representative;
        const pos = layout.get(item.id);
        const element = document.createElement("article");
        const classes = ["node", node.kind];
        if (item.members.some((member) => clickedPathSet.has(member.id))) classes.push("path");
        if (item.members.some((member) => member.id === state.selectedId)) classes.push("selected");
        if (item.id === state.expandedCardId) classes.push("expanded");
        if (item.id === state.animateExpandId) classes.push("expanding");
        if (state.focusedAuthor && node.author === state.focusedAuthor) classes.push("author-match");
        if (state.focusedReference && Array.isArray(item.external_urls) && item.external_urls.includes(state.focusedReference)) classes.push("reference-match");
        const localChildren = item.members.flatMap((member) => Array.isArray(childrenByParent.get(member.id)) ? childrenByParent.get(member.id) : []);
        const threadLikeCount = localChildren.filter((child) => child.kind !== "repost").length + item.members.length;
        const stackLayers = Math.max(0, Math.min(3, threadLikeCount - 1));
        const isExpanded = item.id === state.expandedCardId;
        const expandedWidth = Math.max(420, pos.w + 120);
        const expandedHeight = Math.max(220, pos.h + 96);
        element.className = classes.join(" ");
        element.dataset.nodeId = item.id;
        element.style.left = pos.x + "px";
        element.style.top = pos.y + "px";
        element.style.width = (isExpanded ? expandedWidth : pos.w) + "px";
        element.style.minHeight = (isExpanded ? expandedHeight : pos.h) + "px";
        const stackHtml = Array.from({ length: stackLayers }, (_, index) => '<div class="node-stack-card layer-' + (index + 1) + '"></div>').join("");
        const expandedDeckHtml = item.isGroup && isExpanded
          ? '<div class="deck-list">' + item.members.map((member, index) => '<div class="deck-card"><div class="deck-card-title">Card ' + (index + 1) + ' · ' + member.kind + '</div>' + escapeInline(member.text) + '</div>').join("") + '</div>'
          : '';
        element.innerHTML = \`
          <div class="node-stack">\${stackHtml}</div>
          <div class="node-body">
            \${isExpanded ? '<button class="node-fold" type="button" aria-label="Collapse tweet"></button>' : ""}
            <div class="node-header">
              <div class="node-header-main">
                <span class="node-author" style="background:\${authorTagColor(node.author)}">
                  <span class="node-author-name">\${escapeInline(node.authorName || node.author)}</span>
                  <span class="node-author-handle">\${escapeInline(node.author)}</span>
                </span>
                <span class="node-score">score \${node.score.toFixed(3)}</span>
                \${Array.isArray(node.external_urls) && node.external_urls.length > 0 ? '<button class="attach-badge" type="button" aria-label="Show references">+</button>' : ""}
              </div>
              <span class="node-kind">\${escapeInline(node.kind)}\${item.isGroup ? " · deck" : (stackLayers > 0 ? " · thread" : "")}</span>
            </div>
            <div class="node-text \${isExpanded ? "expanded" : ""}">\${escapeInline(isExpanded && !item.isGroup ? node.text : node.text.slice(0, 210))}</div>
            \${expandedDeckHtml}
            <div class="node-footer">
              <span class="metric">score \${node.score.toFixed(3)}</span>
              <span class="metric">likes \${node.likes}</span>
              <span class="metric">followers \${node.followers}</span>
              \${item.members.length > 1 ? '<span class="metric">cards ' + item.members.length + '</span>' : (threadLikeCount > 1 ? '<span class="metric">cards ' + threadLikeCount + '</span>' : "")}
            </div>
          </div>
        \`;
        element.addEventListener("click", () => {
          state.selectedId = node.id;
          if (state.expandedCardId !== item.id) {
            state.animateExpandId = item.id;
          }
          state.expandedCardId = item.id;
          state.focusedAuthor = node.author || "";
          state.focusedReference = "";
          renderInspector();
          render();
          emitLog(item.isGroup ? "tweet" : "tweet", item.isGroup ? "Opened thread deck" : "Selected tweet node", { tweetId: node.id, author: node.author });
        });
        const foldButton = element.querySelector(".node-fold");
        if (foldButton) {
          foldButton.addEventListener("click", (event) => {
            event.stopPropagation();
            const current = event.currentTarget.closest(".node");
            if (current) {
              current.classList.add("collapsing");
            }
            window.setTimeout(() => {
              state.expandedCardId = "";
              state.animateExpandId = "";
              render();
              emitLog("tweet", item.isGroup ? "Collapsed thread deck" : "Collapsed tweet card", { tweetId: node.id, author: node.author });
            }, 180);
          });
        }
        const attachButton = element.querySelector(".attach-badge");
        if (attachButton) {
          attachButton.addEventListener("click", (event) => {
            event.stopPropagation();
            const firstRef = Array.isArray(item.external_urls) ? item.external_urls[0] : "";
            if (!firstRef) {
              return;
            }
            const candidate = bestNodeForReference(firstRef);
            state.focusedReference = firstRef;
            state.selectedId = candidate?.id || node.id;
            state.expandedCardId = rawToDisplayId.get(candidate?.id || "") || item.id;
            state.focusedAuthor = "";
            renderInspector();
            render();
            emitLog("reference", "Highlighted tweets with reference", { url: firstRef, tweetId: candidate?.id || node.id, author: candidate?.author || node.author });
          });
        }
        nodesRoot.appendChild(element);
      }

      if (state.animateExpandId) {
        const target = nodesRoot.querySelector('[data-node-id="' + state.animateExpandId.replace(/"/g, '\\"') + '"]');
        if (target) {
          window.requestAnimationFrame(() => {
            target.classList.remove("expanding");
          });
        }
        window.setTimeout(() => {
          state.animateExpandId = "";
        }, 240);
      }

      applyTransform();
    }

    function renderInspector() {
      const node = nodeById.get(state.selectedId);
      if (!node) return;
      inspectorTitle.textContent = node.authorName || node.author;
      inspectorMeta.textContent = \`\${node.author} · tweet \${node.id} · \${node.kind} · score \${node.score.toFixed(3)} · reach \${node.reach.toFixed(1)}\`;
      inspectorText.innerHTML = \`<div class="chip"><strong>Tweet</strong><small>\${escapeInline(node.text)}</small></div>\`;

      authorsRoot.innerHTML = GRAPH.topAuthors.map((entry) => \`
        <div class="chip" data-author="\${entry.author}">
          <strong style="color:\${entry.color}">\${entry.author}</strong>
          <small>score \${entry.totalScore.toFixed(3)} · tweets \${entry.tweetCount}</small>
        </div>
      \`).join("");
      authorsRoot.querySelectorAll("[data-author]").forEach((element) => {
        element.addEventListener("click", () => {
          const author = element.getAttribute("data-author") || "";
          const candidate = GRAPH.nodes.filter((item) => item.author === author).sort((a, b) => b.score - a.score)[0];
          if (!candidate) return;
          state.selectedId = candidate.id;
          state.expandedCardId = candidate.id;
          state.focusedAuthor = author;
          state.focusedReference = "";
          renderInspector();
          render();
          emitLog("author", "Focused author", { author, tweetId: candidate.id });
        });
      });

      referencesRoot.innerHTML = GRAPH.topReferences.map((entry) => \`
        <div class="chip" data-ref="\${entry.url}">
          <strong>\${entry.domain || "reference"}</strong>
          <small>\${entry.count} cites · \${escapeInline(entry.url)}</small>
        </div>
      \`).join("");
      referenceRailRoot.innerHTML = GRAPH.topReferences.map((entry) => \`
        <div class="chip reference-chip \${state.focusedReference === entry.url ? "active" : ""}" data-rail-ref="\${entry.url}">
          <strong>\${entry.domain || "reference"}</strong>
          <small>\${entry.count} cites</small>
        </div>
      \`).join("");
      referencesRoot.querySelectorAll("[data-ref]").forEach((element) => {
        element.addEventListener("click", () => {
          const ref = element.getAttribute("data-ref") || "";
          const candidate = bestNodeForReference(ref);
          state.focusedReference = ref;
          if (candidate) {
            state.selectedId = candidate.id;
            state.expandedCardId = rawToDisplayId.get(candidate.id) || candidate.id;
          }
          state.focusedAuthor = "";
          renderInspector();
          render();
          emitLog("reference", "Highlighted tweets with reference", { url: ref, tweetId: candidate?.id || "", author: candidate?.author || "" });
        });
      });
      referenceRailRoot.querySelectorAll("[data-rail-ref]").forEach((element) => {
        element.addEventListener("click", () => {
          const ref = element.getAttribute("data-rail-ref") || "";
          const candidate = bestNodeForReference(ref);
          state.focusedReference = ref;
          if (candidate) {
            state.selectedId = candidate.id;
            state.expandedCardId = rawToDisplayId.get(candidate.id) || candidate.id;
          }
          state.focusedAuthor = "";
          renderInspector();
          render();
          emitLog("reference", "Highlighted tweets with canonical reference", { url: ref, tweetId: candidate?.id || "", author: candidate?.author || "" });
        });
      });
    }

    viewport.addEventListener("wheel", (event) => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      const worldX = (mouseX - state.tx) / state.scale;
      const worldY = (mouseY - state.ty) / state.scale;
      const nextScale = event.deltaY < 0 ? state.scale * 1.08 : state.scale / 1.08;
      state.scale = Math.max(0.35, Math.min(2.2, nextScale));
      state.tx = mouseX - (worldX * state.scale);
      state.ty = mouseY - (worldY * state.scale);
      applyTransform();
    }, { passive: false });

    viewport.addEventListener("mousedown", (event) => {
      if (event.target.closest(".node") || event.target.closest(".overlay") || event.target.closest(".topbar")) return;
      state.dragging = true;
      state.dragX = event.clientX;
      state.dragY = event.clientY;
    });

    window.addEventListener("mousemove", (event) => {
      if (!state.dragging) return;
      state.tx += event.clientX - state.dragX;
      state.ty += event.clientY - state.dragY;
      state.dragX = event.clientX;
      state.dragY = event.clientY;
      applyTransform();
    });

    window.addEventListener("mouseup", () => {
      state.dragging = false;
    });

    searchInput.addEventListener("input", () => {
      state.search = searchInput.value;
      render();
    });

    scoreThresholdInput.addEventListener("input", () => {
      const ratio = Number(scoreThresholdInput.value || 0) / 100;
      state.scoreThreshold = maxScore * ratio;
      updateScoreUi();
      render();
      emitLog("system", "Adjusted score threshold", {
        tweetId: state.selectedId,
        author: state.focusedAuthor,
        url: "score>=" + state.scoreThreshold.toFixed(3)
      });
    });

    resetViewButton.addEventListener("click", () => {
      state.scale = 0.85;
      state.tx = 80;
      state.ty = 60;
      applyTransform();
      emitLog("system", "Reset graph view", { tweetId: state.selectedId, author: state.focusedAuthor });
    });

    toggleRepostsButton.addEventListener("click", () => {
      state.hideReposts = !state.hideReposts;
      toggleRepostsButton.textContent = state.hideReposts ? "Show Reposts" : "Hide Reposts";
      render();
      emitLog("system", state.hideReposts ? "Hid repost nodes" : "Showed repost nodes", { tweetId: state.selectedId, author: state.focusedAuthor });
    });

    updateScoreUi();
    renderInspector();
    render();
    emitLog("system", "Graph loaded", { tweetId: state.selectedId, author: state.focusedAuthor });
  </script>
</body>
</html>`;
}

async function renderConversationGraphReport(rawArgs = process.argv.slice(2)) {
  const args = parseArgs(rawArgs);
  if (args.help) {
    return { exitCode: 0, stdout: `${usage()}\n` };
  }
  if (!args.fixture) {
    throw new Error("Missing required --fixture <path>");
  }

  const fixturePath = path.resolve(args.fixture);
  const dataset = await loadConversationDataset({ kind: "fixture", path: fixturePath });
  const payload = buildGraphPayload(dataset, fixturePath);
  const rawFixture = JSON.parse(await fs.readFile(fixturePath, "utf8"));
  payload.capturedAt = String(rawFixture?.capturedAt || "").trim() || null;

  const outputPath = args.output
    ? path.resolve(args.output)
    : defaultOutputPath({ outputDir: args.outputDir, fixturePath, canonicalRootId: dataset.canonicalRootId });

  const html = buildHtmlReport(payload);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${html}\n`, "utf8");

  return { exitCode: 0, outputPath, payload };
}

async function main() {
  try {
    const result = await renderConversationGraphReport(process.argv.slice(2));
    if (result?.stdout) {
      process.stdout.write(result.stdout);
      return;
    }
    process.stdout.write(`${result.outputPath}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}

module.exports = {
  DEFAULT_OUTPUT_DIR,
  buildGraphPayload,
  buildHtmlReport,
  defaultOutputPath,
  parseArgs,
  renderConversationGraphReport,
  usage
};
