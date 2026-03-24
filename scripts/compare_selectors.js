"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const { loadConversationDataset } = require("../data/conversation_dataset_source.js");
const { buildConversationArtifact } = require("../server/conversation_artifact.js");
const { runRegisteredSelector, listSelectorDefinitions } = require("../research/selectors/registry.js");

const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), "research", "runs", "selector_comparisons");

function parseJsonObject(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return {};
  }
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function parseArgs(argv = []) {
  const args = {
    fixture: null,
    tweet: null,
    rootHint: null,
    algoA: "path_anchored_v1",
    algoB: "quota_per_parent_v0",
    paramsA: {},
    paramsB: {},
    outputDir: DEFAULT_OUTPUT_DIR,
    outputBase: null,
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
    } else if (token === "--tweet") {
      args.tweet = String(readValue() || "").trim() || null;
    } else if (token === "--root-hint") {
      args.rootHint = String(readValue() || "").trim() || null;
    } else if (token === "--algo-a") {
      args.algoA = String(readValue() || "").trim() || args.algoA;
    } else if (token === "--algo-b") {
      args.algoB = String(readValue() || "").trim() || args.algoB;
    } else if (token === "--params-a") {
      args.paramsA = parseJsonObject(readValue());
    } else if (token === "--params-b") {
      args.paramsB = parseJsonObject(readValue());
    } else if (token === "--output-dir") {
      args.outputDir = String(readValue() || "").trim() || DEFAULT_OUTPUT_DIR;
    } else if (token === "--output-base") {
      args.outputBase = String(readValue() || "").trim() || null;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

function usage() {
  return [
    "Usage: node scripts/compare_selectors.js --fixture <path> --tweet <id> [options]",
    "",
    "Options:",
    "  --fixture <path>       Full-graph fixture JSON",
    "  --tweet <id>           Starting/explored tweet id",
    "  --root-hint <id>       Optional root hint id",
    "  --algo-a <id>          Left selector id",
    "  --algo-b <id>          Right selector id",
    "  --params-a <json>      Left selector params JSON",
    "  --params-b <json>      Right selector params JSON",
    "  --output-dir <dir>     Output directory for JSON and HTML reports",
    "  --output-base <path>   Output file base path without extension",
    "  --help                 Show this message"
  ].join("\n");
}

function defaultOutputBase({ outputDir, fixturePath, clickedTweetId, algoA, algoB }) {
  const fixtureName = path.basename(String(fixturePath || "fixture"), path.extname(String(fixturePath || ""))).replace(/[^a-zA-Z0-9_-]+/g, "-");
  const tweetPart = String(clickedTweetId || "tweet").replace(/[^a-zA-Z0-9_-]+/g, "-");
  return path.join(path.resolve(outputDir), `${fixtureName}__${tweetPart}__${algoA}__vs__${algoB}`);
}

function computeSelectionDiff(left, right) {
  const leftIds = new Set(Array.isArray(left?.selectedTweetIds) ? left.selectedTweetIds.map(String) : []);
  const rightIds = new Set(Array.isArray(right?.selectedTweetIds) ? right.selectedTweetIds.map(String) : []);
  const overlap = [...leftIds].filter((id) => rightIds.has(id));
  const onlyLeft = [...leftIds].filter((id) => !rightIds.has(id));
  const onlyRight = [...rightIds].filter((id) => !leftIds.has(id));
  return {
    overlap,
    onlyLeft,
    onlyRight,
    overlapCount: overlap.length,
    onlyLeftCount: onlyLeft.length,
    onlyRightCount: onlyRight.length
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function renderTweetCards(title, tweets) {
  const cards = (Array.isArray(tweets) ? tweets : []).map((tweet) => {
    const text = escapeHtml(tweet?.text || "");
    return `<article class="tweet-card"><div class="tweet-id">${escapeHtml(tweet?.id || "")}</div><div class="tweet-author">${escapeHtml(tweet?.author || "")}</div><p>${text}</p></article>`;
  }).join("");
  return `<section class="column-section"><h3>${escapeHtml(title)}</h3>${cards || '<p class="empty">None</p>'}</section>`;
}

function buildHtmlReport(payload) {
  const left = payload.left;
  const right = payload.right;
  const diff = payload.diff;
  const selectorOptions = listSelectorDefinitions().map((entry) => `<li><strong>${escapeHtml(entry.algorithmId)}</strong>: ${escapeHtml(entry.description || "")}</li>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Selector Comparison</title>
  <style>
    :root {
      --bg: #f3efe6;
      --card: #fffaf1;
      --ink: #1e1b18;
      --muted: #6a6258;
      --line: #d7cfc2;
      --accent-a: #1f5eff;
      --accent-b: #e67300;
      --accent-both: #218c5b;
    }
    body { margin: 0; font-family: Georgia, "Iowan Old Style", serif; background: linear-gradient(180deg, #f6f1e8 0%, #efe4d4 100%); color: var(--ink); }
    .shell { max-width: 1400px; margin: 0 auto; padding: 32px 24px 64px; }
    h1, h2, h3 { margin: 0 0 12px; line-height: 1.1; }
    p, li { color: var(--muted); }
    .meta, .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 20px 0 28px; }
    .card { background: rgba(255,250,241,0.88); border: 1px solid var(--line); border-radius: 18px; padding: 18px; box-shadow: 0 10px 30px rgba(70,48,19,0.08); }
    .compare { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; align-items: start; }
    .algo-a { border-top: 4px solid var(--accent-a); }
    .algo-b { border-top: 4px solid var(--accent-b); }
    .stats { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }
    .pill { display: inline-block; padding: 6px 10px; border-radius: 999px; background: #efe7da; color: var(--ink); font-size: 13px; }
    .diff-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 24px 0; }
    .diff-both { border-top: 4px solid var(--accent-both); }
    .diff-left { border-top: 4px solid var(--accent-a); }
    .diff-right { border-top: 4px solid var(--accent-b); }
    .tweet-card { padding: 12px 0; border-top: 1px solid var(--line); }
    .tweet-card:first-child { border-top: 0; }
    .tweet-id { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; color: var(--muted); }
    .tweet-author { font-weight: 600; margin-top: 4px; }
    .column-section { margin-top: 20px; }
    .empty { color: var(--muted); font-style: italic; }
    code { font-family: ui-monospace, SFMono-Regular, monospace; }
    @media (max-width: 960px) {
      .compare, .diff-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <h1>Selector Comparison</h1>
    <p>Same fixture, same explored tweet, two algorithms.</p>
    <section class="meta">
      <div class="card"><h3>Fixture</h3><p><code>${escapeHtml(payload.fixturePath)}</code></p></div>
      <div class="card"><h3>Explored Tweet</h3><p><code>${escapeHtml(payload.clickedTweetId)}</code></p></div>
      <div class="card"><h3>Canonical Root</h3><p><code>${escapeHtml(payload.canonicalRootId || "unknown")}</code></p></div>
      <div class="card"><h3>Available Algorithms</h3><ul>${selectorOptions}</ul></div>
    </section>
    <section class="summary">
      <div class="card diff-both"><h3>Overlap</h3><p>${diff.overlapCount} tweets</p></div>
      <div class="card diff-left"><h3>Only ${escapeHtml(left.algorithmId)}</h3><p>${diff.onlyLeftCount} tweets</p></div>
      <div class="card diff-right"><h3>Only ${escapeHtml(right.algorithmId)}</h3><p>${diff.onlyRightCount} tweets</p></div>
    </section>
    <section class="compare">
      <article class="card algo-a">
        <h2>${escapeHtml(left.algorithmId)}</h2>
        <div class="stats">
          <span class="pill">selected ${left.selection.diagnostics.selectedTweetCount}</span>
          <span class="pill">path ${left.selection.diagnostics.mandatoryPathLength}</span>
          <span class="pill">refs ${left.selection.diagnostics.referenceCount}</span>
          <span class="pill">tweet refs ${left.selection.diagnostics.tweetReferenceCount}</span>
        </div>
        ${renderTweetCards("Mandatory Path", left.artifact.mandatoryPath)}
        ${renderTweetCards("Selected Tweets", left.artifact.selectedTweets)}
      </article>
      <article class="card algo-b">
        <h2>${escapeHtml(right.algorithmId)}</h2>
        <div class="stats">
          <span class="pill">selected ${right.selection.diagnostics.selectedTweetCount}</span>
          <span class="pill">path ${right.selection.diagnostics.mandatoryPathLength}</span>
          <span class="pill">refs ${right.selection.diagnostics.referenceCount}</span>
          <span class="pill">tweet refs ${right.selection.diagnostics.tweetReferenceCount}</span>
        </div>
        ${renderTweetCards("Mandatory Path", right.artifact.mandatoryPath)}
        ${renderTweetCards("Selected Tweets", right.artifact.selectedTweets)}
      </article>
    </section>
    <section class="diff-grid">
      <article class="card diff-both">
        <h3>Overlap Tweet IDs</h3>
        <p><code>${escapeHtml(diff.overlap.join(", ")) || "none"}</code></p>
      </article>
      <article class="card diff-left">
        <h3>Only ${escapeHtml(left.algorithmId)}</h3>
        <p><code>${escapeHtml(diff.onlyLeft.join(", ")) || "none"}</code></p>
      </article>
      <article class="card diff-right">
        <h3>Only ${escapeHtml(right.algorithmId)}</h3>
        <p><code>${escapeHtml(diff.onlyRight.join(", ")) || "none"}</code></p>
      </article>
    </section>
  </main>
</body>
</html>`;
}

async function compareSelectors(rawArgs = process.argv.slice(2)) {
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
  if (!args.tweet) {
    throw new Error("Missing required --tweet <id>");
  }

  const fixturePath = path.resolve(args.fixture);
  const dataset = await loadConversationDataset({
    kind: "fixture",
    path: fixturePath
  });
  const leftSelection = runRegisteredSelector({
    algorithmId: args.algoA,
    dataset,
    clickedTweetId: args.tweet,
    rootHintTweetId: args.rootHint,
    params: args.paramsA
  });
  const rightSelection = runRegisteredSelector({
    algorithmId: args.algoB,
    dataset,
    clickedTweetId: args.tweet,
    rootHintTweetId: args.rootHint,
    params: args.paramsB
  });

  const leftArtifact = buildConversationArtifact({
    dataset,
    selection: leftSelection,
    clickedTweetId: args.tweet,
    canonicalRootId: dataset.canonicalRootId
  });
  const rightArtifact = buildConversationArtifact({
    dataset,
    selection: rightSelection,
    clickedTweetId: args.tweet,
    canonicalRootId: dataset.canonicalRootId
  });

  const outputBase = args.outputBase
    ? path.resolve(args.outputBase)
    : defaultOutputBase({
      outputDir: args.outputDir,
      fixturePath,
      clickedTweetId: args.tweet,
      algoA: leftSelection.algorithmId,
      algoB: rightSelection.algorithmId
    });

  const payload = {
    schemaVersion: 1,
    runType: "selector_comparison",
    generatedAt: new Date().toISOString(),
    fixturePath,
    clickedTweetId: args.tweet,
    rootHintTweetId: args.rootHint || null,
    canonicalRootId: dataset.canonicalRootId || null,
    left: {
      algorithmId: leftSelection.algorithmId,
      params: leftSelection.params || {},
      selection: leftSelection,
      artifact: leftArtifact
    },
    right: {
      algorithmId: rightSelection.algorithmId,
      params: rightSelection.params || {},
      selection: rightSelection,
      artifact: rightArtifact
    },
    diff: computeSelectionDiff(leftSelection, rightSelection)
  };

  const jsonPath = `${outputBase}.json`;
  const htmlPath = `${outputBase}.html`;
  await fs.mkdir(path.dirname(jsonPath), { recursive: true });
  await fs.writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.writeFile(htmlPath, buildHtmlReport(payload), "utf8");

  return {
    exitCode: 0,
    jsonPath,
    htmlPath,
    payload
  };
}

async function main() {
  try {
    const result = await compareSelectors(process.argv.slice(2));
    if (result?.stdout) {
      process.stdout.write(result.stdout);
      return;
    }
    process.stdout.write(`${result.jsonPath}\n${result.htmlPath}\n`);
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
  buildHtmlReport,
  compareSelectors,
  computeSelectionDiff,
  defaultOutputBase,
  parseArgs,
  usage
};
