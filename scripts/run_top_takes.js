"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const background = require("../extension/background.js");

const REPO_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(REPO_ROOT, "data");
const CACHE_PATH = path.join(DATA_DIR, "top_takes_runner_cache.json");

function parseDotEnv(text) {
  const entries = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) {
      entries[key] = value;
    }
  }
  return entries;
}

async function readLocalEnv() {
  try {
    return parseDotEnv(await fs.readFile(path.join(REPO_ROOT, ".env"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function extractTweetId(input) {
  const value = String(input || "").trim();
  const statusMatch = value.match(/\/status\/(\d+)/);
  if (statusMatch) {
    return statusMatch[1];
  }
  if (/^\d+$/.test(value)) {
    return value;
  }
  return "";
}

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createChromeStub(initialLocalStorage = {}) {
  let localStorageEntries = { ...initialLocalStorage };
  return {
    runtime: {
      id: "ariadex-top-takes-runner",
      lastError: null,
      getURL(resourcePath) {
        return `file://${path.join(REPO_ROOT, "extension", resourcePath)}`;
      }
    },
    storage: {
      local: {
        get(keys, callback) {
          const requestedKeys = Array.isArray(keys) ? keys : Object.keys(keys || {});
          const result = {};
          for (const key of requestedKeys) {
            if (Object.prototype.hasOwnProperty.call(localStorageEntries, key)) {
              result[key] = localStorageEntries[key];
            }
          }
          callback(result);
        },
        set(value, callback) {
          localStorageEntries = {
            ...localStorageEntries,
            ...(value && typeof value === "object" ? value : {})
          };
          callback();
        },
        remove(keys, callback) {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            delete localStorageEntries[key];
          }
          callback();
        }
      }
    },
    inspectStorage() {
      return { ...localStorageEntries };
    }
  };
}

function summarizeArtifact(artifact) {
  const stats = artifact?.stats && typeof artifact.stats === "object" ? artifact.stats : {};
  const representativeTakes = Array.isArray(artifact?.representativeTakes)
    ? artifact.representativeTakes
    : [];
  return {
    sourceDomain: artifact?.sourceDomain || "",
    sourceDomainConfidence: artifact?.sourceDomainConfidence || 0,
    stats,
    topTakes: representativeTakes.slice(0, 10).map((take, index) => ({
      rank: index + 1,
      tweetId: take.tweetId,
      author: take.raw?.author || take.raw?.username || "",
      role: take.roleLabel || take.role || "",
      domainGroup: take.domainGroupLabel || take.domainGroup || "",
      score: take.takeScore ?? take.combinedScore,
      text: take.raw?.text || "",
      explanation: take.explanation || ""
    }))
  };
}

async function main() {
  const input = process.argv[2] || "";
  const tweetId = extractTweetId(input);
  if (!tweetId) {
    throw new Error("Usage: node scripts/run_top_takes.js <tweet-url-or-id>");
  }

  const env = {
    ...process.env,
    ...(await readLocalEnv())
  };
  const bearerToken = env.X_BEARER_TOKEN || env.X_API_BEARER_TOKEN || "";
  const openAiApiKey = env.OPENAI_API_KEY || "";
  const openAiModel = env.OPENAI_MODEL || "";
  const openAiBaseUrl = env.OPENAI_BASE_URL || "";
  const apiBaseUrl = env.ARIADEX_X_API_BASE_URL || "";

  const cache = await readJsonFile(CACHE_PATH, {});
  const chromeStub = createChromeStub(cache);
  const controller = background.createBackgroundController({
    chromeApi: chromeStub,
    fetchImpl: fetch.bind(globalThis)
  });

  const progress = [];
  const artifact = await controller.resolveTopTakes(tweetId, {
    bearerToken,
    apiBaseUrl,
    openAiApiKey,
    openAiModel,
    openAiBaseUrl,
    maxQuoteTweets: Number(env.TOP_TAKES_MAX_QUOTE_TWEETS || 200),
    maxQuotePages: Number(env.TOP_TAKES_MAX_QUOTE_PAGES || 3),
    maxRateLimitRetries: Number(env.TOP_TAKES_MAX_RATE_LIMIT_RETRIES || 2),
    rateLimitRetryDelayMs: Number(env.TOP_TAKES_RATE_LIMIT_RETRY_DELAY_MS || 60_000),
    rateLimitMaxWaitMs: Number(env.TOP_TAKES_RATE_LIMIT_MAX_WAIT_MS || 120_000),
    onProgress(event) {
      const phase = String(event?.phase || "");
      progress.push(event);
      if (phase) {
        process.stderr.write(`[top-takes] ${phase} ${JSON.stringify(event)}\n`);
      }
    }
  });

  await writeJsonFile(CACHE_PATH, chromeStub.inspectStorage());
  const outputPath = path.join(DATA_DIR, `top_takes_${tweetId}.json`);
  await writeJsonFile(outputPath, {
    generatedAt: new Date().toISOString(),
    tweetId,
    input,
    progress,
    artifact,
    summary: summarizeArtifact(artifact)
  });

  process.stdout.write(`${JSON.stringify({
    ok: true,
    tweetId,
    outputPath,
    summary: summarizeArtifact(artifact)
  }, null, 2)}\n`);
}

main().catch(async (error) => {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(path.join(DATA_DIR, "top_takes_last_error.txt"), `${error?.stack || error?.message || error}\n`);
  } catch {}
  process.stderr.write(`[top-takes] failed: ${error?.message || error}\n`);
  process.exitCode = 1;
});
