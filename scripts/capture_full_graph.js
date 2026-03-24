"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const { loadConversationDataset } = require("../data/conversation_dataset_source.js");
const { buildEnvObject } = require("./sync_env_to_generated_config.js");
const {
  PersistentFileCacheStore,
  createEntityCache
} = require("../server/graph_cache_server.js");

const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), "research", "fixtures", "full_graphs");
const DEFAULT_CACHE_DIR = path.join(process.cwd(), ".cache", "capture_full_graph");
const DEFAULT_ENTITY_CACHE_FILE = path.join(DEFAULT_CACHE_DIR, "entity_store.json");
const DEFAULT_CHECKPOINT_DIR = path.join(DEFAULT_CACHE_DIR, "checkpoints");
const DEFAULT_CAPTURE_OPTIONS = {
  maxPagesPerCollection: 10,
  maxConversationRoots: 40,
  maxConnectedTweets: 5000,
  maxNetworkDiscoveryAuthors: 100,
  maxNetworkDiscoveryRoots: 12,
  maxNetworkDiscoveryQueries: 30,
  networkDiscoveryBatchSize: 8,
  includeQuoteTweets: true,
  includeRetweets: true,
  includeQuoteReplies: true,
  requestTimeoutMs: 30000
};

const ANSI_RESET = "\u001b[0m";
const ANSI_BY_PHASE_GROUP = {
  resolve: "\u001b[36m",
  collect: "\u001b[34m",
  expand: "\u001b[35m",
  hydrate: "\u001b[33m",
  complete: "\u001b[32m",
  cache: "\u001b[90m",
  warn: "\u001b[31m"
};

function toInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
}

function parseList(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) => String(entry || "").trim())
        .filter(Boolean);
    }
  } catch {}

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function sanitizeFilePart(value, fallback = "conversation") {
  const normalized = String(value || "").trim().replace(/[^a-zA-Z0-9_-]+/g, "-");
  return normalized || fallback;
}

function shouldColorize(log) {
  if (process.env.NO_COLOR) {
    return false;
  }
  return Boolean(process.stdout && process.stdout.isTTY && log === console.log);
}

function shortenId(value, width = 12) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "none";
  }
  return normalized.length <= width ? normalized : normalized.slice(0, width);
}

function formatIdList(values, maxItems = 4) {
  const items = Array.isArray(values)
    ? values.map((value) => shortenId(value)).filter(Boolean)
    : [];
  if (items.length === 0) {
    return "[]";
  }
  const visible = items.slice(0, maxItems);
  const suffix = items.length > maxItems ? `, +${items.length - maxItems}` : "";
  return `[${visible.join(", ")}${suffix}]`;
}

function phaseGroup(phase) {
  const normalized = String(phase || "");
  if (normalized.startsWith("root_")) {
    return "resolve";
  }
  if (normalized === "collection_complete") {
    return "complete";
  }
  if (normalized === "collection_started" || normalized === "collecting_root") {
    return "collect";
  }
  if (
    normalized === "replies_fetched"
    || normalized === "quotes_fetched"
    || normalized === "quote_reply_expanded"
    || normalized === "retweets_fetched"
    || normalized === "network_discovery_batch"
  ) {
    return "expand";
  }
  if (normalized === "references_hydrated" || normalized === "authors_hydrated") {
    return "hydrate";
  }
  return "cache";
}

function phaseTag(phase) {
  const group = phaseGroup(phase);
  if (group === "resolve") {
    return "RESOLVE";
  }
  if (group === "collect") {
    return "COLLECT";
  }
  if (group === "expand") {
    return "EXPAND";
  }
  if (group === "hydrate") {
    return "HYDRATE";
  }
  if (group === "complete") {
    return "DONE";
  }
  return "INFO";
}

function formatProgressLine(progress = {}) {
  const phase = String(progress?.phase || "progress");
  const tag = phaseTag(phase);
  const rootId = shortenId(progress?.rootId || progress?.rootTweetId || progress?.canonicalRootId || "");
  const tweetCount = Number(progress?.tweetCount || 0);
  const processedRoots = Number(progress?.processedRoots || 0);
  const queuedRoots = Number(progress?.queuedRoots || 0);

  if (phase === "root_resolution_started") {
    return `[${tag}] resolve root from tweet=${shortenId(progress?.clickedTweetId)}`;
  }
  if (phase === "root_resolved") {
    return `[${tag}] canonical root=${shortenId(progress?.canonicalRootId)}`;
  }
  if (phase === "collection_started") {
    return `[${tag}] start root=${rootId} seeds=${formatIdList(progress?.seedRootTweetIds)}`;
  }
  if (phase === "collecting_root") {
    return `[${tag}] expand #${processedRoots} root=${rootId} queue=${queuedRoots} tweets=${tweetCount}`;
  }
  if (phase === "replies_fetched") {
    return `[${tag}] root=${rootId} fetched replies=${Number(progress?.replies || 0)} totalTweets=${tweetCount}`;
  }
  if (phase === "quotes_fetched") {
    return `[${tag}] root=${rootId} fetched quotes=${Number(progress?.quotes || 0)} totalTweets=${tweetCount}`;
  }
  if (phase === "quote_reply_expanded") {
    return `[${tag}] root=${rootId} enqueued quote-roots=${Number(progress?.enqueuedCount || 0)} queue=${queuedRoots} new=${formatIdList(progress?.enqueuedRoots)} next=${formatIdList(progress?.queuePreview)}`;
  }
  if (phase === "retweets_fetched") {
    return `[${tag}] root=${rootId} fetched retweeters=${Number(progress?.retweeters || 0)} totalTweets=${tweetCount}`;
  }
  if (phase === "references_hydrated") {
    return `[${tag}] hydrated missing refs=${Number(progress?.references || 0)} totalTweets=${tweetCount}`;
  }
  if (phase === "authors_hydrated") {
    return `[${tag}] hydrated authors=${Number(progress?.authors || 0)}`;
  }
  if (phase === "network_discovery_batch") {
    return `[${tag}] root=${rootId} network batch#${Number(progress?.queryCount || 0)} discovered=${Number(progress?.discovered || 0)} totalTweets=${tweetCount}`;
  }
  if (phase === "collection_complete") {
    return `[${tag}] complete roots=${processedRoots} tweets=${tweetCount} users=${Number(progress?.userCount || 0)}`;
  }
  return `[${tag}] ${phase}`;
}

function colorizeLine(line, phase, enabled) {
  if (!enabled) {
    return line;
  }
  const color = ANSI_BY_PHASE_GROUP[phaseGroup(phase)] || "";
  return color ? `${color}${line}${ANSI_RESET}` : line;
}

function stableHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16);
}

function defaultOutputPath({ outputDir = DEFAULT_OUTPUT_DIR, clickedTweetId, canonicalRootId = null }) {
  const clickedPart = sanitizeFilePart(clickedTweetId, "clicked");
  const rootPart = sanitizeFilePart(canonicalRootId, "pending-root");
  return path.join(outputDir, `${clickedPart}__root-${rootPart}.json`);
}

function buildCaptureFingerprint(options = {}) {
  return stableHash(JSON.stringify({
    clickedTweetId: options.clickedTweetId || null,
    rootHintTweetId: options.rootHintTweetId || null,
    following: Array.isArray(options.followingSet) ? options.followingSet : [],
    maxPagesPerCollection: options.maxPagesPerCollection,
    maxConversationRoots: options.maxConversationRoots,
    maxConnectedTweets: options.maxConnectedTweets,
    maxNetworkDiscoveryAuthors: options.maxNetworkDiscoveryAuthors,
    maxNetworkDiscoveryRoots: options.maxNetworkDiscoveryRoots,
    maxNetworkDiscoveryQueries: options.maxNetworkDiscoveryQueries,
    networkDiscoveryBatchSize: options.networkDiscoveryBatchSize,
    includeQuoteTweets: Boolean(options.includeQuoteTweets),
    includeRetweets: Boolean(options.includeRetweets),
    includeQuoteReplies: Boolean(options.includeQuoteReplies),
    requestTimeoutMs: options.requestTimeoutMs
  }));
}

function defaultCheckpointPath({ checkpointDir = DEFAULT_CHECKPOINT_DIR, fingerprint }) {
  return path.join(path.resolve(checkpointDir), `${sanitizeFilePart(fingerprint, "capture")}.json`);
}

function createFixtureDocument({ dataset, options, warnings = [], outputPath = null }) {
  const tweets = Array.isArray(dataset?.tweets) ? dataset.tweets : [];
  const users = Array.isArray(dataset?.users) ? dataset.users : [];
  const nowIso = new Date().toISOString();

  return {
    schemaVersion: 1,
    fixtureType: "full_conversation_graph",
    capturedAt: nowIso,
    source: {
      kind: "x_api",
      mode: "expensive_capture",
      clickedTweetId: options.clickedTweetId || null,
      rootHintTweetId: options.rootHintTweetId || null,
      canonicalRootId: dataset?.canonicalRootId || null,
      outputPath: outputPath || null,
      captureOptions: {
        maxPagesPerCollection: options.maxPagesPerCollection,
        maxConversationRoots: options.maxConversationRoots,
        maxConnectedTweets: options.maxConnectedTweets,
        maxNetworkDiscoveryAuthors: options.maxNetworkDiscoveryAuthors,
        maxNetworkDiscoveryRoots: options.maxNetworkDiscoveryRoots,
        maxNetworkDiscoveryQueries: options.maxNetworkDiscoveryQueries,
        networkDiscoveryBatchSize: options.networkDiscoveryBatchSize,
        includeQuoteTweets: Boolean(options.includeQuoteTweets),
        includeRetweets: Boolean(options.includeRetweets),
        includeQuoteReplies: Boolean(options.includeQuoteReplies),
        requestTimeoutMs: options.requestTimeoutMs
      }
    },
    conversation: {
      clickedTweetId: options.clickedTweetId || null,
      rootHintTweetId: options.rootHintTweetId || null,
      canonicalRootId: dataset?.canonicalRootId || null,
      rootTweet: dataset?.rootTweet || null,
      tweetCount: tweets.length,
      userCount: users.length,
      warnings: [...warnings],
      tweets,
      users
    }
  };
}

async function readJsonFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeCheckpoint({ checkpointPath, status, captureFingerprint, outputPath = null, options, progress = null, warning = null, dataset = null, existing = null }) {
  const base = existing && typeof existing === "object" ? existing : {};
  const warnings = Array.isArray(base.warnings) ? base.warnings.slice() : [];
  if (warning) {
    warnings.push(String(warning));
  }

  const payload = {
    schemaVersion: 1,
    checkpointType: "full_graph_capture",
    captureFingerprint,
    status,
    updatedAt: new Date().toISOString(),
    startedAt: base.startedAt || new Date().toISOString(),
    options: {
      clickedTweetId: options.clickedTweetId || null,
      rootHintTweetId: options.rootHintTweetId || null,
      outputPath: outputPath || base?.options?.outputPath || null,
      entityCacheFile: options.entityCacheFile || null
    },
    progress: progress || base.progress || null,
    warnings,
    result: dataset ? {
      canonicalRootId: dataset?.canonicalRootId || null,
      rootTweetId: dataset?.rootTweet?.id || null,
      tweetCount: Array.isArray(dataset?.tweets) ? dataset.tweets.length : 0,
      userCount: Array.isArray(dataset?.users) ? dataset.users.length : 0
    } : (base.result || null)
  };

  await writeJsonFile(checkpointPath, payload);
  return payload;
}

function parseArgs(argv = []) {
  const args = {
    clickedTweetId: null,
    rootHintTweetId: null,
    output: null,
    outputDir: DEFAULT_OUTPUT_DIR,
    checkpointDir: DEFAULT_CHECKPOINT_DIR,
    entityCacheFile: DEFAULT_ENTITY_CACHE_FILE,
    following: [],
    quiet: false,
    help: false,
    resume: true,
    force: false,
    maxPagesPerCollection: DEFAULT_CAPTURE_OPTIONS.maxPagesPerCollection,
    maxConversationRoots: DEFAULT_CAPTURE_OPTIONS.maxConversationRoots,
    maxConnectedTweets: DEFAULT_CAPTURE_OPTIONS.maxConnectedTweets,
    maxNetworkDiscoveryAuthors: DEFAULT_CAPTURE_OPTIONS.maxNetworkDiscoveryAuthors,
    maxNetworkDiscoveryRoots: DEFAULT_CAPTURE_OPTIONS.maxNetworkDiscoveryRoots,
    maxNetworkDiscoveryQueries: DEFAULT_CAPTURE_OPTIONS.maxNetworkDiscoveryQueries,
    networkDiscoveryBatchSize: DEFAULT_CAPTURE_OPTIONS.networkDiscoveryBatchSize,
    includeQuoteTweets: DEFAULT_CAPTURE_OPTIONS.includeQuoteTweets,
    includeRetweets: DEFAULT_CAPTURE_OPTIONS.includeRetweets,
    includeQuoteReplies: DEFAULT_CAPTURE_OPTIONS.includeQuoteReplies,
    requestTimeoutMs: DEFAULT_CAPTURE_OPTIONS.requestTimeoutMs
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
    } else if (token === "--quiet") {
      args.quiet = true;
    } else if (token === "--tweet" || token === "--clicked-tweet-id") {
      args.clickedTweetId = String(readValue() || "").trim() || null;
    } else if (token === "--root-hint") {
      args.rootHintTweetId = String(readValue() || "").trim() || null;
    } else if (token === "--output") {
      args.output = String(readValue() || "").trim() || null;
    } else if (token === "--output-dir") {
      args.outputDir = String(readValue() || "").trim() || DEFAULT_OUTPUT_DIR;
    } else if (token === "--checkpoint-dir") {
      args.checkpointDir = String(readValue() || "").trim() || DEFAULT_CHECKPOINT_DIR;
    } else if (token === "--entity-cache-file") {
      args.entityCacheFile = String(readValue() || "").trim() || DEFAULT_ENTITY_CACHE_FILE;
    } else if (token === "--following") {
      args.following = parseList(readValue());
    } else if (token === "--resume") {
      args.resume = true;
    } else if (token === "--no-resume") {
      args.resume = false;
    } else if (token === "--force") {
      args.force = true;
    } else if (token === "--max-pages") {
      args.maxPagesPerCollection = toInt(readValue(), args.maxPagesPerCollection);
    } else if (token === "--max-roots") {
      args.maxConversationRoots = toInt(readValue(), args.maxConversationRoots);
    } else if (token === "--max-tweets") {
      args.maxConnectedTweets = toInt(readValue(), args.maxConnectedTweets);
    } else if (token === "--max-network-authors") {
      args.maxNetworkDiscoveryAuthors = toInt(readValue(), args.maxNetworkDiscoveryAuthors);
    } else if (token === "--max-network-roots") {
      args.maxNetworkDiscoveryRoots = toInt(readValue(), args.maxNetworkDiscoveryRoots);
    } else if (token === "--max-network-queries") {
      args.maxNetworkDiscoveryQueries = toInt(readValue(), args.maxNetworkDiscoveryQueries);
    } else if (token === "--network-batch-size") {
      args.networkDiscoveryBatchSize = toInt(readValue(), args.networkDiscoveryBatchSize);
    } else if (token === "--timeout-ms") {
      args.requestTimeoutMs = toInt(readValue(), args.requestTimeoutMs);
    } else if (token === "--no-quotes") {
      args.includeQuoteTweets = false;
    } else if (token === "--no-retweets") {
      args.includeRetweets = false;
    } else if (token === "--no-quote-replies") {
      args.includeQuoteReplies = false;
    } else if (!token.startsWith("--") && !args.clickedTweetId) {
      args.clickedTweetId = token.trim() || null;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

function usage() {
  return [
    "Usage: node scripts/capture_full_graph.js --tweet <tweetId> [options]",
    "",
    "Options:",
    "  --tweet, --clicked-tweet-id <id>   Tweet to anchor capture from",
    "  --root-hint <id>                    Optional DOM/root hint tweet id",
    "  --output <path>                     Explicit output JSON path",
    "  --output-dir <dir>                  Output directory for generated fixtures",
    "  --checkpoint-dir <dir>              Directory for capture progress checkpoints",
    "  --entity-cache-file <path>          Disk cache file for tweet/user entities across runs",
    "  --following <csv|json>              Optional followed user ids/handles for discovery",
    "  --resume                            Reuse existing final fixture/checkpoint state when available",
    "  --no-resume                         Disable final fixture/checkpoint reuse",
    "  --force                             Ignore existing final fixture and recrawl",
    "  --max-pages <n>                     Max pages per collection root",
    "  --max-roots <n>                     Max roots to expand, including quote roots",
    "  --max-tweets <n>                    Max normalized tweets kept in the fixture",
    "  --max-network-authors <n>           Max followed authors for discovery",
    "  --max-network-roots <n>             Max roots used for followed-author discovery",
    "  --max-network-queries <n>           Max followed-author discovery queries",
    "  --network-batch-size <n>            Handles per followed-author discovery query",
    "  --timeout-ms <n>                    Per-request timeout",
    "  --no-quotes                         Disable quote tweet collection",
    "  --no-quote-replies                  Disable quote-reply expansion",
    "  --no-retweets                       Disable retweet synthetic nodes",
    "  --quiet                             Reduce progress logging",
    "  --help                              Show this message",
    "",
    "Env:",
    "  X_BEARER_TOKEN or X_API_BEARER_TOKEN must be set"
  ].join("\n");
}

async function runCapture(rawArgs = process.argv.slice(2), deps = {}) {
  const args = parseArgs(rawArgs);
  if (args.help) {
    return {
      exitCode: 0,
      stdout: `${usage()}\n`
    };
  }

  if (!args.clickedTweetId) {
    throw new Error("Missing required --tweet <tweetId>");
  }

  const envLoader = typeof deps.buildEnvObject === "function" ? deps.buildEnvObject : buildEnvObject;
  const env = deps.env || envLoader();
  const log = typeof deps.log === "function" ? deps.log : console.log;
  const colorizeLogs = typeof deps.colorizeLogs === "boolean" ? deps.colorizeLogs : shouldColorize(log);
  const bearerToken = String(env.X_BEARER_TOKEN || env.X_API_BEARER_TOKEN || "").trim();
  if (!bearerToken) {
    throw new Error("Missing X_BEARER_TOKEN or X_API_BEARER_TOKEN in environment");
  }

  const outputDir = path.resolve(args.outputDir);
  const checkpointDir = path.resolve(args.checkpointDir);
  const entityCacheFile = path.resolve(args.entityCacheFile);
  const captureOptions = {
    bearerToken,
    clickedTweetId: args.clickedTweetId,
    rootHintTweetId: args.rootHintTweetId,
    followingSet: args.following,
    entityCacheFile,
    maxPagesPerCollection: args.maxPagesPerCollection,
    maxConversationRoots: args.maxConversationRoots,
    maxConnectedTweets: args.maxConnectedTweets,
    maxNetworkDiscoveryAuthors: args.maxNetworkDiscoveryAuthors,
    maxNetworkDiscoveryRoots: args.maxNetworkDiscoveryRoots,
    maxNetworkDiscoveryQueries: args.maxNetworkDiscoveryQueries,
    networkDiscoveryBatchSize: args.networkDiscoveryBatchSize,
    includeQuoteTweets: args.includeQuoteTweets,
    includeRetweets: args.includeRetweets,
    includeQuoteReplies: args.includeQuoteReplies,
    requestTimeoutMs: args.requestTimeoutMs,
    entityCache: null
  };

  const datasetBuilder = typeof deps.loadConversationDataset === "function"
    ? deps.loadConversationDataset
    : (typeof deps.buildConversationDataset === "function"
      ? async (options) => deps.buildConversationDataset(options)
      : loadConversationDataset);

  const cacheStore = deps.cacheStore || new PersistentFileCacheStore({
    filePath: entityCacheFile,
    maxEntries: Math.max(2000, args.maxConnectedTweets * 4)
  });
  const entityCache = deps.entityCache || createEntityCache({ cacheStore });
  captureOptions.entityCache = entityCache;

  const captureFingerprint = buildCaptureFingerprint(captureOptions);
  const checkpointPath = args.output
    ? path.resolve(`${args.output}.checkpoint.json`)
    : defaultCheckpointPath({
      checkpointDir,
      fingerprint: captureFingerprint
    });

  const existingCheckpoint = await readJsonFile(checkpointPath);
  const resumedOutputHint = String(existingCheckpoint?.options?.outputPath || "").trim() || null;
  const initialOutputPath = args.output
    ? path.resolve(args.output)
    : (resumedOutputHint || defaultOutputPath({
      outputDir,
      clickedTweetId: args.clickedTweetId,
      canonicalRootId: existingCheckpoint?.result?.canonicalRootId || null
    }));

  if (!args.force && args.resume) {
    const existingFixture = await readJsonFile(initialOutputPath);
    if (existingFixture?.fixtureType === "full_conversation_graph") {
      if (!args.quiet) {
        log(`[capture] reusing existing fixture ${initialOutputPath}`);
      }
      return {
        exitCode: 0,
        outputPath: initialOutputPath,
        document: existingFixture,
        reused: true,
        checkpointPath,
        entityCacheFile
      };
    }
  }

  let latestCheckpoint = await writeCheckpoint({
    checkpointPath,
    status: "running",
    captureFingerprint,
    outputPath: initialOutputPath,
    options: captureOptions,
    existing: existingCheckpoint
  });

  let checkpointWriteChain = Promise.resolve();

  captureOptions.onProgress = (progress) => {
    checkpointWriteChain = checkpointWriteChain.then(async () => {
      latestCheckpoint = await writeCheckpoint({
        checkpointPath,
        status: "running",
        captureFingerprint,
        outputPath: initialOutputPath,
        options: captureOptions,
        progress,
        existing: latestCheckpoint
      });
    }).catch(() => {});
    if (args.quiet) {
      return;
    }
    const phase = String(progress?.phase || "progress");
    log(colorizeLine(formatProgressLine(progress), phase, colorizeLogs));
  };

  try {
    const dataset = await datasetBuilder({
      kind: "x_api",
      ...captureOptions
    });
    const resolvedOutputPath = args.output
      ? path.resolve(args.output)
      : defaultOutputPath({
        outputDir,
        clickedTweetId: args.clickedTweetId,
        canonicalRootId: dataset?.canonicalRootId || null
      });

    const document = createFixtureDocument({
      dataset,
      options: captureOptions,
      warnings: dataset?.warnings || [],
      outputPath: resolvedOutputPath
    });

    await checkpointWriteChain;
    await fs.mkdir(path.dirname(resolvedOutputPath), { recursive: true });
    await fs.writeFile(resolvedOutputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    await writeCheckpoint({
      checkpointPath,
      status: "completed",
      captureFingerprint,
      outputPath: resolvedOutputPath,
      options: captureOptions,
      progress: {
        phase: "completed",
        tweetCount: document.conversation.tweetCount,
        userCount: document.conversation.userCount
      },
      dataset,
      existing: latestCheckpoint
    });
    cacheStore.flushToDisk();

    if (!args.quiet) {
      log(colorizeLine(`[DONE] wrote fixture=${resolvedOutputPath}`, "collection_complete", colorizeLogs));
      log(colorizeLine(`[INFO] checkpoint=${checkpointPath}`, "collection_started", colorizeLogs));
      log(colorizeLine(`[INFO] entity-cache=${entityCacheFile}`, "collection_started", colorizeLogs));
      log(colorizeLine(`[DONE] tweets=${document.conversation.tweetCount} users=${document.conversation.userCount} root=${document.conversation.canonicalRootId || "unknown"}`, "collection_complete", colorizeLogs));
    }

    return {
      exitCode: 0,
      outputPath: resolvedOutputPath,
      checkpointPath,
      entityCacheFile,
      document
    };
  } catch (error) {
    await writeCheckpoint({
      checkpointPath,
      status: "failed",
      captureFingerprint,
      outputPath: initialOutputPath,
      options: captureOptions,
      warning: error?.message || "capture_failed",
      existing: latestCheckpoint
    });
    cacheStore.flushToDisk();
    throw error;
  }
}

async function main() {
  try {
    const result = await runCapture(process.argv.slice(2));
    if (result?.stdout) {
      process.stdout.write(result.stdout);
    }
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
  DEFAULT_CAPTURE_OPTIONS,
  createFixtureDocument,
  defaultOutputPath,
  formatProgressLine,
  parseArgs,
  runCapture,
  sanitizeFilePart,
  usage
};
