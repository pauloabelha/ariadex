"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const xApiClient = require("../data/x_api_client.js");
const conversationEngine = require("../core/conversation_engine.js");
const { createOpenAiContributionClassifier } = require("./openai_contribution_filter.js");

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

const ANSI_RESET = "\u001b[0m";
const ANSI_BY_LEVEL = {
  debug: "\u001b[90m",
  info: "\u001b[36m",
  warn: "\u001b[33m",
  error: "\u001b[31m"
};
const ANSI_BY_EVENT_PREFIX = {
  x_api_: "\u001b[34m",
  openai_: "\u001b[35m",
  snapshot_: "\u001b[32m",
  http_request_: "\u001b[36m"
};

function shouldColorizeLogs() {
  const explicit = String(process.env.ARIADEX_LOG_COLOR || "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(explicit)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(explicit)) {
    return false;
  }
  return Boolean(process.stdout && process.stdout.isTTY);
}

function createLogger({ level = "info", sink = null } = {}) {
  const minLevelName = normalizeLogLevel(level);
  const minLevel = LOG_LEVELS[minLevelName];
  const colorize = shouldColorizeLogs();

  function resolveEventColor(eventName, levelName) {
    const normalizedEvent = String(eventName || "");
    for (const [prefix, color] of Object.entries(ANSI_BY_EVENT_PREFIX)) {
      if (normalizedEvent.startsWith(prefix)) {
        return color;
      }
    }
    return ANSI_BY_LEVEL[levelName] || "";
  }

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
    const colorPrefix = colorize ? resolveEventColor(record.event, resolvedLevelName) : "";
    const outputLine = colorPrefix ? `${colorPrefix}${serialized}${ANSI_RESET}` : serialized;
    if (resolvedLevelName === "error") {
      console.error(outputLine);
    } else if (resolvedLevelName === "warn") {
      console.warn(outputLine);
    } else {
      console.log(outputLine);
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

function summarizeWarnings(warnings, limit = 5) {
  if (!Array.isArray(warnings) || warnings.length === 0) {
    return [];
  }
  const out = [];
  for (let i = 0; i < warnings.length && out.length < limit; i += 1) {
    const value = warnings[i];
    if (value == null) {
      continue;
    }
    const text = String(value).trim();
    if (text) {
      out.push(text.slice(0, 600));
    }
  }
  return out;
}

function summarizeRanking(ranking) {
  const scores = Array.isArray(ranking) ? ranking : [];
  const finiteScores = scores.filter((entry) => Number.isFinite(Number(entry?.score)));
  const nonZeroCount = finiteScores.filter((entry) => Math.abs(Number(entry.score)) > 0).length;
  const top = finiteScores.slice(0, 5).map((entry) => ({
    id: entry.id || null,
    score: Number(entry.score)
  }));
  return {
    rankingCount: scores.length,
    finiteScoreCount: finiteScores.length,
    nonZeroScoreCount: nonZeroCount,
    top
  };
}

function createObservedFetch({ requestId, logger, fetchImpl }) {
  const baseFetch = typeof fetchImpl === "function"
    ? fetchImpl
    : (typeof fetch === "function" ? fetch.bind(globalThis) : null);
  if (!baseFetch) {
    throw new Error("No fetch implementation available for graph cache service");
  }

  return async (url, options = {}) => {
    const startedAtMs = nowMs();
    const method = String(options?.method || "GET").toUpperCase();
    const rawUrl = String(url || "");
    let endpoint = rawUrl;
    try {
      endpoint = new URL(rawUrl).pathname;
    } catch {}

    logger.info("x_api_request_started", {
      requestId,
      method,
      endpoint
    });

    try {
      const response = await baseFetch(url, options);
      logger.info("x_api_request_completed", {
        requestId,
        method,
        endpoint,
        statusCode: Number(response?.status || 0),
        rateLimitRemaining: response?.headers?.get?.("x-rate-limit-remaining") || null,
        rateLimitReset: response?.headers?.get?.("x-rate-limit-reset") || null,
        retryAfter: response?.headers?.get?.("retry-after") || null,
        durationMs: nowMs() - startedAtMs
      });
      return response;
    } catch (error) {
      logger.error("x_api_request_failed", {
        requestId,
        method,
        endpoint,
        errorMessage: error?.message || "unknown_error",
        durationMs: nowMs() - startedAtMs
      });
      throw error;
    }
  };
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

function normalizeViewerHandles(input) {
  const handles = new Set();
  const source = Array.isArray(input) ? input : [];
  for (const value of source) {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) {
      continue;
    }
    const normalized = raw.startsWith("@") ? raw.slice(1) : raw;
    if (!/^[a-z0-9_]{1,15}$/.test(normalized)) {
      continue;
    }
    handles.add(normalized);
  }
  return [...handles];
}

async function enrichFollowingSetFromViewerHandles({ followingSet, viewerHandles, client, logger, requestId }) {
  const base = normalizeFollowingSet(followingSet);
  if (base.size > 0) {
    return {
      followingSet: base,
      resolvedFromViewer: false,
      viewerHandleUsed: null
    };
  }

  const handles = normalizeViewerHandles(viewerHandles);
  if (handles.length === 0) {
    return {
      followingSet: base,
      resolvedFromViewer: false,
      viewerHandleUsed: null
    };
  }

  const maxHandles = Math.max(1, Math.min(3, Number(process.env.ARIADEX_VIEWER_HANDLE_LOOKUP_MAX || 1)));
  const followingMaxPages = Math.max(1, Math.min(10, Number(process.env.ARIADEX_VIEWER_FOLLOWING_MAX_PAGES || 1)));
  const followingMaxIds = Math.max(50, Math.min(5000, Number(process.env.ARIADEX_VIEWER_FOLLOWING_MAX_IDS || 1000)));

  for (let i = 0; i < handles.length && i < maxHandles; i += 1) {
    const handle = handles[i];
    try {
      const viewer = await xApiClient.fetchUserByUsername(client, handle);
      const viewerId = viewer?.id ? String(viewer.id) : "";
      if (!viewerId) {
        continue;
      }

      const ids = await xApiClient.fetchFollowingUserIds(client, viewerId, {
        maxPages: followingMaxPages,
        maxIds: followingMaxIds,
        maxResults: 200
      });
      if (!Array.isArray(ids) || ids.length === 0) {
        continue;
      }

      for (const id of ids) {
        const normalized = String(id || "").trim();
        if (normalized) {
          base.add(normalized);
        }
      }

      logger.info("snapshot_following_resolved_from_viewer", {
        requestId,
        viewerHandle: `@${handle}`,
        followingCount: base.size
      });

      return {
        followingSet: base,
        resolvedFromViewer: true,
        viewerHandleUsed: `@${handle}`
      };
    } catch (error) {
      logger.warn("snapshot_viewer_following_resolution_failed", {
        requestId,
        viewerHandle: `@${handle}`,
        errorMessage: error?.message || "unknown_error"
      });
    }
  }

  return {
    followingSet: base,
    resolvedFromViewer: false,
    viewerHandleUsed: null
  };
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

function followingSignature(followingSet) {
  if (!(followingSet instanceof Set) || followingSet.size === 0) {
    return "following:none";
  }
  const normalized = [...followingSet]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean)
    .sort();
  if (normalized.length === 0) {
    return "following:none";
  }
  const digest = crypto
    .createHash("sha256")
    .update(normalized.join(","))
    .digest("hex");
  return `following:${digest}`;
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

async function collectDatasetForCanonicalRoot({ canonicalRootId, client, followingSet = new Set(), onWarning, onProgress }) {
  const warnings = [];
  const collected = await xApiClient.collectConnectedApiTweets({
    rootTweetId: canonicalRootId,
    client,
    followingSet,
    onWarning: (message) => {
      warnings.push(message);
      if (typeof onWarning === "function") {
        onWarning(message);
      }
    },
    onProgress
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
  const contributionById = dataset?.contributionById && typeof dataset.contributionById === "object"
    ? dataset.contributionById
    : null;
  const canonicalRootId = dataset?.canonicalRootId || null;
  const filteredTweets = Array.isArray(dataset?.tweets)
    ? dataset.tweets.filter((tweet) => {
      if (!tweet || !tweet.id) {
        return false;
      }
      const id = String(tweet.id);
      if (canonicalRootId && id === canonicalRootId) {
        return true;
      }
      if (!contributionById) {
        return true;
      }
      return contributionById[id] !== false;
    })
    : [];

  const engineResult = conversationEngine.runConversationEngine({
    tweets: filteredTweets,
    rankOptions: {
      followingSet
    }
  });

  const snapshot = {
    canonicalRootId: dataset.canonicalRootId,
    rootId: engineResult.rootId,
    root: engineResult.root || dataset.rootTweet || null,
    nodes: engineResult.nodes || [],
    edges: engineResult.edges || [],
    ranking: engineResult.ranking || [],
    rankingMeta: engineResult.rankingMeta || { scoreById: new Map() },
    warnings: Array.isArray(dataset.warnings) ? dataset.warnings : []
  };

  const rankingSummary = summarizeRanking(snapshot.ranking);
  const warningList = Array.isArray(snapshot.warnings) ? snapshot.warnings : [];
  const emptyReason = rankingSummary.rankingCount > 0
    ? null
    : (snapshot.nodes.length === 0
      ? "no_nodes"
      : (warningList.length > 0 ? "warnings_present" : "engine_returned_empty_ranking"));

  snapshot.diagnostics = {
    filter: {
      inputTweetCount: Array.isArray(dataset?.tweets) ? dataset.tweets.length : 0,
      filteredTweetCount: filteredTweets.length,
      removedTweetCount: Math.max(0, (Array.isArray(dataset?.tweets) ? dataset.tweets.length : 0) - filteredTweets.length),
      contributionFilterEnabled: Boolean(contributionById)
    },
    ranking: rankingSummary,
    warningsPreview: summarizeWarnings(warningList, 5),
    emptyRankingReason: emptyReason
  };

  return snapshot;
}

function hasContributionAnnotations(dataset) {
  if (!dataset || typeof dataset !== "object") {
    return false;
  }
  const map = dataset.contributionById;
  return Boolean(map && typeof map === "object" && Object.keys(map).length > 0);
}

function createGraphCacheService({ bearerToken, fetchImpl, contributionClassifier = null, cacheStore = new MemoryCacheStore(), pipelineVersion = PIPELINE_VERSION, logger = createLogger({ level: "silent" }) } = {}) {
  if (!bearerToken || typeof bearerToken !== "string") {
    throw new Error("Missing X bearer token for graph cache service");
  }

  const inflightByKey = new Map();

  async function getSnapshot({ clickedTweetId, rootHintTweetId = null, mode = "fast", force = false, incremental = true, followingIds = [], viewerHandles = [], requestId = null, onProgress = null } = {}) {
    const startedAtMs = nowMs();
    const normalizedMode = normalizeMode(mode);
    let followingSet = normalizeFollowingSet(followingIds);
    const pushProgress = (phase, message, extra = {}) => {
      if (typeof onProgress !== "function") {
        return;
      }
      try {
        onProgress({
          phase,
          message,
          ...extra
        });
      } catch {}
    };

    pushProgress("request_received", "Request received.");
    logger.info("snapshot_requested", {
      clickedTweetId: clickedTweetId || null,
      rootHintTweetId: rootHintTweetId || null,
      mode: normalizedMode,
      force: Boolean(force),
      followingCount: followingSet.size,
      viewerHandleCount: Array.isArray(viewerHandles) ? viewerHandles.length : 0
    });

    const observedFetch = createObservedFetch({
      requestId: requestId || "snapshot",
      logger,
      fetchImpl
    });
    const client = await xApiClient.createClient({
      bearerToken,
      fetchImpl: observedFetch,
      options: modeOptions(normalizedMode)
    });

    if (followingSet.size === 0) {
      const enrichment = await enrichFollowingSetFromViewerHandles({
        followingSet,
        viewerHandles,
        client,
        logger,
        requestId
      });
      followingSet = enrichment.followingSet;

      if (followingSet.size === 0) {
        logger.warn("snapshot_following_set_empty", {
          clickedTweetId: clickedTweetId || null,
          mode: normalizedMode
        });
      }
    }

    const canonicalRootId = await resolveCanonicalRoot({
      client,
      clickedTweetId,
      rootHintTweetId
    });
    pushProgress("root_resolved", canonicalRootId
      ? `Resolved canonical root ${canonicalRootId}.`
      : "Failed to resolve canonical root.", {
      canonicalRootId: canonicalRootId || null
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

    const contributionSignature = contributionClassifier?.signature
      ? String(contributionClassifier.signature)
      : "openai:none";
    const followingKeyPart = followingSignature(followingSet);
    const rawKey = `${canonicalRootId}|${normalizedMode}|${pipelineVersion}|${contributionSignature}|${followingKeyPart}`;
    const cacheKey = hashCacheKey(rawKey);

    const cached = !force ? cacheStore.get(cacheKey) : null;
    const shouldBypassCachedForMissingContribution = Boolean(
      cached
      && contributionClassifier?.enabled
      && !hasContributionAnnotations(cached?.value?.dataset)
    );
    if (shouldBypassCachedForMissingContribution) {
      logger.warn("snapshot_cache_stale_missing_contribution", {
        canonicalRootId,
        cacheKey,
        mode: normalizedMode
      });
    }

    if (cached && !shouldBypassCachedForMissingContribution) {
      let datasetForSnapshot = cached.value.dataset;

      if (incremental) {
        try {
          pushProgress("incremental_refresh", "Checking for new replies/quotes since cached snapshot.", {
            canonicalRootId
          });
          const incrementalWarnings = [];
          const incrementalResult = await xApiClient.collectConnectedApiTweetsIncremental({
            rootTweetId: canonicalRootId,
            existingTweets: Array.isArray(datasetForSnapshot?.tweets) ? datasetForSnapshot.tweets : [],
            client,
            onWarning: (message) => incrementalWarnings.push(message),
            onProgress: (progress) => {
              pushProgress(
                progress?.phase || "incremental_refresh",
                progress?.phase === "incremental_complete"
                  ? `Incremental refresh complete (${Number(progress?.newTweetCount || 0)} new tweets).`
                  : "Refreshing recent conversation activity…",
                {
                  canonicalRootId,
                  ...progress
                }
              );
            }
          });

          const newTweets = Array.isArray(incrementalResult?.tweets) ? incrementalResult.tweets : [];
          if (newTweets.length > 0) {
            const mergedById = new Map();
            for (const tweet of Array.isArray(datasetForSnapshot?.tweets) ? datasetForSnapshot.tweets : []) {
              if (tweet?.id) {
                mergedById.set(String(tweet.id), tweet);
              }
            }
            for (const tweet of newTweets) {
              if (tweet?.id) {
                mergedById.set(String(tweet.id), tweet);
              }
            }

            const mergedUsersById = new Map();
            for (const user of Array.isArray(datasetForSnapshot?.users) ? datasetForSnapshot.users : []) {
              if (user?.id) {
                mergedUsersById.set(String(user.id), user);
              }
            }
            for (const user of Array.isArray(incrementalResult?.users) ? incrementalResult.users : []) {
              if (user?.id) {
                mergedUsersById.set(String(user.id), user);
              }
            }

            const mergedContributionById = datasetForSnapshot?.contributionById && typeof datasetForSnapshot.contributionById === "object"
              ? { ...datasetForSnapshot.contributionById }
              : {};
            if (contributionClassifier && contributionClassifier.enabled && typeof contributionClassifier.classifyTweets === "function") {
              const contribution = await contributionClassifier.classifyTweets(newTweets, {
                requestId,
                canonicalRootId,
                alwaysIncludeIds: new Set([canonicalRootId])
              });
              Object.assign(mergedContributionById, contribution.byTweetId || {});
            }

            datasetForSnapshot = {
              ...datasetForSnapshot,
              tweets: [...mergedById.values()],
              users: [...mergedUsersById.values()],
              warnings: [
                ...(Array.isArray(datasetForSnapshot?.warnings) ? datasetForSnapshot.warnings : []),
                ...incrementalWarnings
              ],
              contributionById: mergedContributionById
            };

            cacheStore.set(cacheKey, {
              dataset: datasetForSnapshot
            }, cacheTtlMsForMode(normalizedMode));

            logger.info("snapshot_incremental_merged", {
              canonicalRootId,
              cacheKey,
              mode: normalizedMode,
              newTweetCount: newTweets.length,
              mergedTweetCount: datasetForSnapshot.tweets.length
            });
          }
        } catch (error) {
          logger.warn("snapshot_incremental_failed", {
            canonicalRootId,
            cacheKey,
            mode: normalizedMode,
            errorMessage: error?.message || "unknown_error"
          });
        }
      }

      const snapshot = buildSnapshotFromDataset(datasetForSnapshot, followingSet);
      pushProgress("cache_hit", "Loaded snapshot from cache.", {
        canonicalRootId
      });
      logger.info("snapshot_cache_hit", {
        canonicalRootId,
        cacheKey,
        mode: normalizedMode,
        ttlMsRemaining: Math.max(0, Number(cached.expiresAtMs || 0) - nowMs()),
        rankingCount: Number(snapshot?.diagnostics?.ranking?.rankingCount || 0),
        nonZeroScoreCount: Number(snapshot?.diagnostics?.ranking?.nonZeroScoreCount || 0),
        topRankingPreview: snapshot?.diagnostics?.ranking?.top || [],
        emptyRankingReason: snapshot?.diagnostics?.emptyRankingReason || null,
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

    if (!force && !shouldBypassCachedForMissingContribution && inflightByKey.has(cacheKey)) {
      pushProgress("waiting_inflight", "Waiting for in-flight snapshot build.", {
        canonicalRootId
      });
      logger.info("snapshot_inflight_wait", {
        canonicalRootId,
        cacheKey,
        mode: normalizedMode
      });
      await inflightByKey.get(cacheKey);
      const afterInflight = cacheStore.get(cacheKey);
      if (afterInflight) {
        const snapshot = buildSnapshotFromDataset(afterInflight.value.dataset, followingSet);
        pushProgress("cache_hit_after_wait", "Loaded snapshot from cache after wait.", {
          canonicalRootId
        });
        logger.info("snapshot_cache_hit_after_wait", {
          canonicalRootId,
          cacheKey,
          mode: normalizedMode,
          ttlMsRemaining: Math.max(0, Number(afterInflight.expiresAtMs || 0) - nowMs()),
          rankingCount: Number(snapshot?.diagnostics?.ranking?.rankingCount || 0),
          nonZeroScoreCount: Number(snapshot?.diagnostics?.ranking?.nonZeroScoreCount || 0),
          topRankingPreview: snapshot?.diagnostics?.ranking?.top || [],
          emptyRankingReason: snapshot?.diagnostics?.emptyRankingReason || null,
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
      pushProgress("collecting", "Collecting conversation data from X API.", {
        canonicalRootId
      });
      const dataset = await collectDatasetForCanonicalRoot({
        canonicalRootId,
        client,
        followingSet,
        onProgress: (progress) => {
          const phaseLabels = {
            collection_started: "Collection started.",
            collecting_root: progress?.rootId ? `Collecting root ${progress.rootId}.` : "Collecting root.",
            replies_fetched: `Replies fetched${Number.isFinite(progress?.replies) ? ` (${progress.replies})` : ""}.`,
            quotes_fetched: `Quotes fetched${Number.isFinite(progress?.quotes) ? ` (${progress.quotes})` : ""}.`,
            quote_reply_expanded: "Expanding quote replies.",
            retweets_fetched: `Retweets fetched${Number.isFinite(progress?.retweeters) ? ` (${progress.retweeters})` : ""}.`,
            references_hydrated: "Hydrating referenced tweets.",
            authors_hydrated: "Hydrating author profiles.",
            collection_complete: `Collection complete${Number.isFinite(progress?.tweetCount) ? ` (${progress.tweetCount} tweets)` : ""}.`,
            network_discovery_batch: `Discovering followed-author posts${Number.isFinite(progress?.discovered) ? ` (${progress.discovered})` : ""}.`
          };
          pushProgress(progress?.phase || "collecting", phaseLabels[progress?.phase] || "Collecting data…", {
            canonicalRootId,
            ...progress
          });
          logger.info("snapshot_phase", {
            requestId,
            canonicalRootId,
            mode: normalizedMode,
            phase: progress?.phase || null,
            rootId: progress?.rootId || null,
            processedRoots: Number(progress?.processedRoots || 0),
            queuedRoots: Number(progress?.queuedRoots || 0),
            tweetCount: Number(progress?.tweetCount || 0),
            replies: Number(progress?.replies || 0),
            quotes: Number(progress?.quotes || 0),
            retweeters: Number(progress?.retweeters || 0),
            discovered: Number(progress?.discovered || 0),
            references: Number(progress?.references || 0),
            authors: Number(progress?.authors || 0)
          });
        },
        onWarning: (warningMessage) => {
          logger.warn("snapshot_warning", {
            requestId,
            canonicalRootId,
            mode: normalizedMode,
            warning: String(warningMessage || "").slice(0, 1000)
          });
        }
      });

      if (contributionClassifier && contributionClassifier.enabled && typeof contributionClassifier.classifyTweets === "function") {
        pushProgress("classifying", "Classifying contributions with OpenAI.", {
          canonicalRootId
        });
        const contribution = await contributionClassifier.classifyTweets(dataset.tweets, {
          requestId,
          canonicalRootId,
          alwaysIncludeIds: new Set([canonicalRootId])
        });
        dataset.contributionById = contribution.byTweetId || {};
        logger.info("snapshot_contribution_filter_applied", {
          requestId,
          canonicalRootId,
          model: contribution.model || null,
          threshold: Number(contribution.threshold || 0),
          candidateCount: Number(contribution.candidateCount || 0),
          classifiedCount: Number(contribution.classifiedCount || 0),
          contributingCount: Number(contribution.contributingCount || 0),
          nonContributingCount: Number(contribution.nonContributingCount || 0),
          heuristicRejectedCount: Number(contribution.heuristicRejectedCount || 0),
          dedupedCount: Number(contribution.dedupedCount || 0),
          maxConcurrentBatches: Number(contribution.maxConcurrentBatches || 0),
          totalPromptTokens: Number(contribution?.usage?.promptTokens || 0),
          totalCompletionTokens: Number(contribution?.usage?.completionTokens || 0),
          totalTokens: Number(contribution?.usage?.totalTokens || 0)
        });
        pushProgress("classifying_complete", "Contribution classification complete.", {
          canonicalRootId,
          classifiedCount: Number(contribution.classifiedCount || 0),
          nonContributingCount: Number(contribution.nonContributingCount || 0)
        });
      } else {
        logger.info("snapshot_contribution_filter_skipped", {
          requestId,
          canonicalRootId,
          reason: "classifier_disabled_or_missing"
        });
      }

      cacheStore.set(cacheKey, {
        dataset
      }, cacheTtlMsForMode(normalizedMode));
      pushProgress("cache_populated", "Snapshot cached.", {
        canonicalRootId
      });
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
    pushProgress("completed", "Snapshot complete.", {
      canonicalRootId
    });
    logger.info("snapshot_completed", {
      canonicalRootId,
      cacheKey,
      mode: normalizedMode,
      cacheHit: false,
      nodes: Array.isArray(snapshot.nodes) ? snapshot.nodes.length : 0,
      edges: Array.isArray(snapshot.edges) ? snapshot.edges.length : 0,
      warningsCount: Array.isArray(snapshot.warnings) ? snapshot.warnings.length : 0,
      rankingCount: Number(snapshot?.diagnostics?.ranking?.rankingCount || 0),
      nonZeroScoreCount: Number(snapshot?.diagnostics?.ranking?.nonZeroScoreCount || 0),
      topRankingPreview: snapshot?.diagnostics?.ranking?.top || [],
      emptyRankingReason: snapshot?.diagnostics?.emptyRankingReason || null,
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
    "access-control-allow-headers": "content-type",
    "access-control-allow-private-network": "true"
  });
  res.end(payload);
}

function createServer(service, { logger = createLogger({ level: "silent" }) } = {}) {
  const jobs = new Map();
  const JOB_TTL_MS = 10 * 60 * 1000;

  function cleanupJobs() {
    const cutoff = nowMs() - JOB_TTL_MS;
    for (const [jobId, job] of jobs.entries()) {
      if (Number(job?.updatedAtMs || 0) < cutoff) {
        jobs.delete(jobId);
      }
    }
  }

  function sanitizeJob(job) {
    return {
      jobId: job.jobId,
      status: job.status,
      createdAtMs: job.createdAtMs,
      updatedAtMs: job.updatedAtMs,
      progress: Array.isArray(job.progress) ? job.progress.slice(-50) : [],
      snapshot: job.status === "completed" ? (job.snapshot || null) : null,
      error: job.status === "failed" ? (job.error || null) : null
    };
  }

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
        "access-control-allow-headers": "content-type",
        "access-control-allow-private-network": "true"
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
            incremental: body.incremental !== false,
            followingIds: body.followingIds || [],
            viewerHandles: body.viewerHandles || [],
            requestId
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
            warningsCount: Array.isArray(snapshot?.warnings) ? snapshot.warnings.length : 0,
            rankingCount: Number(snapshot?.diagnostics?.ranking?.rankingCount || 0),
            nonZeroScoreCount: Number(snapshot?.diagnostics?.ranking?.nonZeroScoreCount || 0),
            emptyRankingReason: snapshot?.diagnostics?.emptyRankingReason || null
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

    if (req.method === "POST" && req.url === "/v1/conversation-snapshot/jobs") {
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
          return;
        }

        cleanupJobs();
        const jobId = createRequestId();
        const job = {
          jobId,
          status: "running",
          createdAtMs: nowMs(),
          updatedAtMs: nowMs(),
          progress: [{ ts: new Date().toISOString(), phase: "queued", message: "Job queued." }],
          snapshot: null,
          error: null
        };
        jobs.set(jobId, job);

        (async () => {
          try {
            const snapshot = await service.getSnapshot({
              clickedTweetId: body.clickedTweetId,
              rootHintTweetId: body.rootHintTweetId || null,
              mode: body.mode || "fast",
              force: Boolean(body.force),
              incremental: body.incremental !== false,
              followingIds: body.followingIds || [],
              viewerHandles: body.viewerHandles || [],
              requestId: jobId,
              onProgress: (progress) => {
                const current = jobs.get(jobId);
                if (!current) {
                  return;
                }
                current.updatedAtMs = nowMs();
                current.progress.push({
                  ts: new Date().toISOString(),
                  phase: progress?.phase || "progress",
                  message: String(progress?.message || "Working…"),
                  canonicalRootId: progress?.canonicalRootId || null,
                  counts: {
                    tweets: Number(progress?.tweetCount || 0),
                    processedRoots: Number(progress?.processedRoots || 0),
                    queuedRoots: Number(progress?.queuedRoots || 0)
                  }
                });
              }
            });
            const current = jobs.get(jobId);
            if (!current) {
              return;
            }
            current.status = "completed";
            current.updatedAtMs = nowMs();
            current.snapshot = snapshot;
            current.progress.push({
              ts: new Date().toISOString(),
              phase: "completed",
              message: "Snapshot completed."
            });
          } catch (error) {
            const current = jobs.get(jobId);
            if (!current) {
              return;
            }
            current.status = "failed";
            current.updatedAtMs = nowMs();
            current.error = {
              message: error?.message || "snapshot_job_failed"
            };
            current.progress.push({
              ts: new Date().toISOString(),
              phase: "failed",
              message: current.error.message
            });
          }
        })();

        jsonResponse(res, 202, {
          jobId,
          status: "running"
        });
      });
      return;
    }

    if (req.method === "GET" && req.url && req.url.startsWith("/v1/conversation-snapshot/jobs/")) {
      cleanupJobs();
      const jobId = req.url.split("/").pop();
      const job = jobId ? jobs.get(jobId) : null;
      if (!job) {
        jsonResponse(res, 404, { error: "job_not_found" });
        return;
      }
      jsonResponse(res, 200, sanitizeJob(job));
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
    contributionClassifier: createOpenAiContributionClassifier({ logger }),
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
    logLevel: logger.level,
    openAiEnabled: Boolean((process.env.OPENAI_API_KEY || "").trim()),
    pipelineVersion: PIPELINE_VERSION
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
  normalizeViewerHandles,
  enrichFollowingSetFromViewerHandles,
  hashCacheKey,
  modeOptions
};
