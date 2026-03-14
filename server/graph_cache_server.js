"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const xApiClient = require("../data/x_api_client.js");
const conversationEngine = require("../core/conversation_engine.js");

const PIPELINE_VERSION = process.env.ARIADEX_PIPELINE_VERSION || "v1";
const LOG_LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100
};

function nowMs() {
  return Date.now();
}

function normalizeLogLevel(level) {
  const normalized = String(level || "").trim().toLowerCase();
  if (!normalized) {
    return "info";
  }
  return Object.prototype.hasOwnProperty.call(LOG_LEVELS, normalized)
    ? normalized
    : "info";
}

function createLogger({ level = "info", sink = null } = {}) {
  const minLevelName = normalizeLogLevel(level);
  const minLevel = LOG_LEVELS[minLevelName];

  function emit(levelName, event, meta = {}) {
    const resolvedLevelName = normalizeLogLevel(levelName);
    const resolvedLevel = LOG_LEVELS[resolvedLevelName];
    if (resolvedLevel < minLevel || resolvedLevelName === "silent") {
      return;
    }

    const record = {
      ts: new Date().toISOString(),
      level: resolvedLevelName,
      event: String(event || "log"),
      ...meta
    };

    if (typeof sink === "function") {
      sink(record);
      return;
    }

    const serialized = JSON.stringify(record);
    if (resolvedLevelName === "error") {
      console.error(serialized);
    } else if (resolvedLevelName === "warn") {
      console.warn(serialized);
    } else {
      console.log(serialized);
    }
  }

  return {
    level: minLevelName,
    debug(event, meta) {
      emit("debug", event, meta);
    },
    info(event, meta) {
      emit("info", event, meta);
    },
    warn(event, meta) {
      emit("warn", event, meta);
    },
    error(event, meta) {
      emit("error", event, meta);
    }
  };
}

function createRequestId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString("hex");
}

function normalizeMode(mode) {
  return String(mode || "").toLowerCase() === "deep" ? "deep" : "fast";
}

function normalizeFollowingSet(input) {
  if (!input) {
    return new Set();
  }

  if (input instanceof Set) {
    return input;
  }

  if (Array.isArray(input)) {
    const out = new Set();
    for (const value of input) {
      if (value == null) {
        continue;
      }
      const normalized = String(value).trim();
      if (normalized) {
        out.add(normalized);
      }
    }
    return out;
  }

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) {
      return new Set();
    }

    try {
      return normalizeFollowingSet(JSON.parse(trimmed));
    } catch {
      return normalizeFollowingSet(trimmed.split(","));
    }
  }

  return new Set();
}

function modeOptions(mode) {
  const normalized = normalizeMode(mode);
  if (normalized === "deep") {
    return {
      includeQuoteTweets: true,
      includeQuoteReplies: true,
      includeRetweets: false,
      maxConversationRoots: 20,
      maxPagesPerCollection: 8
    };
  }

  return {
    includeQuoteTweets: false,
    includeQuoteReplies: false,
    includeRetweets: false,
    maxConversationRoots: 8,
    maxPagesPerCollection: 5
  };
}

function cacheTtlMsForMode(mode) {
  return normalizeMode(mode) === "deep"
    ? 60 * 60 * 1000
    : 15 * 60 * 1000;
}

function hashCacheKey(rawKey) {
  return crypto.createHash("sha256").update(String(rawKey)).digest("hex");
}

class MemoryCacheStore {
  constructor() {
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) {
      return null;
    }

    if (entry.expiresAtMs <= Date.now()) {
      this.map.delete(key);
      return null;
    }

    return entry;
  }

  set(key, value, ttlMs) {
    const expiresAtMs = Date.now() + Math.max(1000, ttlMs || 0);
    this.map.set(key, {
      value,
      expiresAtMs
    });
  }
}

class PersistentFileCacheStore extends MemoryCacheStore {
  constructor({ filePath, maxEntries = 5000 } = {}) {
    super();
    this.filePath = path.resolve(String(filePath || path.join(__dirname, "graph_cache_store.json")));
    this.maxEntries = Math.max(100, Math.floor(Number(maxEntries) || 5000));
    this._dirty = false;
    this._flushScheduled = false;
    this._loadFromDisk();
  }

  _loadFromDisk() {
    let parsed = null;
    try {
      if (!fs.existsSync(this.filePath)) {
        return;
      }
      const raw = fs.readFileSync(this.filePath, "utf8");
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      return;
    }

    if (!parsed || !Array.isArray(parsed.entries)) {
      return;
    }

    const now = Date.now();
    for (const entry of parsed.entries) {
      const key = typeof entry?.key === "string" ? entry.key : "";
      const expiresAtMs = Number(entry?.expiresAtMs);
      if (!key || !Number.isFinite(expiresAtMs) || expiresAtMs <= now) {
        continue;
      }
      this.map.set(key, {
        value: entry.value,
        expiresAtMs
      });
    }
  }

  _serializeEntries() {
    const now = Date.now();
    const serialized = [];
    for (const [key, entry] of this.map.entries()) {
      if (!entry || !Number.isFinite(entry.expiresAtMs) || entry.expiresAtMs <= now) {
        continue;
      }
      serialized.push({
        key,
        expiresAtMs: entry.expiresAtMs,
        value: entry.value
      });
    }

    serialized.sort((a, b) => a.expiresAtMs - b.expiresAtMs);
    if (serialized.length > this.maxEntries) {
      return serialized.slice(serialized.length - this.maxEntries);
    }
    return serialized;
  }

  _markDirtyAndScheduleFlush() {
    this._dirty = true;
    if (this._flushScheduled) {
      return;
    }
    this._flushScheduled = true;
    const timer = setTimeout(() => {
      this._flushScheduled = false;
      this.flushToDisk();
    }, 25);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
  }

  get(key) {
    const hadKeyBefore = this.map.has(key);
    const entry = super.get(key);
    if (!entry && hadKeyBefore) {
      this._markDirtyAndScheduleFlush();
    }
    return entry;
  }

  set(key, value, ttlMs) {
    super.set(key, value, ttlMs);
    if (this.map.size > this.maxEntries) {
      const entries = [...this.map.entries()];
      entries.sort((a, b) => a[1].expiresAtMs - b[1].expiresAtMs);
      const dropCount = Math.max(0, entries.length - this.maxEntries);
      for (let i = 0; i < dropCount; i += 1) {
        this.map.delete(entries[i][0]);
      }
    }
    this._markDirtyAndScheduleFlush();
  }

  flushToDisk() {
    if (!this._dirty) {
      return;
    }

    const payload = {
      version: 1,
      savedAtMs: Date.now(),
      entries: this._serializeEntries()
    };

    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmpPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tmpPath, `${JSON.stringify(payload)}\n`, "utf8");
      fs.renameSync(tmpPath, this.filePath);
      this._dirty = false;
    } catch {
      // Keep dirty flag so future writes can retry.
    }
  }
}

async function resolveCanonicalRoot({ client, clickedTweetId, rootHintTweetId }) {
  return xApiClient.resolveCanonicalRootTweetId({
    clickedTweetId,
    rootHintTweetId,
    client
  });
}

async function collectDatasetForCanonicalRoot({ canonicalRootId, client }) {
  const warnings = [];
  const collected = await xApiClient.collectConnectedApiTweets({
    rootTweetId: canonicalRootId,
    client,
    onWarning: (message) => warnings.push(message)
  });

  const rootTweet = collected.tweets.find((tweet) => tweet.id === canonicalRootId) || null;
  return {
    canonicalRootId,
    tweets: collected.tweets,
    users: collected.users,
    rootTweet,
    warnings
  };
}

function buildSnapshotFromDataset(dataset, followingSet) {
  const engineResult = conversationEngine.runConversationEngine({
    tweets: dataset.tweets || [],
    rankOptions: {
      followingSet
    }
  });

  return {
    canonicalRootId: dataset.canonicalRootId,
    rootId: engineResult.rootId,
    root: engineResult.root || dataset.rootTweet || null,
    nodes: engineResult.nodes || [],
    edges: engineResult.edges || [],
    ranking: engineResult.ranking || [],
    rankingMeta: engineResult.rankingMeta || { scoreById: new Map() },
    warnings: Array.isArray(dataset.warnings) ? dataset.warnings : []
  };
}

function createGraphCacheService({ bearerToken, fetchImpl, cacheStore = new MemoryCacheStore(), pipelineVersion = PIPELINE_VERSION, logger = createLogger({ level: "silent" }) } = {}) {
  if (!bearerToken || typeof bearerToken !== "string") {
    throw new Error("Missing X bearer token for graph cache service");
  }

  const inflightByKey = new Map();

  async function getSnapshot({ clickedTweetId, rootHintTweetId = null, mode = "fast", force = false, followingIds = [] } = {}) {
    const startedAtMs = nowMs();
    const normalizedMode = normalizeMode(mode);
    const followingSet = normalizeFollowingSet(followingIds);
    logger.info("snapshot_requested", {
      clickedTweetId: clickedTweetId || null,
      rootHintTweetId: rootHintTweetId || null,
      mode: normalizedMode,
      force: Boolean(force),
      followingCount: followingSet.size
    });

    const client = await xApiClient.createClient({
      bearerToken,
      fetchImpl,
      options: modeOptions(normalizedMode)
    });

    const canonicalRootId = await resolveCanonicalRoot({
      client,
      clickedTweetId,
      rootHintTweetId
    });
    logger.info("snapshot_root_resolved", {
      clickedTweetId: clickedTweetId || null,
      canonicalRootId: canonicalRootId || null,
      mode: normalizedMode
    });

    if (!canonicalRootId) {
      logger.warn("snapshot_root_missing", {
        clickedTweetId: clickedTweetId || null,
        mode: normalizedMode,
        durationMs: nowMs() - startedAtMs
      });
      return {
        canonicalRootId: null,
        rootId: null,
        root: null,
        nodes: [],
        edges: [],
        ranking: [],
        rankingMeta: { scoreById: new Map() },
        warnings: [],
        cache: {
          mode: normalizedMode,
          hit: false,
          key: null
        }
      };
    }

    const rawKey = `${canonicalRootId}|${normalizedMode}|${pipelineVersion}`;
    const cacheKey = hashCacheKey(rawKey);

    const cached = !force ? cacheStore.get(cacheKey) : null;
    if (cached) {
      const snapshot = buildSnapshotFromDataset(cached.value.dataset, followingSet);
      logger.info("snapshot_cache_hit", {
        canonicalRootId,
        cacheKey,
        mode: normalizedMode,
        ttlMsRemaining: Math.max(0, Number(cached.expiresAtMs || 0) - nowMs()),
        durationMs: nowMs() - startedAtMs
      });
      return {
        ...snapshot,
        cache: {
          mode: normalizedMode,
          hit: true,
          key: cacheKey,
          expiresAtMs: cached.expiresAtMs
        }
      };
    }

    if (!force && inflightByKey.has(cacheKey)) {
      logger.info("snapshot_inflight_wait", {
        canonicalRootId,
        cacheKey,
        mode: normalizedMode
      });
      await inflightByKey.get(cacheKey);
      const afterInflight = cacheStore.get(cacheKey);
      if (afterInflight) {
        const snapshot = buildSnapshotFromDataset(afterInflight.value.dataset, followingSet);
        logger.info("snapshot_cache_hit_after_wait", {
          canonicalRootId,
          cacheKey,
          mode: normalizedMode,
          ttlMsRemaining: Math.max(0, Number(afterInflight.expiresAtMs || 0) - nowMs()),
          durationMs: nowMs() - startedAtMs
        });
        return {
          ...snapshot,
          cache: {
            mode: normalizedMode,
            hit: true,
            key: cacheKey,
            expiresAtMs: afterInflight.expiresAtMs
          }
        };
      }
    }

    const buildPromise = (async () => {
      const dataset = await collectDatasetForCanonicalRoot({
        canonicalRootId,
        client
      });

      cacheStore.set(cacheKey, {
        dataset
      }, cacheTtlMsForMode(normalizedMode));
      logger.info("snapshot_cache_populated", {
        canonicalRootId,
        cacheKey,
        mode: normalizedMode,
        tweetCount: Array.isArray(dataset.tweets) ? dataset.tweets.length : 0,
        warningsCount: Array.isArray(dataset.warnings) ? dataset.warnings.length : 0
      });
    })();

    inflightByKey.set(cacheKey, buildPromise);
    try {
      await buildPromise;
    } finally {
      inflightByKey.delete(cacheKey);
    }

    const built = cacheStore.get(cacheKey);
    const dataset = built ? built.value.dataset : {
      canonicalRootId,
      tweets: [],
      users: [],
      rootTweet: null,
      warnings: ["cache build completed without stored dataset"]
    };

    const snapshot = buildSnapshotFromDataset(dataset, followingSet);
    logger.info("snapshot_completed", {
      canonicalRootId,
      cacheKey,
      mode: normalizedMode,
      cacheHit: false,
      nodes: Array.isArray(snapshot.nodes) ? snapshot.nodes.length : 0,
      edges: Array.isArray(snapshot.edges) ? snapshot.edges.length : 0,
      warningsCount: Array.isArray(snapshot.warnings) ? snapshot.warnings.length : 0,
      durationMs: nowMs() - startedAtMs
    });
    return {
      ...snapshot,
      cache: {
        mode: normalizedMode,
        hit: false,
        key: cacheKey,
        expiresAtMs: built?.expiresAtMs || null
      }
    };
  }

  return {
    getSnapshot
  };
}

function jsonResponse(res, statusCode, body) {
  const payload = `${JSON.stringify(body)}\n`;
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, GET, OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(payload);
}

function createServer(service, { logger = createLogger({ level: "silent" }) } = {}) {
  return http.createServer(async (req, res) => {
    const requestId = createRequestId();
    const startedAtMs = nowMs();
    const method = req.method || "UNKNOWN";
    const url = req.url || "";
    logger.info("http_request_started", {
      requestId,
      method,
      url
    });

    res.setHeader("x-ariadex-request-id", requestId);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, GET, OPTIONS",
        "access-control-allow-headers": "content-type"
      });
      res.end();
      logger.debug("http_request_completed", {
        requestId,
        method,
        url,
        statusCode: 204,
        durationMs: nowMs() - startedAtMs
      });
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      jsonResponse(res, 200, {
        ok: true,
        service: "ariadex-graph-cache"
      });
      logger.debug("http_request_completed", {
        requestId,
        method,
        url,
        statusCode: 200,
        durationMs: nowMs() - startedAtMs
      });
      return;
    }

    if (req.method === "POST" && req.url === "/v1/conversation-snapshot") {
      let rawBody = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        rawBody += chunk;
      });
      req.on("end", async () => {
        let body = {};
        try {
          body = rawBody ? JSON.parse(rawBody) : {};
        } catch {
          jsonResponse(res, 400, { error: "invalid_json" });
          logger.warn("http_request_invalid_json", {
            requestId,
            method,
            url,
            statusCode: 400,
            durationMs: nowMs() - startedAtMs
          });
          return;
        }

        try {
          const snapshot = await service.getSnapshot({
            clickedTweetId: body.clickedTweetId,
            rootHintTweetId: body.rootHintTweetId || null,
            mode: body.mode || "fast",
            force: Boolean(body.force),
            followingIds: body.followingIds || []
          });
          jsonResponse(res, 200, snapshot);
          logger.info("http_request_completed", {
            requestId,
            method,
            url,
            statusCode: 200,
            durationMs: nowMs() - startedAtMs,
            cacheHit: Boolean(snapshot?.cache?.hit),
            mode: snapshot?.cache?.mode || null,
            canonicalRootId: snapshot?.canonicalRootId || null,
            nodes: Array.isArray(snapshot?.nodes) ? snapshot.nodes.length : 0,
            edges: Array.isArray(snapshot?.edges) ? snapshot.edges.length : 0,
            warningsCount: Array.isArray(snapshot?.warnings) ? snapshot.warnings.length : 0
          });
        } catch (error) {
          jsonResponse(res, 500, {
            error: "snapshot_failed",
            message: error?.message || "unknown_error"
          });
          logger.error("http_request_failed", {
            requestId,
            method,
            url,
            statusCode: 500,
            durationMs: nowMs() - startedAtMs,
            errorMessage: error?.message || "unknown_error"
          });
        }
      });
      return;
    }

    jsonResponse(res, 404, {
      error: "not_found"
    });
    logger.warn("http_request_not_found", {
      requestId,
      method,
      url,
      statusCode: 404,
      durationMs: nowMs() - startedAtMs
    });
  });
}

async function main() {
  const bearerToken = (process.env.X_BEARER_TOKEN || process.env.X_API_BEARER_TOKEN || "").trim();
  if (!bearerToken) {
    throw new Error("Missing X_BEARER_TOKEN or X_API_BEARER_TOKEN in server environment");
  }

  const logger = createLogger({
    level: process.env.ARIADEX_LOG_LEVEL || "info"
  });

  const cachePath = process.env.ARIADEX_GRAPH_CACHE_FILE
    ? path.resolve(process.env.ARIADEX_GRAPH_CACHE_FILE)
    : path.join(__dirname, "graph_cache_store.json");
  const cacheMaxEntries = Number(process.env.ARIADEX_GRAPH_CACHE_MAX_ENTRIES || 5000);
  const cacheStore = new PersistentFileCacheStore({
    filePath: cachePath,
    maxEntries: cacheMaxEntries
  });

  const service = createGraphCacheService({
    bearerToken,
    cacheStore,
    logger
  });

  const port = Number(process.env.ARIADEX_GRAPH_CACHE_PORT || 8787);
  const host = process.env.ARIADEX_GRAPH_CACHE_HOST || "127.0.0.1";
  const server = createServer(service, { logger });

  await new Promise((resolve) => server.listen(port, host, resolve));
  process.on("SIGINT", () => {
    logger.info("server_shutdown", { signal: "SIGINT" });
    cacheStore.flushToDisk();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    logger.info("server_shutdown", { signal: "SIGTERM" });
    cacheStore.flushToDisk();
    process.exit(0);
  });
  logger.info("server_started", {
    host,
    port,
    cachePath,
    cacheMaxEntries,
    logLevel: logger.level
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error("[Ariadex] Failed to start graph cache server", error);
    process.exit(1);
  });
}

module.exports = {
  MemoryCacheStore,
  PersistentFileCacheStore,
  createLogger,
  normalizeLogLevel,
  createRequestId,
  createGraphCacheService,
  createServer,
  normalizeMode,
  normalizeFollowingSet,
  hashCacheKey,
  modeOptions
};
