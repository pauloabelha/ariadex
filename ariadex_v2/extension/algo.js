"use strict";

const TWEET_CACHE_KEY = "ariadex_v2_tweet_cache";

// The public syndication endpoint expects a deterministic token derived from the tweet id.
function buildSyndicationToken(tweetId) {
  return ((Number(tweetId) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

// Build a stable X status URL for panel navigation.
function buildTweetUrl(screenName, tweetId) {
  return `https://x.com/${encodeURIComponent(String(screenName || "i"))}/status/${encodeURIComponent(String(tweetId || ""))}`;
}

// Normalize ids at every cache and recursion boundary so we never compare mixed values.
function normalizeTweetId(tweetId) {
  return String(tweetId || "").trim();
}

// Wrap chrome storage behind a tiny promise-based adapter so the resolver stays testable.
function createStorageAdapter(chromeApi) {
  return {
    async readCache() {
      return new Promise((resolve, reject) => {
        chromeApi.storage.local.get([TWEET_CACHE_KEY], (result) => {
          const runtimeError = chromeApi.runtime?.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message || "tweet_cache_read_failed"));
            return;
          }

          const cache = result?.[TWEET_CACHE_KEY];
          resolve(cache && typeof cache === "object" ? cache : {});
        });
      });
    },

    async writeCache(cache) {
      return new Promise((resolve, reject) => {
        chromeApi.storage.local.set({ [TWEET_CACHE_KEY]: cache }, () => {
          const runtimeError = chromeApi.runtime?.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message || "tweet_cache_write_failed"));
            return;
          }

          resolve();
        });
      });
    },

    async clearCache() {
      return new Promise((resolve, reject) => {
        chromeApi.storage.local.remove([TWEET_CACHE_KEY], () => {
          const runtimeError = chromeApi.runtime?.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message || "tweet_cache_clear_failed"));
            return;
          }

          resolve();
        });
      });
    }
  };
}

// Isolate the network client so tests can stub fetch without touching resolution logic.
function createTweetClient(fetchImpl) {
  return {
    async fetchTweetFromNetwork(tweetId) {
      const token = buildSyndicationToken(tweetId);
      const url = `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(tweetId)}&token=${encodeURIComponent(token)}`;
      const response = await fetchImpl(url, { credentials: "omit" });
      if (!response.ok) {
        throw new Error(`tweet_fetch_failed_${response.status}`);
      }

      return response.json();
    }
  };
}

// Convert the raw syndication payload into the smaller shape v2 actually needs.
function normalizeTweet(payload) {
  if (!payload || !payload.id_str) {
    return null;
  }

  return {
    id: String(payload.id_str),
    author: String(payload.user?.screen_name || "unknown"),
    text: String(payload.text || ""),
    url: buildTweetUrl(payload.user?.screen_name || "i", payload.id_str),
    referenceUrls: extractReferenceUrls(payload),
    quotedId: payload?.quoted_tweet?.id_str ? String(payload.quoted_tweet.id_str) : "",
    repliedToId: payload?.in_reply_to_status_id_str ? String(payload.in_reply_to_status_id_str) : ""
  };
}

// v2 collects only explicit URL entities from the payload, not free-text URL scraping.
function extractReferenceUrls(payload) {
  const urls = Array.isArray(payload?.entities?.urls) ? payload.entities.urls : [];
  return urls
    .map((entry) => String(entry?.expanded_url || entry?.url || "").trim())
    .filter(Boolean);
}

// Collapse equivalent URLs to one canonical form and ignore internal X/Twitter links.
function canonicalizeReferenceUrl(rawUrl) {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) {
    return "";
  }

  const normalizedInput = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed.replace(/^\/+/, "")}`;

  let parsed;
  try {
    parsed = new URL(normalizedInput);
  } catch {
    return "";
  }

  const host = String(parsed.hostname || "").toLowerCase();
  if (
    host === "x.com"
    || host === "twitter.com"
    || host.endsWith(".x.com")
    || host.endsWith(".twitter.com")
    || host === "t.co"
  ) {
    return "";
  }

  parsed.protocol = "https:";
  parsed.hash = "";
  parsed.username = "";
  parsed.password = "";
  parsed.hostname = host.replace(/^www\./, "");

  if ((parsed.hostname === "youtube.com" || parsed.hostname === "m.youtube.com") && parsed.pathname === "/watch") {
    const videoId = parsed.searchParams.get("v");
    if (videoId) {
      parsed.search = `?v=${encodeURIComponent(videoId)}`;
      return parsed.toString();
    }
  }

  if (parsed.hostname === "youtu.be") {
    const videoId = parsed.pathname.replace(/^\/+/, "");
    if (videoId) {
      return `https://youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    }
  }

  const allowedParams = new Set(["v"]);
  const nextSearch = new URLSearchParams();
  for (const [key, value] of parsed.searchParams.entries()) {
    if (allowedParams.has(key)) {
      nextSearch.append(key, value);
    }
  }
  parsed.search = nextSearch.toString() ? `?${nextSearch.toString()}` : "";

  let normalized = parsed.toString();
  normalized = normalized.replace(/\/+$/, "");
  return normalized;
}

// Deduplicate references across the entire root path and assign stable 1-based ids.
function buildReferenceArtifact(path) {
  const references = [];
  const referenceByUrl = new Map();
  const enrichedPath = [];

  for (const tweet of Array.isArray(path) ? path : []) {
    const referenceNumbers = [];

    for (const rawUrl of Array.isArray(tweet?.referenceUrls) ? tweet.referenceUrls : []) {
      const canonicalUrl = canonicalizeReferenceUrl(rawUrl);
      if (!canonicalUrl) {
        continue;
      }

      let reference = referenceByUrl.get(canonicalUrl);
      if (!reference) {
        const parsed = new URL(canonicalUrl);
        reference = {
          number: references.length + 1,
          canonicalUrl,
          domain: parsed.hostname,
          citedByTweetIds: []
        };
        references.push(reference);
        referenceByUrl.set(canonicalUrl, reference);
      }

      if (!referenceNumbers.includes(reference.number)) {
        referenceNumbers.push(reference.number);
      }
      if (!reference.citedByTweetIds.includes(tweet.id)) {
        reference.citedByTweetIds.push(tweet.id);
      }
    }

    enrichedPath.push({
      ...tweet,
      referenceNumbers
    });
  }

  return {
    path: enrichedPath,
    references
  };
}

// AriadeX structural rule: quote ancestry wins over reply ancestry.
function resolveParentId(tweet) {
  if (!tweet) {
    return { parentId: "", relationType: "" };
  }

  if (tweet.quotedId) {
    return { parentId: tweet.quotedId, relationType: "quote" };
  }

  if (tweet.repliedToId) {
    return { parentId: tweet.repliedToId, relationType: "reply" };
  }

  return { parentId: "", relationType: "" };
}

// Read-through cache: check local storage first, fetch only on miss, then persist immediately.
async function fetchTweet(tweetId, { storage, client }) {
  const normalizedTweetId = normalizeTweetId(tweetId);
  if (!normalizedTweetId) {
    throw new Error("missing_tweet_id");
  }

  const cache = await storage.readCache();
  if (cache[normalizedTweetId]) {
    return cache[normalizedTweetId];
  }

  const payload = await client.fetchTweetFromNetwork(normalizedTweetId);
  await storage.writeCache({
    ...cache,
    [normalizedTweetId]: payload
  });
  return payload;
}

// Walk the structural parent chain until root or a cycle, then attach the reference artifact.
async function resolveRootPath(tweetId, deps) {
  const path = [];
  const seen = new Set();
  let currentId = normalizeTweetId(tweetId);
  const onProgress = typeof deps?.onProgress === "function" ? deps.onProgress : null;

  if (onProgress) {
    onProgress({
      phase: "start",
      clickedTweetId: currentId
    });
  }

  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);

    const payload = await fetchTweet(currentId, deps);
    const tweet = normalizeTweet(payload);
    if (!tweet) {
      break;
    }

    const { parentId, relationType } = resolveParentId(tweet);
    path.push({
      id: tweet.id,
      author: tweet.author,
      text: tweet.text,
      url: tweet.url,
      referenceUrls: tweet.referenceUrls,
      outboundRelation: relationType || ""
    });

    if (onProgress) {
      onProgress({
        phase: "path_walk",
        currentTweetId: tweet.id,
        tweetCount: path.length,
        ancestorCount: Math.max(0, path.length - 1),
        nextParentId: parentId || "",
        nextRelationType: relationType || ""
      });
    }

    currentId = parentId;
  }

  if (onProgress) {
    onProgress({
      phase: "canonicalizing_refs",
      tweetCount: path.length
    });
  }

  const artifact = buildReferenceArtifact(path.reverse());

  if (onProgress) {
    onProgress({
      phase: "done",
      tweetCount: artifact.path.length,
      referenceCount: artifact.references.length
    });
  }

  return artifact;
}

const api = {
  TWEET_CACHE_KEY,
  buildSyndicationToken,
  buildTweetUrl,
  normalizeTweetId,
  createStorageAdapter,
  createTweetClient,
  normalizeTweet,
  extractReferenceUrls,
  canonicalizeReferenceUrl,
  buildReferenceArtifact,
  resolveParentId,
  fetchTweet,
  resolveRootPath
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
} else {
  globalThis.AriadeXV2Algo = api;
}
