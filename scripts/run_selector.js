"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const { loadConversationDataset } = require("../data/conversation_dataset_source.js");
const { buildConversationArtifact } = require("../server/conversation_artifact.js");
const { runRegisteredSelector } = require("../research/selectors/registry.js");

const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), "research", "runs", "selectors");

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
    algo: "path_anchored_v1",
    params: {},
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
    } else if (token === "--tweet") {
      args.tweet = String(readValue() || "").trim() || null;
    } else if (token === "--root-hint") {
      args.rootHint = String(readValue() || "").trim() || null;
    } else if (token === "--algo") {
      args.algo = String(readValue() || "").trim() || args.algo;
    } else if (token === "--params") {
      args.params = parseJsonObject(readValue());
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
    "Usage: node scripts/run_selector.js --fixture <path> --tweet <id> [options]",
    "",
    "Options:",
    "  --fixture <path>       Full-graph fixture JSON",
    "  --tweet <id>           Starting/explored tweet id",
    "  --root-hint <id>       Optional root hint id",
    "  --algo <id>            Selector id (default: path_anchored_v1)",
    "  --params <json>        Selector params JSON",
    "  --output <path>        Explicit output JSON file",
    "  --output-dir <dir>     Output directory for selector runs",
    "  --help                 Show this message"
  ].join("\n");
}

function defaultOutputPath({ outputDir, fixturePath, algorithmId, clickedTweetId }) {
  const fixtureName = path.basename(String(fixturePath || "fixture"), path.extname(String(fixturePath || ""))).replace(/[^a-zA-Z0-9_-]+/g, "-");
  const tweetPart = String(clickedTweetId || "tweet").replace(/[^a-zA-Z0-9_-]+/g, "-");
  const algoPart = String(algorithmId || "selector").replace(/[^a-zA-Z0-9_-]+/g, "-");
  return path.join(path.resolve(outputDir), `${fixtureName}__${tweetPart}__${algoPart}.json`);
}

async function runSelector(rawArgs = process.argv.slice(2)) {
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

  const dataset = await loadConversationDataset({
    kind: "fixture",
    path: path.resolve(args.fixture)
  });
  const selection = runRegisteredSelector({
    algorithmId: args.algo,
    dataset,
    clickedTweetId: args.tweet,
    rootHintTweetId: args.rootHint,
    params: args.params
  });
  const artifact = buildConversationArtifact({
    dataset,
    selection,
    clickedTweetId: args.tweet,
    canonicalRootId: dataset.canonicalRootId
  });

  const outputPath = args.output
    ? path.resolve(args.output)
    : defaultOutputPath({
      outputDir: args.outputDir,
      fixturePath: args.fixture,
      algorithmId: selection.algorithmId,
      clickedTweetId: args.tweet
    });

  const payload = {
    schemaVersion: 1,
    runType: "selector_run",
    fixturePath: path.resolve(args.fixture),
    algorithmId: selection.algorithmId,
    clickedTweetId: args.tweet,
    rootHintTweetId: args.rootHint || null,
    generatedAt: new Date().toISOString(),
    selection,
    artifact
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return {
    exitCode: 0,
    outputPath,
    payload
  };
}

async function main() {
  try {
    const result = await runSelector(process.argv.slice(2));
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
  defaultOutputPath,
  parseArgs,
  runSelector,
  usage
};
