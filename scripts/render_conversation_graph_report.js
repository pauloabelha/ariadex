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
  const incomingCounts = new Map();
  const outgoingCounts = new Map();
  const degreeCounts = new Map();
  const edgeKindsByNode = new Map();

  for (const edge of Array.isArray(graph?.edges) ? graph.edges : []) {
    const source = String(edge?.source || "");
    const target = String(edge?.target || "");
    if (!source || !target) {
      continue;
    }
    incomingCounts.set(target, (incomingCounts.get(target) || 0) + 1);
    outgoingCounts.set(source, (outgoingCounts.get(source) || 0) + 1);
    degreeCounts.set(source, (degreeCounts.get(source) || 0) + 1);
    degreeCounts.set(target, (degreeCounts.get(target) || 0) + 1);
    if (!edgeKindsByNode.has(source)) {
      edgeKindsByNode.set(source, new Set());
    }
    if (!edgeKindsByNode.has(target)) {
      edgeKindsByNode.set(target, new Set());
    }
    edgeKindsByNode.get(source).add(String(edge?.type || "unknown"));
    edgeKindsByNode.get(target).add(String(edge?.type || "unknown"));
  }

  const nodes = tweets.map((tweet) => {
    const id = String(tweet.id);
    const author = String(tweet.author || "@unknown");
    const isClicked = dataset?.clickedTweetId ? id === String(dataset.clickedTweetId) : false;
    const isRoot = dataset?.canonicalRootId ? id === String(dataset.canonicalRootId) : false;
    const parentId = inferParentId(tweet);
    const kind = tweet.repost_of
      ? "repost"
      : (tweet.quote_of ? "quote" : (tweet.reply_to ? "reply" : "rootish"));
    const reach = computeReach(tweet);
    return {
      id,
      author,
      authorName: String(tweet?.author_profile?.name || author),
      text: String(tweet.text || "").trim(),
      url: String(tweet.url || "").trim(),
      external_urls: Array.isArray(tweet.external_urls) ? tweet.external_urls.map((value) => String(value || "").trim()).filter(Boolean) : [],
      parentId,
      quoteOf: tweet.quote_of ? String(tweet.quote_of) : null,
      replyTo: tweet.reply_to ? String(tweet.reply_to) : null,
      repostOf: tweet.repost_of ? String(tweet.repost_of) : null,
      kind,
      isRoot,
      isClicked,
      score: Number(scoreById.get(id) || 0),
      reach,
      followers: followerCount(tweet),
      likes: readMetric(tweet, "like_count", "likes"),
      reposts: readMetric(tweet, "retweet_count", "reposts"),
      replies: readMetric(tweet, "reply_count", "replies"),
      quotes: readMetric(tweet, "quote_count", "quote_count"),
      incoming: incomingCounts.get(id) || 0,
      outgoing: outgoingCounts.get(id) || 0,
      degree: degreeCounts.get(id) || 0,
      edgeKinds: [...(edgeKindsByNode.get(id) || [])]
    };
  });

  const edges = (Array.isArray(graph?.edges) ? graph.edges : []).map((edge, index) => ({
    id: `${String(edge?.type || "edge")}:${String(edge?.source || "")}:${String(edge?.target || "")}:${index}`,
    source: String(edge?.source || ""),
    target: String(edge?.target || ""),
    type: String(edge?.type || "reply")
  }));

  const clickedPath = buildPathToRoot(tweetById, dataset?.clickedTweetId);
  const clickedPathSet = new Set(clickedPath);
  const authorAggregate = new Map();
  for (const node of nodes) {
    if (node.kind === "repost") {
      continue;
    }
    const author = String(node.author || "").trim();
    if (!author) {
      continue;
    }
    if (!authorAggregate.has(author)) {
      authorAggregate.set(author, {
        author,
        totalScore: 0,
        tweetCount: 0
      });
    }
    const entry = authorAggregate.get(author);
    entry.totalScore += Number(node.score || 0);
    entry.tweetCount += 1;
  }
  const authorPalette = [
    "#1473e6",
    "#ff5a36",
    "#16a34a",
    "#8b5cf6",
    "#ffcc00",
    "#ef4444",
    "#06b6d4",
    "#f97316"
  ];
  const topAuthors = [...authorAggregate.values()]
    .sort((a, b) => b.totalScore - a.totalScore || b.tweetCount - a.tweetCount || String(a.author).localeCompare(String(b.author)))
    .slice(0, authorPalette.length)
    .map((entry, index) => ({
      ...entry,
      color: authorPalette[index]
    }));
  const authorColorByAuthor = Object.fromEntries(topAuthors.map((entry) => [entry.author, entry.color]));
  const referenceMap = new Map();
  const normalizeReferenceUrl = (rawUrl) => {
    const trimmed = String(rawUrl || "").trim();
    if (!trimmed) {
      return "";
    }
    try {
      const parsed = new URL(trimmed);
      const host = parsed.hostname.toLowerCase();
      if (host === "x.com" || host === "twitter.com" || host === "www.x.com" || host === "www.twitter.com" || host === "t.co") {
        return "";
      }
      parsed.hash = "";
      return parsed.toString();
    } catch {
      return "";
    }
  };
  for (const tweet of tweets) {
    const tweetId = String(tweet?.id || "").trim();
    if (!tweetId) {
      continue;
    }
    const urls = Array.isArray(tweet?.external_urls) ? tweet.external_urls : [];
    for (const rawUrl of urls) {
      const normalized = normalizeReferenceUrl(rawUrl);
      if (!normalized) {
        continue;
      }
      if (!referenceMap.has(normalized)) {
        let domain = "";
        try {
          domain = new URL(normalized).hostname.replace(/^www\./, "");
        } catch {}
        referenceMap.set(normalized, {
          url: normalized,
          domain,
          count: 0,
          tweetIds: []
        });
      }
      const entry = referenceMap.get(normalized);
      entry.count += 1;
      if (!entry.tweetIds.includes(tweetId)) {
        entry.tweetIds.push(tweetId);
      }
    }
  }
  const topReferences = [...referenceMap.values()]
    .sort((a, b) => b.count - a.count || b.tweetIds.length - a.tweetIds.length || String(a.url).localeCompare(String(b.url)))
    .slice(0, 16);
  const topByScore = [...nodes]
    .filter((node) => node.kind !== "repost")
    .sort((a, b) => b.score - a.score || b.reach - a.reach || String(a.id).localeCompare(String(b.id)))
    .slice(0, 12);

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
      replyCount: nodes.filter((node) => node.kind === "reply").length,
      rootishCount: nodes.filter((node) => node.kind === "rootish").length
    },
    clickedPath,
    clickedPathSet: [...clickedPathSet],
    topAuthors,
    authorColorByAuthor,
    topReferences,
    topByScore,
    nodes,
    edges
  };
}

function buildHtmlReport(payload) {
  const summaryPills = [
    `tweets ${payload.stats.nodeCount}`,
    `edges ${payload.stats.edgeCount}`,
    `replies ${payload.stats.replyCount}`,
    `quotes ${payload.stats.quoteCount}`,
    `reposts ${payload.stats.repostCount}`
  ].map((label) => `<span class="pill">${escapeHtml(label)}</span>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ariadex Conversation Graph</title>
  <style>
    :root {
      --bg: #f3f2ee;
      --panel: rgba(255, 255, 252, 0.92);
      --panel-strong: #ffffff;
      --ink: #111111;
      --muted: #68707c;
      --line: #d8dde6;
      --accent: #ff5a36;
      --accent-soft: #ffe0d8;
      --reply: #1473e6;
      --quote: #ff5a36;
      --repost: #b9bec7;
      --root: #16a34a;
      --clicked: #111111;
      --path: #ffcc00;
      --glow: rgba(255, 90, 54, 0.16);
      --shadow: 0 18px 52px rgba(17, 17, 17, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      background:
        radial-gradient(circle at top right, rgba(255, 90, 54, 0.08), transparent 22%),
        radial-gradient(circle at left 20%, rgba(20, 115, 230, 0.06), transparent 20%),
        linear-gradient(180deg, #f8f8f5 0%, #eceff3 100%);
      font-family: "SF Pro Display", "Avenir Next", "Helvetica Neue", Arial, sans-serif;
    }
    .shell {
      display: grid;
      grid-template-columns: 250px minmax(0, 1.6fr) 300px;
      gap: 16px;
      min-height: 100vh;
      padding: 16px;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 24px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(8px);
    }
    .sidebar, .inspector {
      padding: 18px;
      overflow: auto;
    }
    .main {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      gap: 16px;
      min-height: 0;
    }
    .hero {
      padding: 22px;
    }
    .hero h1 {
      margin: 0 0 10px;
      font-size: 32px;
      line-height: 1;
      letter-spacing: -0.02em;
    }
    .hero p {
      margin: 0;
      color: var(--muted);
      font-size: 15px;
      line-height: 1.45;
    }
    .pill-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 14px;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border-radius: 999px;
      background: #f3ece1;
      border: 1px solid var(--line);
      padding: 7px 10px;
      color: var(--ink);
      font-size: 13px;
    }
    .graph-card {
      position: relative;
      overflow: hidden;
      min-height: calc(100vh - 170px);
      background:
        radial-gradient(circle at top, rgba(255,255,255,0.6), transparent 30%),
        radial-gradient(circle at 50% 120%, rgba(20,115,230,0.08), transparent 34%),
        linear-gradient(180deg, rgba(255,255,252,0.96), rgba(243,246,250,0.94));
    }
    .graph-toolbar {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
      background: rgba(255, 252, 247, 0.92);
    }
    .control {
      display: grid;
      gap: 6px;
    }
    .control label {
      font-size: 12px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    select, input[type="search"] {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 10px 12px;
      background: var(--panel-strong);
      color: var(--ink);
      font: inherit;
    }
    .toggle-row {
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
    }
    .toggle {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--muted);
      font-size: 13px;
    }
    .canvas-shell {
      position: relative;
      height: 100%;
      min-height: calc(100vh - 250px);
      background:
        linear-gradient(180deg, rgba(255,255,255,0.16), rgba(255,255,255,0)),
        radial-gradient(circle at center, rgba(255, 90, 54, 0.07), transparent 42%),
        radial-gradient(circle at 50% 88%, rgba(17,17,17,0.08), transparent 38%);
    }
    canvas {
      display: block;
      width: 100%;
      height: calc(100% - 0px);
    }
    .depth-wash {
      position: absolute;
      inset: 0;
      background:
        radial-gradient(circle at 50% 35%, rgba(255,255,255,0.26), transparent 26%),
        radial-gradient(circle at 50% 86%, rgba(17,17,17,0.06), transparent 34%);
      pointer-events: none;
      mix-blend-mode: screen;
    }
    .hint {
      position: absolute;
      left: 16px;
      bottom: 16px;
      padding: 10px 12px;
      background: rgba(255, 252, 247, 0.9);
      background: rgba(255, 255, 252, 0.92);
      border: 1px solid var(--line);
      border-radius: 14px;
      color: var(--muted);
      font-size: 12px;
      pointer-events: none;
    }
    .tooltip {
      position: absolute;
      z-index: 4;
      min-width: 220px;
      max-width: 320px;
      padding: 12px 14px;
      border-radius: 16px;
      border: 1px solid var(--line);
      background: rgba(255, 252, 247, 0.96);
      background: rgba(255, 255, 252, 0.96);
      box-shadow: 0 16px 36px rgba(71, 48, 18, 0.16);
      backdrop-filter: blur(8px);
      pointer-events: none;
      opacity: 0;
      transform: translateY(4px);
      transition: opacity 120ms ease, transform 120ms ease;
    }
    .tooltip.visible {
      opacity: 1;
      transform: translateY(0);
    }
    .tooltip-title {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      font-weight: 700;
      font-size: 14px;
    }
    .tooltip-subtle {
      margin-top: 2px;
      color: var(--muted);
      font-size: 12px;
    }
    .tooltip-metrics {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-top: 10px;
    }
    .tooltip-metric {
      padding: 8px 10px;
      border-radius: 12px;
      background: rgba(243, 236, 225, 0.8);
      border: 1px solid rgba(216, 207, 194, 0.9);
    }
    .tooltip-metric-label {
      display: block;
      color: var(--muted);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .tooltip-metric-value {
      display: block;
      margin-top: 2px;
      font-size: 13px;
      font-weight: 700;
    }
    .section-title {
      margin: 0 0 10px;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
    }
    .meta-grid {
      display: grid;
      gap: 10px;
      margin-bottom: 18px;
    }
    .meta-card {
      padding: 12px 14px;
      border-radius: 18px;
      border: 1px solid var(--line);
      background: rgba(255, 253, 248, 0.78);
    }
    .meta-card strong {
      display: block;
      font-size: 18px;
      margin-top: 2px;
    }
    .top-list, .path-list {
      display: grid;
      gap: 10px;
    }
    .author-legend {
      display: grid;
      gap: 10px;
      margin-top: 18px;
    }
    .reference-list {
      display: grid;
      gap: 10px;
      margin-top: 18px;
    }
    .reference-chip {
      padding: 10px 12px;
      border-radius: 16px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.82);
      cursor: pointer;
    }
    .reference-chip-url {
      font-size: 12px;
      color: var(--muted);
      word-break: break-word;
    }
    .author-chip {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 16px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.82);
      cursor: pointer;
    }
    .author-chip-swatch {
      width: 14px;
      height: 14px;
      border-radius: 999px;
      flex: 0 0 auto;
      border: 2px solid rgba(17,17,17,0.08);
    }
    .author-chip-meta {
      color: var(--muted);
      font-size: 12px;
    }
    .tweet-chip {
      padding: 12px 14px;
      border: 1px solid var(--line);
      background: rgba(255, 253, 248, 0.82);
      border-radius: 18px;
      cursor: pointer;
    }
    .tweet-chip:hover {
      border-color: #bda892;
      box-shadow: 0 8px 24px rgba(71, 48, 18, 0.08);
    }
    .tweet-chip-title {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      font-size: 14px;
      font-weight: 600;
    }
    .tweet-chip p {
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.35;
    }
    .inspector h2 {
      margin: 0 0 8px;
      font-size: 24px;
      line-height: 1.08;
    }
    .inspector .subtle {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
    }
    .metric-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin: 16px 0 18px;
    }
    .metric {
      padding: 12px;
      border-radius: 18px;
      border: 1px solid var(--line);
      background: rgba(255, 253, 248, 0.78);
    }
    .metric-label {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .metric-value {
      display: block;
      margin-top: 6px;
      font-size: 18px;
      font-weight: 700;
    }
    .tweet-text {
      margin: 16px 0;
      padding: 14px;
      border-radius: 18px;
      border: 1px solid var(--line);
      background: rgba(255, 253, 248, 0.82);
      line-height: 1.45;
      white-space: pre-wrap;
    }
    .legend {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 12px;
    }
    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--muted);
      font-size: 12px;
    }
    .legend-swatch {
      width: 12px;
      height: 12px;
      border-radius: 999px;
    }
    .footer-link {
      display: inline-flex;
      align-items: center;
      margin-top: 10px;
      color: var(--accent);
      text-decoration: none;
      font-weight: 600;
    }
    .empty-note {
      color: var(--muted);
      font-style: italic;
      margin: 0;
    }
    @media (max-width: 1280px) {
      .shell {
        grid-template-columns: 280px minmax(0, 1fr);
      }
      .inspector {
        grid-column: 1 / -1;
      }
    }
    @media (max-width: 920px) {
      .shell {
        grid-template-columns: 1fr;
      }
      .graph-toolbar {
        grid-template-columns: 1fr;
      }
      .graph-card {
        min-height: 560px;
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <aside class="panel sidebar">
      <section>
        <h2 class="section-title">Signal Lens</h2>
        <div class="meta-grid">
          <div class="meta-card">
            Captured
            <strong>${escapeHtml(payload.capturedAt || "unknown")}</strong>
          </div>
          <div class="meta-card">
            Root
            <strong>${escapeHtml(payload.canonicalRootId || "unknown")}</strong>
          </div>
          <div class="meta-card">
            Explored
            <strong>${escapeHtml(payload.clickedTweetId || "unknown")}</strong>
          </div>
        </div>
      </section>
      <section>
        <h2 class="section-title">Top By ThinkerRank</h2>
        <div class="top-list" id="top-list"></div>
      </section>
      <section>
        <h2 class="section-title">Top Authors</h2>
        <div class="author-legend" id="author-legend"></div>
      </section>
      <section>
        <h2 class="section-title">References</h2>
        <div class="reference-list" id="reference-list"></div>
      </section>
      <section style="margin-top:18px;">
        <h2 class="section-title">Clicked Path To Root</h2>
        <div class="path-list" id="path-list"></div>
      </section>
    </aside>
    <section class="main">
      <article class="panel hero">
        <h1>Conversation Graph</h1>
        <p>This view is tuned for separating structure from amplification noise. Reposts are hidden by default, node size starts on ThinkerRank, and the inspector lets us test whether a branch is genuinely central or merely loud.</p>
        <div class="pill-row">${summaryPills}</div>
        <div class="legend">
          <span class="legend-item"><span class="legend-swatch" style="background:var(--root)"></span>Root / path anchor</span>
          <span class="legend-item"><span class="legend-swatch" style="background:var(--clicked)"></span>Explored tweet</span>
          <span class="legend-item"><span class="legend-swatch" style="background:var(--path)"></span>Path context</span>
          <span class="legend-item"><span class="legend-swatch" style="background:var(--reply)"></span>Reply</span>
          <span class="legend-item"><span class="legend-swatch" style="background:var(--quote)"></span>Quote</span>
          <span class="legend-item"><span class="legend-swatch" style="background:var(--repost)"></span>Repost</span>
        </div>
      </article>
      <article class="panel graph-card">
        <div class="graph-toolbar">
          <div class="control">
            <label for="size-metric">Node Size</label>
            <select id="size-metric">
              <option value="score">ThinkerRank</option>
              <option value="reach">Weighted reach</option>
              <option value="followers">Followers</option>
              <option value="degree">Degree</option>
              <option value="incoming">Incoming edges</option>
            </select>
          </div>
          <div class="control">
            <label for="search-box">Find Tweet / Author</label>
            <input id="search-box" type="search" placeholder="search text, @handle, or tweet id">
          </div>
          <div class="control">
            <label>Noise Controls</label>
            <div class="toggle-row">
              <label class="toggle"><input id="toggle-reposts" type="checkbox"> show reposts</label>
              <label class="toggle"><input id="toggle-labels" type="checkbox" checked> labels</label>
            </div>
          </div>
          <div class="control">
            <label>Selection</label>
            <div class="toggle-row">
              <label class="toggle"><input id="toggle-neighborhood" type="checkbox"> isolate local neighborhood</label>
              <label class="toggle"><input id="toggle-auto-rotate" type="checkbox"> auto orbit</label>
              <button id="recenter-button" type="button" style="border:1px solid var(--line);border-radius:14px;padding:10px 12px;background:var(--panel-strong);font:inherit;cursor:pointer;">recenter on explored</button>
            </div>
          </div>
        </div>
        <div class="canvas-shell">
          <canvas id="graph-canvas"></canvas>
          <div class="depth-wash"></div>
          <div id="graph-tooltip" class="tooltip"></div>
          <div class="hint">Drag nodes. Click a node to inspect its local trunk and relation cues.</div>
        </div>
      </article>
    </section>
    <aside class="panel inspector">
      <div id="inspector-root"></div>
    </aside>
  </main>
  <script>
    const GRAPH_DATA = ${safeJson(payload)};

    const sizeMetricEl = document.getElementById("size-metric");
    const searchBoxEl = document.getElementById("search-box");
    const toggleRepostsEl = document.getElementById("toggle-reposts");
    const toggleLabelsEl = document.getElementById("toggle-labels");
    const toggleNeighborhoodEl = document.getElementById("toggle-neighborhood");
    const toggleAutoRotateEl = document.getElementById("toggle-auto-rotate");
    const recenterButtonEl = document.getElementById("recenter-button");
    const canvas = document.getElementById("graph-canvas");
    const tooltipEl = document.getElementById("graph-tooltip");
    const inspectorRoot = document.getElementById("inspector-root");
    const topList = document.getElementById("top-list");
    const authorLegend = document.getElementById("author-legend");
    const referenceList = document.getElementById("reference-list");
    const pathList = document.getElementById("path-list");
    const context = canvas.getContext("2d");
    const clickedPathSet = new Set(Array.isArray(GRAPH_DATA.clickedPathSet) ? GRAPH_DATA.clickedPathSet : []);
    const authorColorByAuthor = GRAPH_DATA.authorColorByAuthor && typeof GRAPH_DATA.authorColorByAuthor === "object"
      ? GRAPH_DATA.authorColorByAuthor
      : {};

    const nodesById = new Map(GRAPH_DATA.nodes.map((node) => [node.id, { ...node }]));
    const edges = GRAPH_DATA.edges.slice();
    const adjacency = new Map();
    for (const edge of edges) {
      if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
      if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
      adjacency.get(edge.source).add(edge.target);
      adjacency.get(edge.target).add(edge.source);
    }

    const state = {
      selectedId: GRAPH_DATA.clickedTweetId || GRAPH_DATA.canonicalRootId || GRAPH_DATA.nodes[0]?.id || null,
      focusedAuthor: "",
      focusedReferenceUrl: "",
      hoverId: null,
      hoverX: 0,
      hoverY: 0,
      sizeMetric: "score",
      showReposts: false,
      showLabels: true,
      neighborhoodOnly: false,
      autoRotate: false,
      search: "",
      width: 0,
      height: 0,
      scale: 1,
      animationHandle: null,
      yaw: -0.32,
      targetYaw: -0.32,
      pitch: 0.16,
      targetPitch: 0.16,
      perspective: 680,
      lastTimestamp: 0,
      pointerDown: false,
      dragMode: null,
      dragOriginX: 0,
      dragOriginY: 0,
      layoutFrozen: false
    };
    state.focusedAuthor = nodesById.get(state.selectedId)?.author || "";

    const simulation = {
      nodes: GRAPH_DATA.nodes.map((node, index) => ({
        id: node.id,
        x: 160 + ((index % 14) * 52),
        y: 120 + (Math.floor(index / 14) * 42),
        z: ((index % 9) - 4) * 24,
        vx: 0,
        vy: 0,
        vz: 0,
        fx: null,
        fy: null,
        fz: null
      })),
      byId: new Map(),
      draggingId: null
    };
    for (const node of simulation.nodes) {
      simulation.byId.set(node.id, node);
    }

    function formatNumber(value) {
      const number = Number(value || 0);
      if (!Number.isFinite(number)) {
        return "0";
      }
      if (Math.abs(number) >= 1000) {
        return number.toLocaleString("en-US");
      }
      if (Math.abs(number) >= 10) {
        return number.toFixed(1);
      }
      if (Math.abs(number) >= 1) {
        return number.toFixed(2);
      }
      return number.toFixed(4);
    }

    function truncate(text, limit = 140) {
      const value = String(text || "").trim();
      if (value.length <= limit) {
        return value;
      }
      return value.slice(0, Math.max(0, limit - 1)).trimEnd() + "…";
    }

    function normalizedMetric(node, metric) {
      const visibleNodes = getVisibleNodes();
      let max = 0;
      for (const entry of visibleNodes) {
        const value = Number(entry[metric] || 0);
        if (value > max) {
          max = value;
        }
      }
      const own = Number(node?.[metric] || 0);
      if (max <= 0) {
        return 0;
      }
      return own / max;
    }

    function radiusForNode(node) {
      const base = normalizedMetric(node, state.sizeMetric);
      const emphasis = node.id === state.selectedId ? 1.5 : 1;
      const rootBonus = node.isRoot || node.isClicked ? 2 : 0;
      return (5 + (18 * Math.sqrt(Math.max(0, base)))) * emphasis + rootBonus;
    }

    function strokeColorForNode(node) {
      if (node.id === state.selectedId || node.isClicked) {
        return getComputedStyle(document.documentElement).getPropertyValue("--clicked").trim();
      }
      if (node.isRoot) {
        return getComputedStyle(document.documentElement).getPropertyValue("--root").trim();
      }
      if (clickedPathSet.has(node.id)) {
        return getComputedStyle(document.documentElement).getPropertyValue("--path").trim();
      }
      if (node.kind === "quote") {
        return getComputedStyle(document.documentElement).getPropertyValue("--quote").trim();
      }
      if (node.kind === "repost") {
        return getComputedStyle(document.documentElement).getPropertyValue("--repost").trim();
      }
      return getComputedStyle(document.documentElement).getPropertyValue("--reply").trim();
    }

    function colorForNode(node) {
      return strokeColorForNode(node);
    }

    function authorTagColor(node) {
      return authorColorByAuthor[String(node?.author || "").trim()] || "#9aa3af";
    }

    function nodeMatchesFocusedReference(node) {
      const focused = String(state.focusedReferenceUrl || "").trim();
      if (!focused) {
        return false;
      }
      const urls = Array.isArray(node?.external_urls) ? node.external_urls : [];
      return urls.includes(focused);
    }

    function projectPoint(position) {
      const cosYaw = Math.cos(state.yaw);
      const sinYaw = Math.sin(state.yaw);
      const cosPitch = Math.cos(state.pitch);
      const sinPitch = Math.sin(state.pitch);

      const centeredX = position.x - (state.width * 0.52);
      const centeredY = position.y - (state.height * 0.5);
      const centeredZ = position.z;

      const yawX = (centeredX * cosYaw) - (centeredZ * sinYaw);
      const yawZ = (centeredX * sinYaw) + (centeredZ * cosYaw);
      const pitchY = (centeredY * cosPitch) - (yawZ * sinPitch);
      const pitchZ = (centeredY * sinPitch) + (yawZ * cosPitch);

      const depth = state.perspective / Math.max(180, state.perspective + pitchZ);
      return {
        x: (state.width * 0.52) + (yawX * depth),
        y: (state.height * 0.5) + (pitchY * depth),
        z: pitchZ,
        depth
      };
    }

    function getVisibleNodeIds() {
      const ids = new Set();
      const search = state.search.trim().toLowerCase();
      const selectedNeighbors = adjacency.get(state.selectedId) || new Set();
      for (const node of GRAPH_DATA.nodes) {
        if (!state.showReposts && node.kind === "repost") {
          continue;
        }
        if (state.neighborhoodOnly) {
          const keep = node.id === state.selectedId
            || node.parentId === state.selectedId
            || selectedNeighbors.has(node.id)
            || node.id === node.parentId;
          if (!keep) {
            continue;
          }
        }
        if (search) {
          const haystack = [node.id, node.author, node.authorName, node.text].join(" ").toLowerCase();
          if (!haystack.includes(search)) {
            continue;
          }
        }
        ids.add(node.id);
      }
      if (state.selectedId && nodesById.has(state.selectedId)) {
        ids.add(state.selectedId);
      }
      return ids;
    }

    function getVisibleNodes() {
      const visibleIds = getVisibleNodeIds();
      return GRAPH_DATA.nodes.filter((node) => visibleIds.has(node.id));
    }

    function getVisibleEdges() {
      const visibleIds = getVisibleNodeIds();
      return edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
    }

    function resizeCanvas() {
      const rect = canvas.getBoundingClientRect();
      const pixelRatio = window.devicePixelRatio || 1;
      state.width = Math.max(320, rect.width);
      state.height = Math.max(480, rect.height);
      canvas.width = Math.floor(state.width * pixelRatio);
      canvas.height = Math.floor(state.height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    }

    function recenterSimulation(anchorId) {
      const anchor = simulation.byId.get(anchorId);
      if (!anchor) {
        return;
      }
      const centerX = state.width * 0.52;
      const centerY = state.height * 0.48;
      const dx = centerX - anchor.x;
      const dy = centerY - anchor.y;
      for (const node of simulation.nodes) {
        node.x += dx;
        node.y += dy;
      }
      anchor.z = 120;
    }

    function stepSimulation() {
      const visibleIds = getVisibleNodeIds();
      const visibleEdges = getVisibleEdges();
      const centerX = state.width * 0.52;
      const centerY = state.height * 0.5;

      for (const node of simulation.nodes) {
        if (!visibleIds.has(node.id)) {
          continue;
        }
        const meta = nodesById.get(node.id);
        const targetX = centerX + ((meta.kind === "quote" ? 120 : (meta.kind === "reply" ? -120 : 0)) * (meta.isRoot ? 0.2 : 1));
        const targetY = centerY + ((meta.isRoot ? -140 : 0) + (meta.isClicked ? 0 : 0));
        const targetZ = meta.isClicked
          ? 120
          : (meta.isRoot
            ? 48
            : (meta.kind === "quote" ? 22 : (meta.kind === "repost" ? -100 : -14)));
        node.vx += (targetX - node.x) * 0.0008;
        node.vy += (targetY - node.y) * 0.0008;
        node.vz += (targetZ - node.z) * 0.0012;
      }

      const visibleNodeList = simulation.nodes.filter((node) => visibleIds.has(node.id));
      for (let i = 0; i < visibleNodeList.length; i += 1) {
        const a = visibleNodeList[i];
        for (let j = i + 1; j < visibleNodeList.length; j += 1) {
          const b = visibleNodeList[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distanceSq = (dx * dx) + (dy * dy) + 0.01;
          const distance = Math.sqrt(distanceSq);
          const minDistance = radiusForNode(nodesById.get(a.id)) + radiusForNode(nodesById.get(b.id)) + 18;
          if (distance < minDistance) {
            const push = (minDistance - distance) * 0.008;
            const ux = dx / distance;
            const uy = dy / distance;
            a.vx -= ux * push;
            a.vy -= uy * push;
            a.vz -= push * 0.45;
            b.vx += ux * push;
            b.vy += uy * push;
            b.vz += push * 0.45;
          }
        }
      }

      for (const edge of visibleEdges) {
        const source = simulation.byId.get(edge.source);
        const target = simulation.byId.get(edge.target);
        if (!source || !target) {
          continue;
        }
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const distance = Math.max(1, Math.sqrt((dx * dx) + (dy * dy)));
        const desired = edge.type === "quote" ? 120 : (edge.type === "repost" ? 78 : 96);
        const pull = (distance - desired) * 0.0018;
        const ux = dx / distance;
        const uy = dy / distance;
        source.vx += ux * pull;
        source.vy += uy * pull;
        source.vz += pull * (edge.type === "quote" ? 0.5 : 0.24);
        target.vx -= ux * pull;
        target.vy -= uy * pull;
        target.vz -= pull * (edge.type === "quote" ? 0.5 : 0.24);
      }

      for (const node of simulation.nodes) {
        if (!visibleIds.has(node.id)) {
          continue;
        }
        if (node.id === state.selectedId) {
          node.vx += (centerX - node.x) * 0.002;
          node.vy += (centerY - node.y) * 0.002;
          node.vz += (120 - node.z) * 0.003;
        }
        if (node.fx != null && node.fy != null) {
          node.x = node.fx;
          node.y = node.fy;
          if (node.fz != null) {
            node.z = node.fz;
          }
          node.vx = 0;
          node.vy = 0;
          node.vz = 0;
          continue;
        }
        node.vx *= 0.9;
        node.vy *= 0.9;
        node.vz *= 0.88;
        node.x += node.vx;
        node.y += node.vy;
        node.z += node.vz;
      }
    }

    function settleLayout(iterations = 220) {
      for (let index = 0; index < iterations; index += 1) {
        stepSimulation();
      }
      state.layoutFrozen = true;
    }

    function isHighlightedEdge(edge) {
      return edge.source === state.selectedId || edge.target === state.selectedId;
    }

    function draw() {
      context.clearRect(0, 0, state.width, state.height);
      context.fillStyle = "rgba(255, 255, 255, 0.02)";
      context.fillRect(0, 0, state.width, state.height);

      const visibleNodes = getVisibleNodes();
      const visibleEdges = getVisibleEdges();
      const projectedById = new Map();
      for (const node of visibleNodes) {
        const position = simulation.byId.get(node.id);
        if (!position) {
          continue;
        }
        projectedById.set(node.id, projectPoint(position));
      }

      for (const edge of visibleEdges) {
        const sourcePos = projectedById.get(edge.source);
        const targetPos = projectedById.get(edge.target);
        if (!sourcePos || !targetPos) {
          continue;
        }
        const midX = (sourcePos.x + targetPos.x) / 2;
        const midY = (sourcePos.y + targetPos.y) / 2;
        const curveLift = Math.max(-30, Math.min(30, (sourcePos.z + targetPos.z) * 0.04));
        context.beginPath();
        context.moveTo(sourcePos.x, sourcePos.y);
        context.quadraticCurveTo(midX, midY - curveLift, targetPos.x, targetPos.y);
        context.lineWidth = (isHighlightedEdge(edge) ? 2.4 : (edge.type === "quote" ? 1.8 : 1.1)) * ((sourcePos.depth + targetPos.depth) / 2);
        context.strokeStyle = edge.type === "quote"
          ? (isHighlightedEdge(edge) ? "rgba(178,75,52,0.82)" : "rgba(178,75,52,0.34)")
          : (edge.type === "repost"
            ? "rgba(154,154,146,0.2)"
            : (isHighlightedEdge(edge) ? "rgba(47,109,178,0.76)" : "rgba(47,109,178,0.24)"));
        context.stroke();
      }

      const sortedNodes = visibleNodes
        .map((node) => ({ node, projection: projectedById.get(node.id) }))
        .filter((entry) => entry.projection)
        .sort((a, b) => a.projection.z - b.projection.z);

      for (const entry of sortedNodes) {
        const node = entry.node;
        const position = entry.projection;
        if (!position) {
          continue;
        }
        const radius = radiusForNode(node) * position.depth;
        const glowRadius = radius + (node.id === state.selectedId ? 12 : 7);
        const glow = context.createRadialGradient(position.x, position.y, 0, position.x, position.y, glowRadius);
        glow.addColorStop(0, node.id === state.selectedId ? "rgba(188,91,60,0.18)" : "rgba(255,255,255,0.14)");
        glow.addColorStop(1, "rgba(255,255,255,0)");
        context.beginPath();
        context.arc(position.x, position.y, glowRadius, 0, Math.PI * 2);
        context.fillStyle = glow;
        context.fill();

        context.beginPath();
        context.ellipse(position.x, position.y + radius + 10, radius * 1.12, Math.max(3, radius * 0.32), 0, 0, Math.PI * 2);
        context.fillStyle = "rgba(32,24,17,0.08)";
        context.fill();

        context.beginPath();
        context.arc(position.x, position.y, radius, 0, Math.PI * 2);
        context.fillStyle = colorForNode(node);
        context.globalAlpha = node.kind === "repost" ? 0.55 : 0.92;
        context.fill();
        context.globalAlpha = 1;
        context.lineWidth = node.id === state.selectedId ? 3.2 : 2;
        context.strokeStyle = strokeColorForNode(node);
        context.stroke();

        if (state.focusedAuthor && node.author === state.focusedAuthor) {
          context.beginPath();
          context.arc(position.x, position.y, radius + 6, 0, Math.PI * 2);
          context.lineWidth = 2.4;
          context.strokeStyle = authorTagColor(node);
          context.stroke();
        }

        if (nodeMatchesFocusedReference(node)) {
          context.beginPath();
          context.arc(position.x, position.y, radius + 11, 0, Math.PI * 2);
          context.lineWidth = 2;
          context.setLineDash([5, 4]);
          context.strokeStyle = "rgba(17,17,17,0.55)";
          context.stroke();
          context.setLineDash([]);
        }

        context.beginPath();
        context.arc(position.x - (radius * 0.28), position.y - (radius * 0.32), Math.max(1.5, radius * 0.28), 0, Math.PI * 2);
        context.fillStyle = "rgba(255,255,255,0.24)";
        context.fill();

        if (state.showLabels && (node.id === state.selectedId || radius >= 8 || node.isRoot || node.isClicked)) {
          context.font = "12px SF Pro Display, Avenir Next, Helvetica Neue, Arial, sans-serif";
          context.fillStyle = authorTagColor(node);
          context.textAlign = "left";
          context.fillText(node.author, position.x + radius + 8, position.y + 4);
        }
      }
    }

    function escapeInlineHtml(value) {
      return String(value || "").replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char]));
    }

    function renderTooltip() {
      const node = state.hoverId ? nodesById.get(state.hoverId) : null;
      if (!node) {
        tooltipEl.classList.remove("visible");
        tooltipEl.innerHTML = "";
        return;
      }

      tooltipEl.innerHTML = \`
        <div class="tooltip-title">
          <span>\${escapeInlineHtml(node.author)}</span>
          <span>\${escapeInlineHtml(node.kind)}</span>
        </div>
        <div class="tooltip-subtle">tweet <code>\${escapeInlineHtml(node.id)}</code></div>
        <div class="tooltip-metrics">
          <div class="tooltip-metric"><span class="tooltip-metric-label">ThinkerRank</span><span class="tooltip-metric-value">\${formatNumber(node.score)}</span></div>
          <div class="tooltip-metric"><span class="tooltip-metric-label">Followers</span><span class="tooltip-metric-value">\${formatNumber(node.followers)}</span></div>
          <div class="tooltip-metric"><span class="tooltip-metric-label">Reach</span><span class="tooltip-metric-value">\${formatNumber(node.reach)}</span></div>
          <div class="tooltip-metric"><span class="tooltip-metric-label">Likes</span><span class="tooltip-metric-value">\${formatNumber(node.likes)}</span></div>
          <div class="tooltip-metric"><span class="tooltip-metric-label">Replies</span><span class="tooltip-metric-value">\${formatNumber(node.replies)}</span></div>
          <div class="tooltip-metric"><span class="tooltip-metric-label">Quotes</span><span class="tooltip-metric-value">\${formatNumber(node.quotes)}</span></div>
        </div>
      \`;

      const shellRect = canvas.parentElement.getBoundingClientRect();
      const tooltipRect = tooltipEl.getBoundingClientRect();
      const offsetX = 18;
      const offsetY = 18;
      let left = state.hoverX + offsetX;
      let top = state.hoverY + offsetY;
      if (left + tooltipRect.width > shellRect.width - 8) {
        left = Math.max(8, state.hoverX - tooltipRect.width - 14);
      }
      if (top + tooltipRect.height > shellRect.height - 8) {
        top = Math.max(8, state.hoverY - tooltipRect.height - 14);
      }
      tooltipEl.style.left = left + "px";
      tooltipEl.style.top = top + "px";
      tooltipEl.classList.add("visible");
    }

    function pickNodeAt(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const visibleNodes = getVisibleNodes()
        .map((node) => {
          const position = simulation.byId.get(node.id);
          return position ? { node, projection: projectPoint(position) } : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.projection.z - a.projection.z);
      for (const entry of visibleNodes) {
        const node = entry.node;
        const position = entry.projection;
        if (!position) {
          continue;
        }
        const radius = radiusForNode(node) * position.depth;
        const dx = x - position.x;
        const dy = y - position.y;
        if ((dx * dx) + (dy * dy) <= radius * radius) {
          return node.id;
        }
      }
      return null;
    }

    function renderInspector() {
      const node = nodesById.get(state.selectedId);
      if (!node) {
        inspectorRoot.innerHTML = "<p class='empty-note'>Select a node to inspect it.</p>";
        return;
      }

      const neighbors = [...(adjacency.get(node.id) || new Set())]
        .map((id) => nodesById.get(id))
        .filter(Boolean)
        .sort((a, b) => b.score - a.score || b.reach - a.reach)
        .slice(0, 8);
      const path = [];
      let cursor = node.id;
      const visited = new Set();
      while (cursor && !visited.has(cursor) && nodesById.has(cursor)) {
        visited.add(cursor);
        const entry = nodesById.get(cursor);
        path.push(entry);
        cursor = entry.parentId && nodesById.has(entry.parentId) ? entry.parentId : null;
      }

      inspectorRoot.innerHTML = \`
        <h2>\${node.author}</h2>
        <div class="subtle">Tweet <code>\${node.id}</code> · kind \${node.kind} · parent \${node.parentId ? "<code>" + node.parentId + "</code>" : "none"}</div>
        <div class="metric-grid">
          <div class="metric"><span class="metric-label">ThinkerRank</span><span class="metric-value">\${formatNumber(node.score)}</span></div>
          <div class="metric"><span class="metric-label">Weighted reach</span><span class="metric-value">\${formatNumber(node.reach)}</span></div>
          <div class="metric"><span class="metric-label">Followers</span><span class="metric-value">\${formatNumber(node.followers)}</span></div>
          <div class="metric"><span class="metric-label">Degree</span><span class="metric-value">\${formatNumber(node.degree)}</span></div>
          <div class="metric"><span class="metric-label">Replies / Quotes</span><span class="metric-value">\${formatNumber(node.replies)} / \${formatNumber(node.quotes)}</span></div>
          <div class="metric"><span class="metric-label">Incoming / Outgoing</span><span class="metric-value">\${formatNumber(node.incoming)} / \${formatNumber(node.outgoing)}</span></div>
        </div>
        <div class="tweet-text">\${node.text ? node.text.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char])) : "No tweet text available."}</div>
        <div class="subtle">Edge types touching this node: \${node.edgeKinds.join(", ") || "none"}</div>
        \${node.url ? '<a class="footer-link" href="' + node.url + '" target="_blank" rel="noreferrer">Open tweet</a>' : ""}
        <section style="margin-top:20px;">
          <h3 class="section-title">Local Trunk</h3>
          <div class="path-list">\${path.map((entry) => '<div class="tweet-chip" data-node-id="' + entry.id + '"><div class="tweet-chip-title"><span>' + entry.author + '</span><span>' + formatNumber(entry.score) + '</span></div><p>' + truncate(entry.text, 120).replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char])) + '</p></div>').join("") || "<p class='empty-note'>No path available.</p>"}</div>
        </section>
        <section style="margin-top:20px;">
          <h3 class="section-title">Strong Neighbors</h3>
          <div class="path-list">\${neighbors.map((entry) => '<div class="tweet-chip" data-node-id="' + entry.id + '"><div class="tweet-chip-title"><span>' + entry.author + '</span><span>' + formatNumber(entry.score) + '</span></div><p>' + truncate(entry.text, 120).replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char])) + '</p></div>').join("") || "<p class='empty-note'>No nearby neighbors.</p>"}</div>
        </section>
      \`;

      inspectorRoot.querySelectorAll("[data-node-id]").forEach((element) => {
        element.addEventListener("click", () => {
          state.selectedId = element.getAttribute("data-node-id");
          const selectedNode = nodesById.get(state.selectedId);
          state.focusedAuthor = selectedNode?.author || "";
          state.focusedReferenceUrl = "";
          recenterSimulation(state.selectedId);
          renderInspector();
        });
      });
    }

    function renderSideLists() {
      topList.innerHTML = GRAPH_DATA.topByScore.map((node) => \`
        <div class="tweet-chip" data-top-node-id="\${node.id}">
          <div class="tweet-chip-title"><span>\${node.author}</span><span>\${formatNumber(node.score)}</span></div>
          <p>\${truncate(node.text, 110).replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char]))}</p>
        </div>
      \`).join("");

      const clickedPathNodes = (GRAPH_DATA.clickedPath || [])
        .map((id) => nodesById.get(id))
        .filter(Boolean);
      pathList.innerHTML = clickedPathNodes.length
        ? clickedPathNodes.map((node) => \`
          <div class="tweet-chip" data-path-node-id="\${node.id}">
            <div class="tweet-chip-title"><span>\${node.author}</span><span>\${node.kind}</span></div>
            <p>\${truncate(node.text, 110).replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char]))}</p>
          </div>
        \`).join("")
        : "<p class='empty-note'>No clicked path available.</p>";

      authorLegend.innerHTML = (Array.isArray(GRAPH_DATA.topAuthors) ? GRAPH_DATA.topAuthors : []).map((entry) => \`
        <div class="author-chip" data-author="\${entry.author}">
          <span class="author-chip-swatch" style="background:\${entry.color}"></span>
          <div>
            <div><strong style="color:\${entry.color}">\${entry.author}</strong></div>
            <div class="author-chip-meta">score \${formatNumber(entry.totalScore)} · tweets \${entry.tweetCount}</div>
          </div>
        </div>
      \`).join("") || "<p class='empty-note'>No top authors.</p>";

      document.querySelectorAll("[data-top-node-id], [data-path-node-id]").forEach((element) => {
        element.addEventListener("click", () => {
          state.selectedId = element.getAttribute("data-top-node-id") || element.getAttribute("data-path-node-id");
          const selectedNode = nodesById.get(state.selectedId);
          state.focusedAuthor = selectedNode?.author || "";
          state.focusedReferenceUrl = "";
          recenterSimulation(state.selectedId);
          renderInspector();
        });
      });

      authorLegend.querySelectorAll("[data-author]").forEach((element) => {
        element.addEventListener("click", () => {
          const author = element.getAttribute("data-author") || "";
          const candidate = GRAPH_DATA.nodes
            .filter((node) => node.author === author)
            .sort((a, b) => b.score - a.score || b.reach - a.reach)[0];
          if (!candidate) {
            return;
          }
          state.selectedId = candidate.id;
          state.focusedAuthor = author;
          state.focusedReferenceUrl = "";
          recenterSimulation(state.selectedId);
          renderInspector();
        });
      });

      referenceList.innerHTML = (Array.isArray(GRAPH_DATA.topReferences) ? GRAPH_DATA.topReferences : []).map((entry) => \`
        <div class="reference-chip" data-reference-url="\${entry.url}">
          <div><strong>\${entry.domain || "reference"}</strong> · \${entry.count} cite\${entry.count === 1 ? "" : "s"}</div>
          <div class="reference-chip-url">\${entry.url}</div>
        </div>
      \`).join("") || "<p class='empty-note'>No references.</p>";

      referenceList.querySelectorAll("[data-reference-url]").forEach((element) => {
        element.addEventListener("click", () => {
          state.focusedReferenceUrl = element.getAttribute("data-reference-url") || "";
          const url = state.focusedReferenceUrl;
          const candidate = GRAPH_DATA.nodes.find((node) => Array.isArray(node.external_urls) && node.external_urls.includes(url));
          if (candidate) {
            state.selectedId = candidate.id;
            state.focusedAuthor = candidate.author || "";
            recenterSimulation(state.selectedId);
          }
          renderInspector();
        });
      });
    }

    function scheduleRender() {
      if (state.animationHandle != null) {
        return;
      }
      state.animationHandle = window.requestAnimationFrame((timestamp) => {
        const deltaMs = state.lastTimestamp ? Math.min(32, Math.max(8, timestamp - state.lastTimestamp)) : 16;
        state.lastTimestamp = timestamp;
        state.animationHandle = null;
        if (state.autoRotate && !state.pointerDown) {
          state.targetYaw += 0.00035 * deltaMs;
          state.yaw += (state.targetYaw - state.yaw) * 0.08;
          state.pitch += (state.targetPitch - state.pitch) * 0.08;
          draw();
          scheduleRender();
          return;
        }
        draw();
      });
    }

    canvas.addEventListener("click", (event) => {
      const pickedId = pickNodeAt(event.clientX, event.clientY);
      if (!pickedId) {
        return;
      }
      state.selectedId = pickedId;
      state.focusedAuthor = nodesById.get(pickedId)?.author || "";
      state.focusedReferenceUrl = "";
      renderInspector();
      scheduleRender();
    });

    canvas.addEventListener("mousemove", (event) => {
      const rect = canvas.getBoundingClientRect();
      state.hoverX = event.clientX - rect.left;
      state.hoverY = event.clientY - rect.top;
      state.hoverId = pickNodeAt(event.clientX, event.clientY);
      renderTooltip();
      scheduleRender();
    });

    canvas.addEventListener("mouseleave", () => {
      state.hoverId = null;
      renderTooltip();
      scheduleRender();
    });

    canvas.addEventListener("mousedown", (event) => {
      const pickedId = pickNodeAt(event.clientX, event.clientY);
      state.pointerDown = true;
      state.dragOriginX = event.clientX;
      state.dragOriginY = event.clientY;
      simulation.draggingId = pickedId;
      state.dragMode = pickedId ? "node" : "orbit";
      if (!pickedId) {
        return;
      }
      const position = simulation.byId.get(pickedId);
      if (!position) {
        return;
      }
      const rect = canvas.getBoundingClientRect();
      position.fx = event.clientX - rect.left;
      position.fy = event.clientY - rect.top;
      position.fz = 150;
      state.layoutFrozen = false;
      state.selectedId = pickedId;
      state.focusedAuthor = nodesById.get(pickedId)?.author || "";
      state.focusedReferenceUrl = "";
      renderInspector();
      scheduleRender();
    });

    window.addEventListener("mousemove", (event) => {
      if (!state.pointerDown) {
        return;
      }
      if (state.dragMode === "orbit") {
        const dx = event.clientX - state.dragOriginX;
        const dy = event.clientY - state.dragOriginY;
        state.targetYaw += dx * 0.0035;
        state.targetPitch = Math.max(-0.8, Math.min(0.8, state.targetPitch + (dy * 0.003)));
        state.dragOriginX = event.clientX;
        state.dragOriginY = event.clientY;
        scheduleRender();
        return;
      }
      if (!simulation.draggingId) {
        return;
      }
      const position = simulation.byId.get(simulation.draggingId);
      if (!position) {
        return;
      }
      const rect = canvas.getBoundingClientRect();
      position.fx = event.clientX - rect.left;
      position.fy = event.clientY - rect.top;
      position.fz = 150;
      state.layoutFrozen = false;
      draw();
    });

    window.addEventListener("mouseup", () => {
      state.pointerDown = false;
      state.dragMode = null;
      const position = simulation.byId.get(simulation.draggingId);
      if (position) {
        position.fx = null;
        position.fy = null;
        position.fz = null;
      }
      simulation.draggingId = null;
      settleLayout(40);
      scheduleRender();
    });

    sizeMetricEl.addEventListener("change", () => {
      state.sizeMetric = sizeMetricEl.value;
      scheduleRender();
    });
    toggleRepostsEl.addEventListener("change", () => {
      state.showReposts = toggleRepostsEl.checked;
      settleLayout(40);
      scheduleRender();
    });
    toggleLabelsEl.addEventListener("change", () => {
      state.showLabels = toggleLabelsEl.checked;
      scheduleRender();
    });
    toggleNeighborhoodEl.addEventListener("change", () => {
      state.neighborhoodOnly = toggleNeighborhoodEl.checked;
      settleLayout(60);
      scheduleRender();
    });
    toggleAutoRotateEl.addEventListener("change", () => {
      state.autoRotate = toggleAutoRotateEl.checked;
      if (state.autoRotate) {
        state.layoutFrozen = false;
        scheduleRender();
      }
    });
    searchBoxEl.addEventListener("input", () => {
      state.search = searchBoxEl.value;
      settleLayout(60);
      scheduleRender();
    });
    recenterButtonEl.addEventListener("click", () => {
      state.selectedId = GRAPH_DATA.clickedTweetId || GRAPH_DATA.canonicalRootId || state.selectedId;
      state.focusedAuthor = nodesById.get(state.selectedId)?.author || "";
      state.focusedReferenceUrl = "";
      recenterSimulation(state.selectedId);
      renderInspector();
      scheduleRender();
    });

    window.addEventListener("resize", () => {
      resizeCanvas();
      recenterSimulation(state.selectedId);
      settleLayout(80);
      scheduleRender();
    });

    resizeCanvas();
    recenterSimulation(state.selectedId);
    settleLayout();
    renderSideLists();
    renderInspector();
    scheduleRender();
  </script>
</body>
</html>`;
}

async function renderConversationGraphReport(rawArgs = process.argv.slice(2)) {
  const args = parseArgs(rawArgs);
  if (args.help) {
    return {
      exitCode: 0,
      stdout: `${usage()}\n`
    };
  }
  if (!args.fixture) {
    throw new Error("Missing required --fixture <path>");
  }

  const fixturePath = path.resolve(args.fixture);
  const dataset = await loadConversationDataset({
    kind: "fixture",
    path: fixturePath
  });
  const payload = buildGraphPayload(dataset, fixturePath);

  const rawFixture = JSON.parse(await fs.readFile(fixturePath, "utf8"));
  payload.capturedAt = String(rawFixture?.capturedAt || "").trim() || null;

  const outputPath = args.output
    ? path.resolve(args.output)
    : defaultOutputPath({
      outputDir: args.outputDir,
      fixturePath,
      canonicalRootId: dataset.canonicalRootId
    });

  const html = buildHtmlReport(payload);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${html}\n`, "utf8");

  return {
    exitCode: 0,
    outputPath,
    payload
  };
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
