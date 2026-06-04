"use strict";

const TWEET_CACHE_KEY = "ariadex_tweet_cache";
const CONVERSATION_CACHE_KEY = "ariadex_conversation_cache";
const QUOTE_TWEET_CACHE_KEY = "ariadex_quote_tweet_cache";
const TOP_TAKES_ANALYSIS_CACHE_KEY = "ariadex_top_takes_analysis_cache";
const TOP_TAKES_ARTIFACT_CACHE_KEY = "ariadex_top_takes_artifact_cache";
const TOP_TAKES_CACHE_VERSION = 8;
const DEFAULT_API_BASE_URL = "https://api.x.com/2";
const DEFAULT_TWEET_FIELDS = [
  "author_id",
  "conversation_id",
  "created_at",
  "entities",
  "in_reply_to_user_id",
  "public_metrics",
  "referenced_tweets",
  "text"
];
const DEFAULT_USER_FIELDS = [
  "description",
  "public_metrics",
  "id",
  "name",
  "profile_image_url",
  "username",
  "verified",
  "verified_type"
];
const DEFAULT_EXPANSIONS = [
  "author_id"
];
const DEFAULT_OPTIONS = {
  apiBaseUrl: DEFAULT_API_BASE_URL,
  maxPagesPerCollection: 5,
  maxResultsPerPage: 100,
  maxQuoteTweets: 200,
  maxQuotePages: 3,
  quoteBatchSize: 40,
  representativesPerRole: 3,
  maxContextConversationFetches: 8,
  threadContinuationsPerQuote: 4,
  topCommentsPerQuote: 3,
  maxRateLimitRetries: 2,
  rateLimitRetryDelayMs: 60_000,
  rateLimitMaxWaitMs: 120_000
};
const TOP_TAKES_ROLES = [
  "validation",
  "skepticism",
  "evidence",
  "operational_caveat",
  "technical_explanation",
  "methodological_criticism",
  "commercialization_framing",
  "historical_context",
  "synthesis",
  "hype",
  "other"
];
const TOP_TAKES_ROLE_LABELS = {
  validation: "Best Validation",
  skepticism: "Strongest Skeptical Take",
  evidence: "Best Evidence-Based Take",
  operational_caveat: "Most Important Operational Caveat",
  technical_explanation: "Best Technical Explanation",
  methodological_criticism: "Best Methodological Criticism",
  commercialization_framing: "Best Commercial Framing",
  historical_context: "Most Informative Context",
  synthesis: "Best Synthesis",
  hype: "Notable Hype Signal",
  other: "Other Informative Take"
};
const TOP_TAKES_DOMAIN_GROUPS = ["expert", "adjacent"];
const TOP_TAKES_DOMAIN_GROUP_LABELS = {
  expert: "Expert",
  adjacent: "Adjacent"
};
const inFlightTweetFetchById = new Map();
const inFlightConversationFetchById = new Map();

function buildTweetUrl(screenName, tweetId) {
  return `https://x.com/${encodeURIComponent(String(screenName || "i"))}/status/${encodeURIComponent(String(tweetId || ""))}`;
}

function normalizeTweetId(tweetId) {
  return String(tweetId || "").trim();
}

function canonicalizeHandle(rawHandle) {
  const normalized = String(rawHandle || "").trim().replace(/^@+/, "").toLowerCase();
  return /^[a-z0-9_]{1,15}$/.test(normalized) ? normalized : "";
}

function normalizeDisplayName(rawName) {
  return String(rawName || "").replace(/\s+/g, " ").trim();
}

function normalizeAvatarUrl(rawUrl) {
  return String(rawUrl || "").trim();
}

function normalizeTimestamp(rawValue) {
  return String(rawValue || "").trim();
}

function clampScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  return Math.max(0, Math.min(1, number));
}

function normalizeMetric(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Number(ms || 0)));
  });
}

function parseRateLimitWaitMs(response, options = {}) {
  const headers = response?.headers;
  const retryAfter = Number(headers?.get?.("retry-after") || 0);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return retryAfter * 1000;
  }

  const resetSeconds = Number(headers?.get?.("x-rate-limit-reset") || 0);
  if (Number.isFinite(resetSeconds) && resetSeconds > 0) {
    const waitMs = (resetSeconds * 1000) - Date.now() + 1000;
    if (waitMs > 0) {
      return waitMs;
    }
  }

  return Number(options?.rateLimitRetryDelayMs || DEFAULT_OPTIONS.rateLimitRetryDelayMs);
}

function ensureArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value == null) {
    return [];
  }
  return [value];
}

function buildQuery(params = {}) {
  const query = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(params)) {
    if (rawValue == null || rawValue === "") {
      continue;
    }

    if (Array.isArray(rawValue)) {
      const filtered = rawValue.filter((entry) => entry != null && entry !== "");
      if (filtered.length > 0) {
        query.set(key, filtered.join(","));
      }
      continue;
    }

    query.set(key, String(rawValue));
  }
  return query;
}

function buildApiUrl(apiBaseUrl, path, params = {}) {
  const normalizedBase = String(apiBaseUrl || DEFAULT_API_BASE_URL).replace(/\/$/, "");
  const normalizedPath = String(path || "").startsWith("/") ? path : `/${path}`;
  const url = new URL(`${normalizedBase}${normalizedPath}`);
  const query = buildQuery(params);
  query.forEach((value, key) => {
    url.searchParams.set(key, value);
  });
  return url;
}

function buildBaseApiParams(maxResults) {
  return {
    expansions: DEFAULT_EXPANSIONS,
    "tweet.fields": DEFAULT_TWEET_FIELDS,
    "user.fields": DEFAULT_USER_FIELDS,
    ...(typeof maxResults === "number" ? { max_results: maxResults } : {})
  };
}

function pickReferencedTweetId(tweet, type) {
  const refs = ensureArray(tweet?.referenced_tweets);
  const match = refs.find((entry) => entry && entry.type === type && entry.id);
  return match ? String(match.id) : "";
}

function createUserMap(users) {
  const byId = new Map();
  for (const user of ensureArray(users)) {
    if (!user?.id || byId.has(String(user.id))) {
      continue;
    }
    byId.set(String(user.id), user);
  }
  return byId;
}

function convertApiTweetToPayload(tweet, userById) {
  if (!tweet?.id) {
    return null;
  }

  const authorId = tweet.author_id ? String(tweet.author_id) : "";
  const author = authorId ? userById.get(authorId) : null;
  const authorHandle = canonicalizeHandle(author?.username || "unknown") || "unknown";
  const mentions = ensureArray(tweet?.entities?.mentions).map((mention) => ({
    screen_name: mention?.username || "",
    name: "",
    profile_image_url_https: ""
  }));
  const urls = ensureArray(tweet?.entities?.urls).map((entry) => ({
    expanded_url: entry?.unwound_url || entry?.expanded_url || entry?.url || ""
  }));
  const repliedToId = pickReferencedTweetId(tweet, "replied_to");
  const quotedId = pickReferencedTweetId(tweet, "quoted");

  const payload = {
    id_str: String(tweet.id),
    conversation_id_str: String(tweet.conversation_id || tweet.id),
    created_at: normalizeTimestamp(tweet.created_at),
    text: String(tweet.text || ""),
    in_reply_to_status_id_str: repliedToId,
    quoted_tweet: quotedId ? { id_str: quotedId } : undefined,
    entities: {
      urls,
      user_mentions: mentions
    },
    user: {
      screen_name: authorHandle,
      name: normalizeDisplayName(author?.name || ""),
      profile_image_url_https: normalizeAvatarUrl(author?.profile_image_url || "")
    }
  };

  if (tweet?.public_metrics && typeof tweet.public_metrics === "object") {
    payload.public_metrics = {
      retweet_count: normalizeMetric(tweet.public_metrics.retweet_count),
      reply_count: normalizeMetric(tweet.public_metrics.reply_count),
      like_count: normalizeMetric(tweet.public_metrics.like_count),
      quote_count: normalizeMetric(tweet.public_metrics.quote_count),
      bookmark_count: normalizeMetric(tweet.public_metrics.bookmark_count),
      impression_count: normalizeMetric(tweet.public_metrics.impression_count)
    };
  }
  if (author?.verified != null) {
    payload.user.verified = Boolean(author.verified);
  }
  if (author?.verified_type) {
    payload.user.verified_type = String(author.verified_type || "");
  }
  if (author?.public_metrics && typeof author.public_metrics === "object") {
    payload.user.followers_count = normalizeMetric(author.public_metrics.followers_count);
    payload.user.following_count = normalizeMetric(author.public_metrics.following_count);
    payload.user.tweet_count = normalizeMetric(author.public_metrics.tweet_count);
  }
  if (author?.description) {
    payload.user.description = normalizeDisplayName(author.description || "");
  }

  return payload;
}

function collectMissingReferencedTweetIds(payloadsById) {
  const missing = new Set();
  for (const payload of Object.values(payloadsById || {})) {
    const repliedToId = normalizeTweetId(payload?.in_reply_to_status_id_str || "");
    const quotedId = normalizeTweetId(payload?.quoted_tweet?.id_str || "");
    if (repliedToId && !payloadsById[repliedToId]) {
      missing.add(repliedToId);
    }
    if (quotedId && !payloadsById[quotedId]) {
      missing.add(quotedId);
    }
  }
  return [...missing];
}

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

    async readConversationCache() {
      return new Promise((resolve, reject) => {
        chromeApi.storage.local.get([CONVERSATION_CACHE_KEY], (result) => {
          const runtimeError = chromeApi.runtime?.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message || "conversation_cache_read_failed"));
            return;
          }

          const cache = result?.[CONVERSATION_CACHE_KEY];
          resolve(cache && typeof cache === "object" ? cache : {});
        });
      });
    },

    async readQuoteTweetCache() {
      return new Promise((resolve, reject) => {
        chromeApi.storage.local.get([QUOTE_TWEET_CACHE_KEY], (result) => {
          const runtimeError = chromeApi.runtime?.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message || "quote_tweet_cache_read_failed"));
            return;
          }

          const cache = result?.[QUOTE_TWEET_CACHE_KEY];
          resolve(cache && typeof cache === "object" ? cache : {});
        });
      });
    },

    async readTopTakesAnalysisCache() {
      return new Promise((resolve, reject) => {
        chromeApi.storage.local.get([TOP_TAKES_ANALYSIS_CACHE_KEY], (result) => {
          const runtimeError = chromeApi.runtime?.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message || "top_takes_cache_read_failed"));
            return;
          }

          const cache = result?.[TOP_TAKES_ANALYSIS_CACHE_KEY];
          resolve(cache && typeof cache === "object" ? cache : {});
        });
      });
    },

    async readTopTakesArtifactCache() {
      return new Promise((resolve, reject) => {
        chromeApi.storage.local.get([TOP_TAKES_ARTIFACT_CACHE_KEY], (result) => {
          const runtimeError = chromeApi.runtime?.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message || "top_takes_artifact_cache_read_failed"));
            return;
          }

          const cache = result?.[TOP_TAKES_ARTIFACT_CACHE_KEY];
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

    async writeConversationCache(cache) {
      return new Promise((resolve, reject) => {
        chromeApi.storage.local.set({ [CONVERSATION_CACHE_KEY]: cache }, () => {
          const runtimeError = chromeApi.runtime?.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message || "conversation_cache_write_failed"));
            return;
          }

          resolve();
        });
      });
    },

    async writeQuoteTweetCache(cache) {
      return new Promise((resolve, reject) => {
        chromeApi.storage.local.set({ [QUOTE_TWEET_CACHE_KEY]: cache }, () => {
          const runtimeError = chromeApi.runtime?.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message || "quote_tweet_cache_write_failed"));
            return;
          }

          resolve();
        });
      });
    },

    async writeTopTakesAnalysisCache(cache) {
      return new Promise((resolve, reject) => {
        chromeApi.storage.local.set({ [TOP_TAKES_ANALYSIS_CACHE_KEY]: cache }, () => {
          const runtimeError = chromeApi.runtime?.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message || "top_takes_cache_write_failed"));
            return;
          }

          resolve();
        });
      });
    },

    async writeTopTakesArtifactCache(cache) {
      return new Promise((resolve, reject) => {
        chromeApi.storage.local.set({ [TOP_TAKES_ARTIFACT_CACHE_KEY]: cache }, () => {
          const runtimeError = chromeApi.runtime?.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message || "top_takes_artifact_cache_write_failed"));
            return;
          }

          resolve();
        });
      });
    },

    async clearCache() {
      return new Promise((resolve, reject) => {
        chromeApi.storage.local.remove([TWEET_CACHE_KEY, CONVERSATION_CACHE_KEY, QUOTE_TWEET_CACHE_KEY, TOP_TAKES_ANALYSIS_CACHE_KEY, TOP_TAKES_ARTIFACT_CACHE_KEY], () => {
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

function createTweetClient(fetchImpl, options = {}) {
  const bearerToken = String(options?.bearerToken || "").trim();
  if (!bearerToken) {
    throw new Error("missing_x_api_bearer_token");
  }

  const effectiveFetch = typeof fetchImpl === "function"
    ? fetchImpl
    : (typeof fetch === "function" ? fetch.bind(globalThis) : null);
  if (!effectiveFetch) {
    throw new Error("missing_fetch_implementation");
  }

  const clientOptions = {
    ...DEFAULT_OPTIONS,
    ...(options && typeof options === "object" ? options : {})
  };

  async function request(path, params = {}) {
    const url = buildApiUrl(clientOptions.apiBaseUrl, path, params);
    const maxRetries = Math.max(0, Math.min(10, Number(clientOptions.maxRateLimitRetries ?? DEFAULT_OPTIONS.maxRateLimitRetries)));
    const maxWaitMs = Math.max(0, Number(clientOptions.rateLimitMaxWaitMs ?? DEFAULT_OPTIONS.rateLimitMaxWaitMs));

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const response = await effectiveFetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${bearerToken}`
        }
      });

      if (response.ok) {
        return response.json();
      }

      if (Number(response.status) === 429 && attempt < maxRetries) {
        const rawWaitMs = parseRateLimitWaitMs(response, clientOptions);
        const waitMs = maxWaitMs > 0 ? Math.min(rawWaitMs, maxWaitMs) : rawWaitMs;
        if (typeof clientOptions.onProgress === "function") {
          clientOptions.onProgress({
            phase: "x_rate_limit_wait",
            path,
            attempt: attempt + 1,
            maxAttempts: maxRetries + 1,
            waitMs
          });
        }
        await sleep(waitMs);
        continue;
      }

      const error = new Error(`tweet_fetch_failed_${response.status}`);
      error.status = response.status;
      error.path = path;
      throw error;
    }

    throw new Error("tweet_fetch_failed");
  }

  async function fetchTweetFromNetwork(tweetId) {
    const response = await request(`/tweets/${encodeURIComponent(tweetId)}`, buildBaseApiParams());
    const payload = convertApiTweetToPayload(response?.data, createUserMap(response?.includes?.users));
    return payload;
  }

  async function fetchTweetsFromNetwork(tweetIds) {
    const ids = ensureArray(tweetIds).map((entry) => normalizeTweetId(entry)).filter(Boolean);
    if (ids.length === 0) {
      return [];
    }

    const response = await request("/tweets", {
      ...buildBaseApiParams(),
      ids: ids.join(",")
    });
    const userById = createUserMap(response?.includes?.users);
    return ensureArray(response?.data)
      .map((tweet) => convertApiTweetToPayload(tweet, userById))
      .filter(Boolean);
  }

  async function fetchConversationFromNetwork(conversationId) {
    const normalizedConversationId = normalizeTweetId(conversationId);
    if (!normalizedConversationId) {
      return [];
    }

    async function collectConversationPayloads(searchPath) {
      const payloadsById = {};
      let nextToken = "";

      for (let page = 0; page < clientOptions.maxPagesPerCollection; page += 1) {
        const response = await request(searchPath, {
          ...buildBaseApiParams(clientOptions.maxResultsPerPage),
          query: `conversation_id:${normalizedConversationId}`,
          ...(nextToken ? { pagination_token: nextToken } : {})
        });
        const userById = createUserMap(response?.includes?.users);
        for (const tweet of ensureArray(response?.data)) {
          const payload = convertApiTweetToPayload(tweet, userById);
          if (payload?.id_str) {
            payloadsById[payload.id_str] = payload;
          }
        }

        nextToken = String(response?.meta?.next_token || "").trim();
        if (!nextToken) {
          break;
        }
      }

      return payloadsById;
    }

    let payloadsById;
    try {
      payloadsById = await collectConversationPayloads("/tweets/search/all");
    } catch (error) {
      if (![400, 403, 404].includes(Number(error?.status || 0))) {
        throw error;
      }
      payloadsById = await collectConversationPayloads("/tweets/search/recent");
    }

    let missingIds = collectMissingReferencedTweetIds(payloadsById);
    while (missingIds.length > 0) {
      const fetchedPayloads = await fetchTweetsFromNetwork(missingIds.slice(0, 100));
      for (const payload of fetchedPayloads) {
        if (payload?.id_str && !payloadsById[payload.id_str]) {
          payloadsById[payload.id_str] = payload;
        }
      }
      const unresolvedIds = missingIds.filter((id) => !payloadsById[id]);
      if (unresolvedIds.length > 0) {
        break;
      }
      missingIds = collectMissingReferencedTweetIds(payloadsById);
    }

    return Object.values(payloadsById);
  }

  async function fetchQuoteTweetsFromNetwork(tweetId, options = {}) {
    const normalizedTweetId = normalizeTweetId(tweetId);
    if (!normalizedTweetId) {
      return [];
    }

    const maxPages = Math.max(1, Math.min(10, Number(options?.maxPages || clientOptions.maxQuotePages || 3)));
    const maxQuotes = Math.max(1, Math.min(500, Number(options?.maxQuoteTweets || clientOptions.maxQuoteTweets || DEFAULT_OPTIONS.maxQuoteTweets)));
    const maxResults = Math.max(10, Math.min(100, Number(options?.maxResultsPerPage || clientOptions.maxResultsPerPage || 100)));
    const payloadsById = {};
    let nextToken = "";

    for (let page = 0; page < maxPages && Object.keys(payloadsById).length < maxQuotes; page += 1) {
      const response = await request(`/tweets/${encodeURIComponent(normalizedTweetId)}/quote_tweets`, {
        ...buildBaseApiParams(maxResults),
        ...(nextToken ? { pagination_token: nextToken } : {})
      });
      const userById = createUserMap(response?.includes?.users);
      for (const tweet of ensureArray(response?.data)) {
        const payload = convertApiTweetToPayload(tweet, userById);
        if (payload?.id_str && !payloadsById[payload.id_str]) {
          payloadsById[payload.id_str] = payload;
        }
        if (Object.keys(payloadsById).length >= maxQuotes) {
          break;
        }
      }

      nextToken = String(response?.meta?.next_token || "").trim();
      if (!nextToken) {
        break;
      }
    }

    return Object.values(payloadsById);
  }

  return {
    request,
    fetchTweetFromNetwork,
    fetchTweetsFromNetwork,
    fetchConversationFromNetwork,
    fetchQuoteTweetsFromNetwork
  };
}

function normalizeTweet(payload) {
  if (!payload || !payload.id_str) {
    return null;
  }

  const authorHandle = canonicalizeHandle(payload.user?.screen_name || "unknown") || "unknown";
  const mentionPeople = extractMentionPeople(payload);
  return {
    id: String(payload.id_str),
    conversationId: String(payload.conversation_id_str || payload.id_str),
    createdAt: normalizeTimestamp(payload.created_at),
    author: authorHandle,
    authorName: normalizeDisplayName(payload.user?.name || ""),
    authorAvatarUrl: normalizeAvatarUrl(payload.user?.profile_image_url_https || payload.user?.profile_image_url || ""),
    text: String(payload.text || ""),
    url: buildTweetUrl(authorHandle || "i", payload.id_str),
    referenceUrls: extractReferenceUrls(payload),
    mentionHandles: mentionPeople.map((entry) => entry.handle),
    mentionPeople,
    quotedId: payload?.quoted_tweet?.id_str ? String(payload.quoted_tweet.id_str) : "",
    repliedToId: payload?.in_reply_to_status_id_str ? String(payload.in_reply_to_status_id_str) : ""
  };
}

function normalizeQuoteTweet(payload) {
  const tweet = normalizeTweet(payload);
  if (!tweet) {
    return null;
  }

  const metrics = payload?.public_metrics || {};
  return {
    ...tweet,
    metrics: {
      retweets: normalizeMetric(metrics.retweet_count),
      replies: normalizeMetric(metrics.reply_count),
      likes: normalizeMetric(metrics.like_count),
      quotes: normalizeMetric(metrics.quote_count),
      bookmarks: normalizeMetric(metrics.bookmark_count),
      impressions: normalizeMetric(metrics.impression_count)
    },
    authorVerified: Boolean(payload?.user?.verified),
    authorVerifiedType: String(payload?.user?.verified_type || ""),
    authorFollowers: normalizeMetric(payload?.user?.followers_count),
    authorFollowing: normalizeMetric(payload?.user?.following_count),
    authorTweetCount: normalizeMetric(payload?.user?.tweet_count),
    authorDescription: normalizeDisplayName(payload?.user?.description || "")
  };
}

function normalizeTextForDedupe(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/@\w{1,15}/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isSpamLikeQuote(tweet) {
  const text = normalizeTextForDedupe(tweet?.text || "");
  if (!text) {
    return true;
  }
  const rawText = String(tweet?.text || "").trim();
  if (/^rt\s+@/i.test(rawText)) {
    return true;
  }
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 2) {
    return true;
  }
  const withoutMentionsAndUrls = rawText
    .replace(/@\w{1,15}/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .trim();
  if (words.length <= 6 && !withoutMentionsAndUrls) {
    return true;
  }
  const uniqueWords = new Set(words);
  return words.length >= 8 && uniqueWords.size / words.length < 0.35;
}

function areNearDuplicateTexts(leftText, rightText) {
  const leftWords = new Set(normalizeTextForDedupe(leftText).split(/\s+/).filter(Boolean));
  const rightWords = new Set(normalizeTextForDedupe(rightText).split(/\s+/).filter(Boolean));
  if (leftWords.size === 0 || rightWords.size === 0) {
    return false;
  }
  const intersection = [...leftWords].filter((word) => rightWords.has(word)).length;
  const smaller = Math.min(leftWords.size, rightWords.size);
  const larger = Math.max(leftWords.size, rightWords.size);
  return intersection / smaller >= 0.9 && intersection / larger >= 0.72;
}

function dedupeQuoteTweets(quoteTweets) {
  const deduped = [];
  const exactTextKeys = new Set();
  for (const tweet of ensureArray(quoteTweets)) {
    if (!tweet?.id || isSpamLikeQuote(tweet)) {
      continue;
    }
    const key = normalizeTextForDedupe(tweet.text);
    if (!key || exactTextKeys.has(key)) {
      continue;
    }
    if (deduped.some((entry) => areNearDuplicateTexts(entry.text, tweet.text))) {
      continue;
    }
    exactTextKeys.add(key);
    deduped.push(tweet);
  }
  return deduped;
}

function buildTopTakesPeople(sourceTweet, quoteTweets) {
  const people = [];
  const byHandle = new Map();
  for (const tweet of [sourceTweet, ...ensureArray(quoteTweets)]) {
    const handle = canonicalizeHandle(tweet?.author || "");
    if (!handle) {
      continue;
    }
    let person = byHandle.get(handle);
    if (!person) {
      person = {
        handle,
        displayName: normalizeDisplayName(tweet?.authorName || ""),
        avatarUrl: normalizeAvatarUrl(tweet?.authorAvatarUrl || ""),
        profileUrl: `https://x.com/${encodeURIComponent(handle)}`,
        verified: Boolean(tweet?.authorVerified),
        followers: normalizeMetric(tweet?.authorFollowers),
        sourceTypes: []
      };
      byHandle.set(handle, person);
      people.push(person);
    }
    const sourceType = tweet?.id === sourceTweet?.id ? "source_author" : "quote_author";
    if (!person.sourceTypes.includes(sourceType)) {
      person.sourceTypes.push(sourceType);
    }
  }
  return people;
}

function scoreTopTakeComment(comment) {
  const metrics = comment?.metrics || {};
  return (
    normalizeMetric(metrics.likes) * 3
    + normalizeMetric(metrics.replies) * 2
    + normalizeMetric(metrics.retweets)
    + normalizeMetric(metrics.quotes)
    + normalizeMetric(metrics.bookmarks)
  );
}

function selectTopCommentsForTweet(tweet, conversationTweets, options = {}) {
  const tweetId = normalizeTweetId(tweet?.id || "");
  if (!tweetId) {
    return [];
  }
  const commentCount = Math.max(0, Math.min(10, Number(options?.topCommentsPerQuote ?? DEFAULT_OPTIONS.topCommentsPerQuote)));
  if (commentCount === 0) {
    return [];
  }

  return ensureArray(conversationTweets)
    .filter((entry) => normalizeTweetId(entry?.repliedToId || "") === tweetId)
    .filter((entry) => normalizeTweetId(entry?.id || "") !== tweetId)
    .sort((left, right) => {
      const scoreDelta = scoreTopTakeComment(right) - scoreTopTakeComment(left);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      const leftTime = left?.createdAt ? Date.parse(left.createdAt) : NaN;
      const rightTime = right?.createdAt ? Date.parse(right.createdAt) : NaN;
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
        return rightTime - leftTime;
      }
      return String(left?.id || "").localeCompare(String(right?.id || ""), "en");
    })
    .slice(0, commentCount)
    .map((entry) => ({
      id: entry.id,
      author: entry.author,
      authorName: entry.authorName,
      text: entry.text,
      url: entry.url,
      createdAt: entry.createdAt,
      metrics: entry.metrics,
      authorFollowers: entry.authorFollowers,
      authorVerified: entry.authorVerified,
      authorDescription: entry.authorDescription
    }));
}

function hasThreadContinuationHint(tweet) {
  const text = String(tweet?.text || "");
  return /\b(thread|continued|continuing|more below|follow-?up|adding context|couple thoughts|few thoughts)\b|(?:^|\s)\d+\/\d*|🧵|👇/i.test(text);
}

function scoreConversationContextPriority(tweet) {
  const metrics = tweet?.metrics || {};
  return (
    (hasThreadContinuationHint(tweet) ? 100 : 0)
    + scoreTopTakeLength(tweet) * 20
    + scoreTopTakeReferences(tweet) * 10
    + Math.min(10, normalizeMetric(metrics.replies))
    + Math.min(5, normalizeMetric(metrics.likes) / 20)
  );
}

function selectQuotesForConversationContext(quoteTweets, options = {}) {
  const limit = Math.max(0, Math.min(100, Number(options?.maxContextConversationFetches ?? DEFAULT_OPTIONS.maxContextConversationFetches)));
  if (limit === 0) {
    return [];
  }

  return ensureArray(quoteTweets)
    .filter((tweet) => tweet?.id)
    .map((tweet, index) => ({
      tweet,
      index,
      priority: scoreConversationContextPriority(tweet)
    }))
    .sort((left, right) => {
      const priorityDelta = right.priority - left.priority;
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return left.index - right.index;
    })
    .slice(0, limit)
    .map((entry) => entry.tweet);
}

function selectThreadContinuationsForTweet(tweet, conversationTweets, options = {}) {
  const tweetId = normalizeTweetId(tweet?.id || "");
  const author = canonicalizeHandle(tweet?.author || "");
  if (!tweetId || !author) {
    return [];
  }
  const limit = Math.max(0, Math.min(10, Number(options?.threadContinuationsPerQuote ?? DEFAULT_OPTIONS.threadContinuationsPerQuote)));
  if (limit === 0) {
    return [];
  }

  const childrenByParentId = new Map();
  for (const entry of ensureArray(conversationTweets)) {
    const parentId = normalizeTweetId(entry?.repliedToId || "");
    if (!parentId) {
      continue;
    }
    const children = childrenByParentId.get(parentId) || [];
    children.push(entry);
    childrenByParentId.set(parentId, children);
  }
  for (const children of childrenByParentId.values()) {
    children.sort((left, right) => {
      const leftTime = left?.createdAt ? Date.parse(left.createdAt) : NaN;
      const rightTime = right?.createdAt ? Date.parse(right.createdAt) : NaN;
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
        return leftTime - rightTime;
      }
      return String(left?.id || "").localeCompare(String(right?.id || ""), "en");
    });
  }

  const continuations = [];
  const visited = new Set([tweetId]);
  const queue = [tweetId];
  while (queue.length > 0 && continuations.length < limit) {
    const parentId = queue.shift();
    const children = childrenByParentId.get(parentId) || [];
    for (const child of children) {
      const childId = normalizeTweetId(child?.id || "");
      if (!childId || visited.has(childId)) {
        continue;
      }
      visited.add(childId);
      if (canonicalizeHandle(child?.author || "") !== author) {
        continue;
      }
      continuations.push({
        id: child.id,
        author: child.author,
        authorName: child.authorName,
        text: child.text,
        url: child.url,
        createdAt: child.createdAt,
        metrics: child.metrics,
        authorFollowers: child.authorFollowers,
        authorVerified: child.authorVerified,
        authorDescription: child.authorDescription
      });
      queue.push(childId);
      if (continuations.length >= limit) {
        break;
      }
    }
  }

  return continuations;
}

async function attachTopCommentsToQuoteTweets(quoteTweets, deps, options = {}) {
  const tweets = ensureArray(quoteTweets).filter(Boolean);
  const onProgress = typeof options?.onProgress === "function" ? options.onProgress : null;
  const commentCount = Math.max(0, Math.min(10, Number(options?.topCommentsPerQuote ?? DEFAULT_OPTIONS.topCommentsPerQuote)));
  const continuationCount = Math.max(0, Math.min(10, Number(options?.threadContinuationsPerQuote ?? DEFAULT_OPTIONS.threadContinuationsPerQuote)));
  if (tweets.length === 0 || (commentCount === 0 && continuationCount === 0)) {
    return tweets.map((tweet) => ({ ...tweet, threadContinuations: [], topComments: [] }));
  }

  const contextTweets = selectQuotesForConversationContext(tweets, options);
  const contextTweetIds = new Set(contextTweets.map((tweet) => normalizeTweetId(tweet?.id || "")).filter(Boolean));
  const conversationIds = [...new Set(
    contextTweets.map((tweet) => normalizeTweetId(tweet?.conversationId || tweet?.id || "")).filter(Boolean)
  )];
  if (conversationIds.length === 0) {
    return tweets.map((tweet) => ({ ...tweet, threadContinuations: [], topComments: [] }));
  }
  let conversationPayloads = [];
  try {
    conversationPayloads = await fetchConversations(conversationIds, deps);
  } catch (error) {
    if (Number(error?.status || 0) !== 429 && !String(error?.message || "").includes("tweet_fetch_failed_429")) {
      throw error;
    }
    if (onProgress) {
      onProgress({
        phase: "top_comments_rate_limited",
        candidateQuoteCount: tweets.length,
        contextConversationCount: conversationIds.length
      });
    }
    return tweets.map((tweet) => ({ ...tweet, threadContinuations: [], topComments: [] }));
  }
  const conversationTweets = conversationPayloads
    .map((payload) => normalizeQuoteTweet(payload))
    .filter(Boolean);
  const byConversationId = new Map();
  for (const comment of conversationTweets) {
    const conversationId = normalizeTweetId(comment?.conversationId || "");
    if (!conversationId) {
      continue;
    }
    const entries = byConversationId.get(conversationId) || [];
    entries.push(comment);
    byConversationId.set(conversationId, entries);
  }

  return tweets.map((tweet) => {
    const conversationId = normalizeTweetId(tweet?.conversationId || tweet?.id || "");
    const shouldAttachContext = contextTweetIds.has(normalizeTweetId(tweet?.id || ""));
    const conversationEntries = shouldAttachContext ? byConversationId.get(conversationId) || [] : [];
    return {
      ...tweet,
      threadContinuations: selectThreadContinuationsForTweet(tweet, conversationEntries, { threadContinuationsPerQuote: continuationCount }),
      topComments: selectTopCommentsForTweet(tweet, conversationEntries, { topCommentsPerQuote: commentCount })
    };
  });
}

function buildTopTakesCandidateBatch(sourceTweet, quoteTweets, batchIndex, batchSize) {
  return {
    batchIndex,
    sourceTweet,
    quoteTweets: quoteTweets.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize).map((tweet) => ({
      id: tweet.id,
      author: tweet.author,
      authorName: tweet.authorName,
      text: tweet.text,
      urls: tweet.referenceUrls,
      metrics: tweet.metrics,
      threadContinuations: ensureArray(tweet.threadContinuations).map((continuation) => ({
        id: continuation.id,
        author: continuation.author,
        authorName: continuation.authorName,
        text: continuation.text,
        metrics: continuation.metrics,
        createdAt: continuation.createdAt,
        authorFollowers: continuation.authorFollowers,
        authorVerified: continuation.authorVerified,
        authorDescription: continuation.authorDescription
      })),
      topComments: ensureArray(tweet.topComments).map((comment) => ({
        id: comment.id,
        author: comment.author,
        authorName: comment.authorName,
        text: comment.text,
        metrics: comment.metrics,
        createdAt: comment.createdAt,
        authorFollowers: comment.authorFollowers,
        authorVerified: comment.authorVerified,
        authorDescription: comment.authorDescription
      })),
      createdAt: tweet.createdAt,
      authorFollowers: tweet.authorFollowers,
      authorVerified: tweet.authorVerified,
      authorDescription: tweet.authorDescription
    }))
  };
}

function isLowInformationAffectiveReaction(tweet) {
  const normalizedText = normalizeTextForDedupe(tweet?.text || "");
  if (!normalizedText) {
    return true;
  }
  const words = normalizedText.split(/\s+/).filter(Boolean);
  if (words.length > 45) {
    return false;
  }

  const hasReference = ensureArray(tweet?.referenceUrls).length > 0;
  const hasNumbers = /\d/.test(String(tweet?.text || ""));
  const hasReasoningMarker = /\b(because|since|therefore|due to|the reason|for example|for instance|evidence|data|benchmark|paper|study|source|architecture|bottleneck|constraint|mechanism|deployment|production|reliable|scale)\b/i.test(String(tweet?.text || ""));
  const hasAffectiveReaction = /\b(revulsion|revolted|disgust|disgusted|horrified|terrified|scared|creepy|disturbing|uncomfortable|vibes|yikes|wow|wild|insane|amazing|excited)\b/i.test(String(tweet?.text || ""));

  return hasAffectiveReaction && !hasReference && !hasNumbers && !hasReasoningMarker;
}

function topTakesContentMultiplier(tweet) {
  return isLowInformationAffectiveReaction(tweet) ? 0.55 : 1;
}

function scoreTopTakeLength(tweet) {
  const words = normalizeTextForDedupe(tweet?.text || "").split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  if (wordCount <= 3) {
    return 0;
  }
  if (wordCount <= 8) {
    return 0.2;
  }
  if (wordCount <= 15) {
    return 0.45;
  }
  if (wordCount <= 30) {
    return 0.75;
  }
  return 1;
}

function scoreTopTakeReferences(tweet) {
  const references = ensureArray(tweet?.referenceUrls).filter(Boolean);
  if (references.length === 0) {
    return 0;
  }
  return references.length === 1 ? 0.75 : 1;
}

function scoreTopTakeReasoningDensity(tweet) {
  const rawText = String(tweet?.text || "");
  const words = normalizeTextForDedupe(rawText).split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return 0;
  }

  const reasoningMarkers = [
    /\bbecause\b/i,
    /\bsince\b/i,
    /\bdue to\b/i,
    /\btherefore\b/i,
    /\bso that\b/i,
    /\bif\b/i,
    /\bthen\b/i,
    /\bunless\b/i,
    /\bcaus/i,
    /\bmechanism\b/i,
    /\bconstraint\b/i,
    /\bbottleneck\b/i,
    /\btrade-?off\b/i,
    /\bfailure mode\b/i,
    /\bassumption\b/i,
    /\bevidence\b/i,
    /\bdata\b/i,
    /\bbenchmark\b/i,
    /\bmeasured\b/i,
    /\bcompared\b/i,
    /\bproduction\b/i,
    /\bdeployment\b/i,
    /\boperational\b/i,
    /\bscale\b/i
  ];
  const markerCount = reasoningMarkers.reduce((count, pattern) => count + (pattern.test(rawText) ? 1 : 0), 0);
  const structuralBonus = /[;:]/.test(rawText) || /\bbut\b|\bhowever\b|\bwhereas\b|\bexcept\b/i.test(rawText) ? 0.15 : 0;
  const wordBudget = Math.min(0.35, words.length / 120);
  return clampScore((markerCount * 0.14) + structuralBonus + wordBudget);
}

function scoreTopTakeGrounding(tweet) {
  const rawText = String(tweet?.text || "");
  const references = ensureArray(tweet?.referenceUrls).filter(Boolean);
  const hasNumber = /\d/.test(rawText);
  const hasEvidenceLanguage = /\b(source|paper|study|repo|dataset|benchmark|chart|filing|demo|logs?|incident|postmortem|measurement|measured|according to|cites?|shows?|data)\b/i.test(rawText);
  const hasConcreteEntity = /\b[A-Z][A-Za-z0-9&.-]{2,}\b/.test(rawText.replace(/^RT\s+/i, ""));
  const commentGrounding = ensureArray(tweet?.topComments).some((comment) => /\b(source|data|paper|correction|actually|benchmark|repo|logs?)\b/i.test(String(comment?.text || "")));
  const continuationGrounding = ensureArray(tweet?.threadContinuations).some((continuation) => /\b(source|data|paper|benchmark|because|constraint|mechanism|actually|repo|logs?)\b/i.test(String(continuation?.text || "")));

  return clampScore(
    (references.length > 0 ? 0.45 : 0)
    + (references.length > 1 ? 0.15 : 0)
    + (hasNumber ? 0.18 : 0)
    + (hasEvidenceLanguage ? 0.18 : 0)
    + (hasConcreteEntity ? 0.08 : 0)
    + (commentGrounding ? 0.08 : 0)
    + (continuationGrounding ? 0.10 : 0)
  );
}

function scoreTopTakePerspectiveUniqueness(tweet, quoteTweets = []) {
  const targetWords = new Set(normalizeTextForDedupe(tweet?.text || "").split(/\s+/).filter((word) => word.length > 2));
  if (targetWords.size === 0) {
    return 0;
  }

  let maxSimilarity = 0;
  for (const candidate of ensureArray(quoteTweets)) {
    if (!candidate || normalizeTweetId(candidate?.id || "") === normalizeTweetId(tweet?.id || "")) {
      continue;
    }
    const candidateWords = new Set(normalizeTextForDedupe(candidate?.text || "").split(/\s+/).filter((word) => word.length > 2));
    if (candidateWords.size === 0) {
      continue;
    }
    const intersection = [...targetWords].filter((word) => candidateWords.has(word)).length;
    const union = new Set([...targetWords, ...candidateWords]).size;
    const similarity = union > 0 ? intersection / union : 0;
    maxSimilarity = Math.max(maxSimilarity, similarity);
  }

  return clampScore(1 - maxSimilarity);
}

function normalizeTopTakesClassification(rawEntry, quoteById) {
  const tweetId = normalizeTweetId(rawEntry?.tweetId || rawEntry?.id || "");
  const tweet = quoteById.get(tweetId);
  if (!tweet) {
    return null;
  }
  const scorecard = {
    substance: clampScore(rawEntry?.scorecard?.substance ?? rawEntry?.substance),
    novelty: clampScore(rawEntry?.scorecard?.novelty ?? rawEntry?.novelty),
    credibility: clampScore(rawEntry?.scorecard?.credibility ?? rawEntry?.credibility)
  };
  const requestedRole = String(rawEntry?.role || "").trim();
  const role = TOP_TAKES_ROLES.includes(requestedRole) ? requestedRole : "other";
  const requestedDomainGroup = String(rawEntry?.domainGroup || rawEntry?.authorDomainGroup || "").trim();
  const domainGroup = TOP_TAKES_DOMAIN_GROUPS.includes(requestedDomainGroup) ? requestedDomainGroup : "adjacent";
  const authorDomainRelevance = clampScore(rawEntry?.authorDomainRelevance);
  const authorExpertiseSignal = clampScore(rawEntry?.authorExpertiseSignal);
  const inferredAuthorScore = Math.max(authorDomainRelevance, authorExpertiseSignal);
  const domainExpertScore = clampScore(rawEntry?.domainExpertScore ?? rawEntry?.domain_expert_score ?? (domainGroup === "expert" ? inferredAuthorScore : 0));
  const adjacentExpertScore = clampScore(rawEntry?.adjacentExpertScore ?? rawEntry?.adjacent_expert_score ?? (domainGroup === "adjacent" ? inferredAuthorScore : 0));
  const authorScore = Math.max(domainExpertScore, adjacentExpertScore);
  const lengthScore = scoreTopTakeLength(tweet);
  const referenceScore = scoreTopTakeReferences(tweet);
  const reasoningDensityScore = scoreTopTakeReasoningDensity(tweet);
  const groundingScore = scoreTopTakeGrounding(tweet);
  const perspectiveUniquenessScore = scoreTopTakePerspectiveUniqueness(tweet, [...quoteById.values()]);
  const noveltyScore = scorecard.novelty;
  const isDomainFluentTechnicalTake = Boolean(rawEntry?.isDomainFluentTechnicalTake);
  const confidence = clampScore(rawEntry?.confidence);
  const domainBoostRoles = new Set(["technical_explanation", "methodological_criticism", "operational_caveat", "evidence"]);
  const domainBoost = domainBoostRoles.has(role)
    ? (authorDomainRelevance * 0.12 + authorExpertiseSignal * 0.12 + (isDomainFluentTechnicalTake ? 0.08 : 0))
    : 0;
  const groupBoost = domainGroup === "expert" ? 0.04 : 0;
  const baseScore = (
    scorecard.substance * 0.42
    + scorecard.novelty * 0.32
    + scorecard.credibility * 0.26
    + confidence * 0.08
    + domainBoost
    + groupBoost
  );
  const contentMultiplier = topTakesContentMultiplier(tweet);
  const combinedScore = baseScore * contentMultiplier;
  const takeScore = (
    authorScore * 0.32
    + lengthScore * 0.14
    + referenceScore * 0.10
    + reasoningDensityScore * 0.16
    + groundingScore * 0.13
    + perspectiveUniquenessScore * 0.15
  ) * contentMultiplier;

  return {
    tweetId,
    role,
    roleLabel: TOP_TAKES_ROLE_LABELS[role] || TOP_TAKES_ROLE_LABELS.other,
    domainGroup,
    domainGroupLabel: TOP_TAKES_DOMAIN_GROUP_LABELS[domainGroup],
    authorDomainRelevance,
    authorExpertiseSignal,
    expertiseEvidence: normalizeDisplayName(rawEntry?.expertiseEvidence || ""),
    isDomainFluentTechnicalTake,
    scorecard,
    domainExpertScore,
    adjacentExpertScore,
    authorScore,
    lengthScore,
    referenceScore,
    reasoningDensityScore,
    groundingScore,
    perspectiveUniquenessScore,
    noveltyScore,
    takeScore,
    domain_expert_score: domainExpertScore,
    adjacent_expert_score: adjacentExpertScore,
    author_score: authorScore,
    length_score: lengthScore,
    reference_score: referenceScore,
    reasoning_density_score: reasoningDensityScore,
    grounding_score: groundingScore,
    perspective_uniqueness_score: perspectiveUniquenessScore,
    novelty_score: noveltyScore,
    take_score: takeScore,
    confidence,
    contentMultiplier,
    explanation: normalizeDisplayName(rawEntry?.explanation || rawEntry?.why_it_matters || ""),
    combinedScore,
    raw: tweet
  };
}

function scoreTopTakeSelection(entry, selectedTakes) {
  const selected = ensureArray(selectedTakes);
  const selectedRoleCount = selected.filter((take) => take?.role === entry?.role).length;
  const selectedDomainCount = selected.filter((take) => take?.domainGroup === entry?.domainGroup).length;
  const roleCoverageBonus = selectedRoleCount === 0 ? 0.08 : Math.max(-0.12, selectedRoleCount * -0.04);
  const domainCoverageBonus = selectedDomainCount === 0 ? 0.03 : 0;
  return Number(entry?.takeScore ?? entry?.combinedScore ?? 0) + roleCoverageBonus + domainCoverageBonus;
}

function groupTopTakes(classifications, options = {}) {
  const representativeLimit = Math.max(1, Math.min(40, Number(options?.representativeTakeCount || options?.maxRepresentativeTakes || 20)));
  const minTakeScore = Math.max(0, Math.min(1, Number(options?.minTakeScore ?? 0.55)));
  const representativeTakes = [];

  const entries = ensureArray(classifications)
    .filter((entry) => {
      const score = Number(entry?.takeScore ?? entry?.combinedScore ?? 0);
      return entry?.tweetId && Number.isFinite(score) && score >= minTakeScore;
    })
    .sort((left, right) => Number(right?.takeScore ?? right?.combinedScore ?? 0) - Number(left?.takeScore ?? left?.combinedScore ?? 0));

  const selectedAuthors = new Set();
  const remaining = [...entries];
  while (remaining.length > 0 && representativeTakes.length < representativeLimit) {
    remaining.sort((left, right) => {
      const selectionDelta = scoreTopTakeSelection(right, representativeTakes) - scoreTopTakeSelection(left, representativeTakes);
      if (selectionDelta !== 0) {
        return selectionDelta;
      }
      return Number(right?.takeScore ?? right?.combinedScore ?? 0) - Number(left?.takeScore ?? left?.combinedScore ?? 0);
    });
    const entry = remaining.shift();
    if (representativeTakes.length >= representativeLimit) {
      break;
    }
    const author = canonicalizeHandle(entry?.raw?.author || "");
    if (author && selectedAuthors.has(author)) {
      continue;
    }
    if (representativeTakes.some((candidate) => areNearDuplicateTexts(candidate.raw?.text || "", entry.raw?.text || ""))) {
      continue;
    }
    representativeTakes.push({
      ...entry,
      selectedBecause: entry.explanation || `${entry.domainGroupLabel} perspective with high substance, novelty, and credibility.`
    });
    if (author) {
      selectedAuthors.add(author);
    }
  }

  return {
    groupedRoles: [{
      role: "ranked",
      group: "ranked",
      label: "Top Takes",
      takeCount: entries.length,
      takes: representativeTakes
    }],
    representativeTakes
  };
}

async function readQuoteTweetsForSource(sourceTweetId, { storage, client }, options = {}) {
  const normalizedTweetId = normalizeTweetId(sourceTweetId);
  if (!normalizedTweetId) {
    return [];
  }
  const onProgress = typeof options?.onProgress === "function" ? options.onProgress : null;

  const maxQuoteTweets = Math.max(1, Math.min(500, Number(options?.maxQuoteTweets || DEFAULT_OPTIONS.maxQuoteTweets)));
  const cache = typeof storage?.readQuoteTweetCache === "function" ? await storage.readQuoteTweetCache() : {};
  const cachedEntry = cache[normalizedTweetId];
  if (
    cachedEntry
    && Array.isArray(cachedEntry.payloads)
    && Number(cachedEntry.maxQuoteTweets || 0) >= maxQuoteTweets
  ) {
    if (onProgress) {
      onProgress({
        phase: "quote_tweets_cache_hit",
        sourceTweetId: normalizedTweetId,
        quoteCount: cachedEntry.payloads.length,
        cachedAt: String(cachedEntry.fetchedAt || "")
      });
    }
    return cachedEntry.payloads.slice(0, maxQuoteTweets);
  }

  if (onProgress) {
    onProgress({
      phase: "quote_tweets_cache_miss",
      sourceTweetId: normalizedTweetId,
      requestedQuoteCount: maxQuoteTweets
    });
  }
  const payloads = await client.fetchQuoteTweetsFromNetwork(normalizedTweetId, options);
  if (typeof storage?.writeQuoteTweetCache === "function") {
    await storage.writeQuoteTweetCache({
      ...cache,
      [normalizedTweetId]: {
        fetchedAt: new Date().toISOString(),
        maxQuoteTweets,
        payloads
      }
    });
    if (onProgress) {
      onProgress({
        phase: "quote_tweets_cache_write",
        sourceTweetId: normalizedTweetId,
        quoteCount: payloads.length
      });
    }
  }
  await cacheTweets(payloads, storage);
  return payloads;
}

function buildAnalysisCacheKey(sourceTweet, quoteTweets, model = "") {
  const quoteIds = ensureArray(quoteTweets).map((tweet) => normalizeTweetId(tweet?.id || "")).filter(Boolean).sort();
  return [
    normalizeTweetId(sourceTweet?.id || ""),
    `v${TOP_TAKES_CACHE_VERSION}`,
    String(model || "default").trim(),
    quoteIds.join(",")
  ].join(":");
}

function summarizeOpenAiBatchTimings(timings) {
  const cleanTimings = ensureArray(timings)
    .map((entry) => ({
      batchIndex: Number(entry?.batchIndex || 0),
      quoteCount: Number(entry?.quoteCount || 0),
      durationMs: Number(entry?.durationMs || 0),
      completedAt: String(entry?.completedAt || "")
    }))
    .filter((entry) => Number.isFinite(entry.durationMs) && entry.durationMs > 0);
  const totalDurationMs = cleanTimings.reduce((sum, entry) => sum + entry.durationMs, 0);
  const totalQuoteCount = cleanTimings.reduce((sum, entry) => sum + Math.max(0, entry.quoteCount), 0);
  const averageBatchDurationMs = cleanTimings.length > 0 ? totalDurationMs / cleanTimings.length : 0;
  const averageMsPerQuote = totalQuoteCount > 0 ? totalDurationMs / totalQuoteCount : 0;
  return {
    batchCount: cleanTimings.length,
    totalDurationMs,
    averageBatchDurationMs,
    averageMsPerQuote,
    batches: cleanTimings
  };
}

function estimateOpenAiRemainingMs(batch, remainingBatches, timingSummary = {}) {
  const averageMsPerQuote = Number(timingSummary?.averageMsPerQuote || 0);
  if (Number.isFinite(averageMsPerQuote) && averageMsPerQuote > 0) {
    const remainingQuoteCount = ensureArray(remainingBatches)
      .reduce((sum, entry) => sum + ensureArray(entry?.quoteTweets).length, ensureArray(batch?.quoteTweets).length);
    return Math.round(remainingQuoteCount * averageMsPerQuote);
  }

  const averageBatchDurationMs = Number(timingSummary?.averageBatchDurationMs || 0);
  if (Number.isFinite(averageBatchDurationMs) && averageBatchDurationMs > 0) {
    return Math.round((ensureArray(remainingBatches).length + 1) * averageBatchDurationMs);
  }

  return 0;
}

async function resolveTopTakes(tweetId, deps, options = {}) {
  const onProgress = typeof deps?.onProgress === "function" ? deps.onProgress : null;
  const normalizedTweetId = normalizeTweetId(tweetId);
  if (!normalizedTweetId) {
    throw new Error("missing_tweet_id");
  }
  if (typeof deps?.analyzeTopTakesBatch !== "function") {
    throw new Error("missing_top_takes_analyzer");
  }

  const artifactCache = typeof deps?.storage?.readTopTakesArtifactCache === "function"
    ? await deps.storage.readTopTakesArtifactCache()
    : {};
  const cachedArtifact = artifactCache[normalizedTweetId]?.version === TOP_TAKES_CACHE_VERSION
    ? artifactCache[normalizedTweetId]?.artifact
    : null;
  if (cachedArtifact && typeof cachedArtifact === "object") {
    if (onProgress) {
      onProgress({
        phase: "top_takes_cache_hit",
        sourceTweetId: normalizedTweetId,
        cachedAt: String(artifactCache[normalizedTweetId]?.cachedAt || "")
      });
      onProgress({
        phase: "top_takes_ready",
        ...(cachedArtifact.stats && typeof cachedArtifact.stats === "object" ? cachedArtifact.stats : {})
      });
    }
    return cachedArtifact;
  }

  if (onProgress) {
    onProgress({ phase: "collecting_quote_tweets", sourceTweetId: normalizedTweetId });
  }
  const sourcePayload = await fetchTweet(normalizedTweetId, {
    ...deps,
    cacheProgress: true
  });
  const sourceTweet = normalizeQuoteTweet(sourcePayload);
  const quotePayloads = await readQuoteTweetsForSource(normalizedTweetId, deps, {
    ...options,
    onProgress
  });

  if (onProgress) {
    onProgress({ phase: "normalizing_discourse", quoteCount: quotePayloads.length });
  }
  const normalizedQuotes = quotePayloads.map((payload) => normalizeQuoteTweet(payload)).filter(Boolean);
  const dedupedQuotes = dedupeQuoteTweets(normalizedQuotes);
  if (onProgress) {
    onProgress({
      phase: "collecting_top_comments",
      candidateQuoteCount: dedupedQuotes.length,
      contextConversationLimit: Math.max(0, Math.min(100, Number(options?.maxContextConversationFetches ?? DEFAULT_OPTIONS.maxContextConversationFetches))),
      threadContinuationsPerQuote: Math.max(0, Math.min(10, Number(options?.threadContinuationsPerQuote ?? DEFAULT_OPTIONS.threadContinuationsPerQuote))),
      topCommentsPerQuote: Math.max(0, Math.min(10, Number(options?.topCommentsPerQuote ?? DEFAULT_OPTIONS.topCommentsPerQuote)))
    });
  }
  const candidateQuotes = await attachTopCommentsToQuoteTweets(dedupedQuotes, deps, {
    ...options,
    onProgress
  });
  const batchSize = Math.max(10, Math.min(50, Number(options?.quoteBatchSize || DEFAULT_OPTIONS.quoteBatchSize)));
  const batches = [];
  for (let batchIndex = 0; batchIndex * batchSize < candidateQuotes.length; batchIndex += 1) {
    batches.push(buildTopTakesCandidateBatch(sourceTweet, candidateQuotes, batchIndex, batchSize));
  }

  const analysisCache = typeof deps?.storage?.readTopTakesAnalysisCache === "function"
    ? await deps.storage.readTopTakesAnalysisCache()
    : {};
  const modelHint = String(options?.model || "").trim();
  const cacheKey = buildAnalysisCacheKey(sourceTweet, candidateQuotes, modelHint);
  let classifications = [];
  let modelMetadata = analysisCache[cacheKey]?.modelMetadata || {};
  let openAiTiming = analysisCache[cacheKey]?.openAiTiming || {};
  let sourceDomain = String(analysisCache[cacheKey]?.sourceDomain || "").trim();
  let sourceDomainConfidence = clampScore(analysisCache[cacheKey]?.sourceDomainConfidence);
  if (Array.isArray(analysisCache[cacheKey]?.classifications)) {
    classifications = analysisCache[cacheKey].classifications.map((entry) => ({
      ...entry,
      raw: candidateQuotes.find((tweet) => tweet.id === entry.tweetId) || entry.raw
    }));
    if (onProgress && openAiTiming?.batchCount) {
      onProgress({
        phase: "openai_timing_cache_hit",
        batchCount: Number(openAiTiming.batchCount || 0),
        averageBatchDurationMs: Number(openAiTiming.averageBatchDurationMs || 0),
        averageMsPerQuote: Number(openAiTiming.averageMsPerQuote || 0)
      });
    }
  } else {
    const batchTimings = [];
    for (const batch of batches) {
      const remainingBatches = batches.slice(batch.batchIndex + 1);
      const estimatedRemainingMs = estimateOpenAiRemainingMs(batch, remainingBatches, openAiTiming);
      if (onProgress) {
        onProgress({
          phase: "sending_batches_to_openai",
          batchIndex: batch.batchIndex + 1,
          batchCount: batches.length,
          quoteCount: batch.quoteTweets.length,
          estimatedRemainingMs
        });
      }
      const startedAt = Date.now();
      const result = await deps.analyzeTopTakesBatch(batch, options);
      const durationMs = Date.now() - startedAt;
      batchTimings.push({
        batchIndex: batch.batchIndex + 1,
        quoteCount: batch.quoteTweets.length,
        durationMs,
        completedAt: new Date().toISOString()
      });
      openAiTiming = summarizeOpenAiBatchTimings(batchTimings);
      if (onProgress) {
        onProgress({
          phase: "openai_batch_complete",
          batchIndex: batch.batchIndex + 1,
          batchCount: batches.length,
          quoteCount: batch.quoteTweets.length,
          durationMs,
          averageBatchDurationMs: openAiTiming.averageBatchDurationMs,
          averageMsPerQuote: openAiTiming.averageMsPerQuote
        });
      }
      if (!sourceDomain && result?.sourceDomain) {
        sourceDomain = normalizeDisplayName(result.sourceDomain);
      }
      sourceDomainConfidence = Math.max(sourceDomainConfidence, clampScore(result?.sourceDomainConfidence));
      modelMetadata = {
        provider: String(result?.provider || modelMetadata.provider || ""),
        model: String(result?.model || modelMetadata.model || modelHint || ""),
        analyzedAt: new Date().toISOString()
      };
      const quoteById = new Map(candidateQuotes.map((tweet) => [tweet.id, tweet]));
      const entries = ensureArray(result?.classifications)
        .map((entry) => normalizeTopTakesClassification(entry, quoteById))
        .filter(Boolean);
      classifications.push(...entries);
    }
    if (typeof deps?.storage?.writeTopTakesAnalysisCache === "function") {
      await deps.storage.writeTopTakesAnalysisCache({
        ...analysisCache,
        [cacheKey]: {
          cachedAt: new Date().toISOString(),
          modelMetadata,
          openAiTiming,
          sourceDomain,
          sourceDomainConfidence,
          classifications: classifications.map((entry) => ({
            tweetId: entry.tweetId,
            role: entry.role,
            roleLabel: entry.roleLabel,
            domainGroup: entry.domainGroup,
            domainGroupLabel: entry.domainGroupLabel,
            authorDomainRelevance: entry.authorDomainRelevance,
            authorExpertiseSignal: entry.authorExpertiseSignal,
            expertiseEvidence: entry.expertiseEvidence,
            isDomainFluentTechnicalTake: entry.isDomainFluentTechnicalTake,
            scorecard: entry.scorecard,
            confidence: entry.confidence,
            contentMultiplier: entry.contentMultiplier,
            domainExpertScore: entry.domainExpertScore,
            adjacentExpertScore: entry.adjacentExpertScore,
            authorScore: entry.authorScore,
            lengthScore: entry.lengthScore,
            referenceScore: entry.referenceScore,
            reasoningDensityScore: entry.reasoningDensityScore,
            groundingScore: entry.groundingScore,
            perspectiveUniquenessScore: entry.perspectiveUniquenessScore,
            noveltyScore: entry.noveltyScore,
            takeScore: entry.takeScore,
            domain_expert_score: entry.domain_expert_score,
            adjacent_expert_score: entry.adjacent_expert_score,
            author_score: entry.author_score,
            length_score: entry.length_score,
            reference_score: entry.reference_score,
            reasoning_density_score: entry.reasoning_density_score,
            grounding_score: entry.grounding_score,
            perspective_uniqueness_score: entry.perspective_uniqueness_score,
            novelty_score: entry.novelty_score,
            take_score: entry.take_score,
            explanation: entry.explanation,
            combinedScore: entry.combinedScore
          }))
        }
      });
    }
  }

  if (onProgress) {
    onProgress({ phase: "analyzing_epistemic_roles", classifiedCount: classifications.length });
  }
  const grouped = groupTopTakes(classifications, options);

  if (onProgress) {
    onProgress({ phase: "grouping_perspectives", roleCount: grouped.groupedRoles.length });
    onProgress({ phase: "selecting_representative_takes", takeCount: grouped.representativeTakes.length });
    onProgress({ phase: "rendering_top_takes", takeCount: grouped.representativeTakes.length });
  }

  const artifact = {
    sourceTweet,
    sourceDomain,
    sourceDomainConfidence,
    takes: classifications,
    groupedRoles: grouped.groupedRoles,
    representativeTakes: grouped.representativeTakes,
    people: buildTopTakesPeople(sourceTweet, candidateQuotes),
    stats: {
      retrievedQuoteCount: quotePayloads.length,
      normalizedQuoteCount: normalizedQuotes.length,
      candidateQuoteCount: candidateQuotes.length,
      classifiedQuoteCount: classifications.length,
      roleCount: grouped.groupedRoles.length,
      representativeTakeCount: grouped.representativeTakes.length
    },
    modelMetadata,
    openAiTiming,
    cacheKey
  };

  if (onProgress) {
    onProgress({ phase: "top_takes_ready", ...artifact.stats });
  }

  if (typeof deps?.storage?.writeTopTakesArtifactCache === "function") {
    await deps.storage.writeTopTakesArtifactCache({
      ...artifactCache,
      [normalizedTweetId]: {
        version: TOP_TAKES_CACHE_VERSION,
        cachedAt: new Date().toISOString(),
        artifact
      }
    });
  }

  return artifact;
}

function extractReferenceUrls(payload) {
  const urls = Array.isArray(payload?.entities?.urls) ? payload.entities.urls : [];
  return urls
    .map((entry) => String(entry?.expanded_url || entry?.url || "").trim())
    .filter(Boolean);
}

function extractMentionHandles(payload) {
  return extractMentionPeople(payload).map((entry) => entry.handle);
}

function extractMentionPeople(payload) {
  const mentions = Array.isArray(payload?.entities?.user_mentions) ? payload.entities.user_mentions : [];
  return mentions
    .map((entry) => {
      const handle = canonicalizeHandle(entry?.screen_name);
      if (!handle) {
        return null;
      }

      return {
        handle,
        displayName: normalizeDisplayName(entry?.name || ""),
        avatarUrl: normalizeAvatarUrl(entry?.profile_image_url_https || entry?.profile_image_url || "")
      };
    })
    .filter(Boolean);
}

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

function buildReferenceArtifact(path, replyChains = []) {
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

  for (const chain of Array.isArray(replyChains) ? replyChains : []) {
    for (const tweet of Array.isArray(chain?.tweets) ? chain.tweets : []) {
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

        if (!reference.citedByTweetIds.includes(tweet.id)) {
          reference.citedByTweetIds.push(tweet.id);
        }
      }
    }
  }

  return {
    path: enrichedPath,
    references
  };
}

function buildPeopleArtifact(path) {
  const people = [];
  const personByHandle = new Map();
  const enrichedPath = [];

  for (const tweet of Array.isArray(path) ? path : []) {
    const peopleHandles = [];
    const rawPeople = [
      {
        handle: tweet?.author,
        displayName: normalizeDisplayName(tweet?.authorName || ""),
        avatarUrl: normalizeAvatarUrl(tweet?.authorAvatarUrl || ""),
        sourceType: "author"
      },
      ...(Array.isArray(tweet?.mentionPeople) ? tweet.mentionPeople.map((entry) => ({
        handle: entry?.handle,
        displayName: normalizeDisplayName(entry?.displayName || ""),
        avatarUrl: normalizeAvatarUrl(entry?.avatarUrl || ""),
        sourceType: "mention"
      })) : [])
    ];

    for (const rawPerson of rawPeople) {
      const handle = canonicalizeHandle(rawPerson?.handle);
      if (!handle) {
        continue;
      }

      let person = personByHandle.get(handle);
      if (!person) {
        person = {
          handle,
          displayName: normalizeDisplayName(rawPerson?.displayName || ""),
          avatarUrl: normalizeAvatarUrl(rawPerson?.avatarUrl || ""),
          profileUrl: `https://x.com/${encodeURIComponent(handle)}`,
          citedByTweetIds: [],
          sourceTypes: []
        };
        people.push(person);
        personByHandle.set(handle, person);
      }
      if (!person.displayName && rawPerson?.displayName) {
        person.displayName = normalizeDisplayName(rawPerson.displayName);
      }
      if (!person.avatarUrl && rawPerson?.avatarUrl) {
        person.avatarUrl = normalizeAvatarUrl(rawPerson.avatarUrl);
      }

      if (!peopleHandles.includes(handle)) {
        peopleHandles.push(handle);
      }
      if (!person.citedByTweetIds.includes(tweet.id)) {
        person.citedByTweetIds.push(tweet.id);
      }

      const sourceType = rawPerson?.sourceType === "author" ? "author" : "mention";
      if (!person.sourceTypes.includes(sourceType)) {
        person.sourceTypes.push(sourceType);
      }
    }

    enrichedPath.push({
      ...tweet,
      peopleHandles
    });
  }

  return {
    path: enrichedPath,
    people
  };
}

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

async function fetchTweet(tweetId, { storage, client, onProgress, cacheProgress }) {
  const normalizedTweetId = normalizeTweetId(tweetId);
  if (!normalizedTweetId) {
    throw new Error("missing_tweet_id");
  }

  const cache = await storage.readCache();
  if (cache[normalizedTweetId]) {
    if (cacheProgress && typeof onProgress === "function") {
      onProgress({
        phase: "tweet_cache_hit",
        tweetId: normalizedTweetId
      });
    }
    return cache[normalizedTweetId];
  }
  if (cacheProgress && typeof onProgress === "function") {
    onProgress({
      phase: "tweet_cache_miss",
      tweetId: normalizedTweetId
    });
  }

  if (inFlightTweetFetchById.has(normalizedTweetId)) {
    return inFlightTweetFetchById.get(normalizedTweetId);
  }

  const pending = (async () => {
    const payload = await client.fetchTweetFromNetwork(normalizedTweetId);
    await storage.writeCache({
      ...cache,
      [normalizedTweetId]: payload
    });
    if (cacheProgress && typeof onProgress === "function") {
      onProgress({
        phase: "tweet_cache_write",
        tweetId: normalizedTweetId
      });
    }
    return payload;
  })();
  inFlightTweetFetchById.set(normalizedTweetId, pending);

  try {
    return await pending;
  } finally {
    inFlightTweetFetchById.delete(normalizedTweetId);
  }
}

async function cacheTweets(payloads, storage) {
  const normalizedPayloads = ensureArray(payloads).filter((payload) => payload?.id_str);
  if (normalizedPayloads.length === 0) {
    return;
  }

  const cache = await storage.readCache();
  let changed = false;
  for (const payload of normalizedPayloads) {
    const id = normalizeTweetId(payload.id_str);
    if (!id) {
      continue;
    }
    if (cache[id]) {
      continue;
    }
    cache[id] = payload;
    changed = true;
  }
  if (changed) {
    await storage.writeCache(cache);
  }
}

async function fetchTweets(tweetIds, { storage, client }) {
  const ids = ensureArray(tweetIds).map((entry) => normalizeTweetId(entry)).filter(Boolean);
  if (ids.length === 0) {
    return [];
  }

  const cache = await storage.readCache();
  const cachedPayloads = [];
  const missingIds = [];
  for (const id of ids) {
    if (cache[id]) {
      cachedPayloads.push(cache[id]);
      continue;
    }
    missingIds.push(id);
  }

  if (missingIds.length === 0) {
    return cachedPayloads;
  }

  const fetchedPayloads = await client.fetchTweetsFromNetwork(missingIds);
  if (fetchedPayloads.length > 0) {
    const nextCache = { ...cache };
    for (const payload of fetchedPayloads) {
      if (payload?.id_str) {
        nextCache[payload.id_str] = payload;
      }
    }
    await storage.writeCache(nextCache);
  }

  return ids.map((id) => cache[id] || fetchedPayloads.find((payload) => payload?.id_str === id)).filter(Boolean);
}

async function fetchConversation(conversationId, { storage, client }) {
  const normalizedConversationId = normalizeTweetId(conversationId);
  if (!normalizedConversationId) {
    return [];
  }

  const conversationCache = await storage.readConversationCache();
  const conversationEntry = conversationCache[normalizedConversationId];
  if (conversationEntry?.complete && Array.isArray(conversationEntry.tweetIds) && conversationEntry.tweetIds.length > 0) {
    const cachedTweets = await fetchTweets(conversationEntry.tweetIds, { storage, client });
    if (cachedTweets.length === conversationEntry.tweetIds.length) {
      return cachedTweets;
    }
  }

  if (inFlightConversationFetchById.has(normalizedConversationId)) {
    return inFlightConversationFetchById.get(normalizedConversationId);
  }

  const pending = (async () => {
    const fetchedPayloads = await client.fetchConversationFromNetwork(normalizedConversationId);
    await cacheTweets(fetchedPayloads, storage);

    conversationCache[normalizedConversationId] = {
      complete: true,
      tweetIds: fetchedPayloads.map((payload) => normalizeTweetId(payload?.id_str)).filter(Boolean)
    };
    await storage.writeConversationCache(conversationCache);

    return fetchedPayloads;
  })();
  inFlightConversationFetchById.set(normalizedConversationId, pending);

  try {
    return await pending;
  } finally {
    inFlightConversationFetchById.delete(normalizedConversationId);
  }
}

async function fetchConversations(conversationIds, deps) {
  const uniqueConversationIds = [...new Set(
    ensureArray(conversationIds).map((entry) => normalizeTweetId(entry)).filter(Boolean)
  )];
  if (uniqueConversationIds.length === 0) {
    return [];
  }

  const payloadById = new Map();
  for (const conversationId of uniqueConversationIds) {
    const payloads = await fetchConversation(conversationId, deps);
    for (const payload of ensureArray(payloads)) {
      const tweetId = normalizeTweetId(payload?.id_str);
      if (!tweetId || payloadById.has(tweetId)) {
        continue;
      }
      payloadById.set(tweetId, payload);
    }
  }

  return [...payloadById.values()];
}

function sortTweetsForConversation(tweets) {
  return [...tweets].sort((left, right) => {
    const leftTime = left?.createdAt ? Date.parse(left.createdAt) : NaN;
    const rightTime = right?.createdAt ? Date.parse(right.createdAt) : NaN;
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return String(left?.id || "").localeCompare(String(right?.id || ""), "en");
  });
}

function buildLocalReplyChains(anchorTweet, conversationTweets, options = {}) {
  const anchorTweetId = normalizeTweetId(anchorTweet?.id || "");
  const explicitParticipantHandles = ensureArray(options?.participantHandles)
    .map((handle) => canonicalizeHandle(handle))
    .filter(Boolean);
  const fallbackParticipantHandle = canonicalizeHandle(options?.participantHandle || anchorTweet?.author || "");
  const requiredParticipantHandles = new Set(
    explicitParticipantHandles.length > 0 ? explicitParticipantHandles : [fallbackParticipantHandle].filter(Boolean)
  );
  if (!anchorTweetId) {
    return [];
  }

  const normalizedTweets = sortTweetsForConversation(
    ensureArray(conversationTweets).filter((tweet) => tweet?.id && tweet?.author)
  );
  if (normalizedTweets.length === 0) {
    return [];
  }

  const tweetById = new Map(normalizedTweets.map((tweet) => [tweet.id, tweet]));
  const childrenByParentId = new Map();

  for (const tweet of normalizedTweets) {
    const parentId = normalizeTweetId(tweet?.repliedToId || "");
    if (!parentId || !tweetById.has(parentId)) {
      continue;
    }

    const childIds = childrenByParentId.get(parentId) || [];
    childIds.push(tweet.id);
    childrenByParentId.set(parentId, childIds);
  }

  const directReplyIds = normalizedTweets
    .filter((tweet) => normalizeTweetId(tweet?.repliedToId || "") === anchorTweetId)
    .map((tweet) => tweet.id);

  const chains = [];
  for (const replyId of directReplyIds) {
    const descendantIds = new Set([replyId]);
    const queue = [replyId];

    while (queue.length > 0) {
      const currentId = queue.shift();
      for (const childId of childrenByParentId.get(currentId) || []) {
        if (descendantIds.has(childId)) {
          continue;
        }
        descendantIds.add(childId);
        queue.push(childId);
      }
    }

    const orderedSubtreeTweets = normalizedTweets.filter((tweet) => descendantIds.has(tweet.id));
    const lastRequiredParticipantIndex = requiredParticipantHandles.size > 0
      ? orderedSubtreeTweets.reduce((lastIndex, tweet, index) => (
        requiredParticipantHandles.has(canonicalizeHandle(tweet.author)) ? index : lastIndex
      ), -1)
      : -1;
    if (lastRequiredParticipantIndex < 0) {
      continue;
    }

    const trimmedTweets = orderedSubtreeTweets.slice(0, lastRequiredParticipantIndex + 1);
    const chainId = trimmedTweets.map((entry) => entry.id).join("__");
    if (chains.some((chain) => chain.id === chainId)) {
      continue;
    }

    chains.push({
      id: chainId,
      anchorTweetId,
      anchorAuthor: canonicalizeHandle(anchorTweet?.author || ""),
      participantHandles: [...new Set(trimmedTweets.map((entry) => entry.author).filter(Boolean))],
      tweets: trimmedTweets.map((entry) => ({
        id: entry.id,
        author: entry.author,
        authorName: entry.authorName,
        text: entry.text,
        url: entry.url,
        createdAt: entry.createdAt,
        repliedToId: entry.repliedToId || "",
        referenceUrls: Array.isArray(entry.referenceUrls) ? [...entry.referenceUrls] : []
      }))
    });
  }

  return chains;
}

async function collectReplyChainsForAnchorTweet(anchorTweet, deps, options = {}) {
  const anchorConversationId = normalizeTweetId(anchorTweet?.conversationId || "");
  if (!anchorConversationId) {
    return [];
  }

  const conversationPayloads = await fetchConversation(anchorConversationId, deps);
  const normalizedConversationTweets = conversationPayloads
    .map((payload) => normalizeTweet(payload))
    .filter(Boolean);

  return buildLocalReplyChains(anchorTweet, normalizedConversationTweets, options);
}

async function collectReplyChainsForAnchorTweets(anchorTweets, deps, options = {}) {
  const uniqueAnchorTweets = [];
  const seenAnchorIds = new Set();
  for (const anchorTweet of ensureArray(anchorTweets)) {
    const anchorTweetId = normalizeTweetId(anchorTweet?.id || "");
    if (!anchorTweetId || seenAnchorIds.has(anchorTweetId)) {
      continue;
    }
    seenAnchorIds.add(anchorTweetId);
    uniqueAnchorTweets.push(anchorTweet);
  }

  const chains = [];
  const seenChainIds = new Set();
  for (const anchorTweet of uniqueAnchorTweets) {
    const anchorChains = await collectReplyChainsForAnchorTweet(anchorTweet, deps, options);
    for (const chain of anchorChains) {
      const chainKey = `${normalizeTweetId(chain?.anchorTweetId || "")}:${String(chain?.id || "")}`;
      if (!chain?.id || seenChainIds.has(chainKey)) {
        continue;
      }
      seenChainIds.add(chainKey);
      chains.push(chain);
    }
  }

  return chains;
}

async function resolveRootPath(tweetId, deps) {
  const path = [];
  const normalizedPath = [];
  const seen = new Set();
  let currentId = normalizeTweetId(tweetId);
  let exploredTweet = null;
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
    if (!exploredTweet) {
      exploredTweet = tweet;
    }
    normalizedPath.push(tweet);
    const { parentId, relationType } = resolveParentId(tweet);
    path.push({
      id: tweet.id,
      author: tweet.author,
      authorName: tweet.authorName,
      authorAvatarUrl: tweet.authorAvatarUrl,
      createdAt: tweet.createdAt,
      text: tweet.text,
      url: tweet.url,
      referenceUrls: tweet.referenceUrls,
      mentionHandles: tweet.mentionHandles,
      mentionPeople: tweet.mentionPeople,
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

  const rootToExploredPath = path.reverse();
  const peopleArtifact = buildPeopleArtifact(rootToExploredPath);

  const rootToExploredNormalizedPath = normalizedPath.reverse();
  const branchParticipantHandles = [...new Set(
    rootToExploredNormalizedPath.map((tweet) => canonicalizeHandle(tweet?.author || "")).filter(Boolean)
  )];
  let replyChains = [];
  if (rootToExploredNormalizedPath.length > 0) {
    if (onProgress) {
      onProgress({
        phase: "collecting_local_reply_chains",
        conversationId: normalizeTweetId(exploredTweet?.conversationId || ""),
        conversationIds: [...new Set(
          rootToExploredNormalizedPath.map((tweet) => normalizeTweetId(tweet?.conversationId || "")).filter(Boolean)
        )]
      });
    }
    try {
      replyChains = await collectReplyChainsForAnchorTweets(rootToExploredNormalizedPath, deps, {
        participantHandles: branchParticipantHandles
      });
    } catch {
      replyChains = [];
    }
  }

  const referenceArtifact = buildReferenceArtifact(peopleArtifact.path, replyChains);

  const artifact = {
    ...referenceArtifact,
    people: peopleArtifact.people,
    replyChains
  };

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
  CONVERSATION_CACHE_KEY,
  QUOTE_TWEET_CACHE_KEY,
  TOP_TAKES_ANALYSIS_CACHE_KEY,
  TOP_TAKES_ARTIFACT_CACHE_KEY,
  TOP_TAKES_CACHE_VERSION,
  DEFAULT_API_BASE_URL,
  DEFAULT_TWEET_FIELDS,
  DEFAULT_USER_FIELDS,
  DEFAULT_EXPANSIONS,
  TOP_TAKES_ROLES,
  TOP_TAKES_ROLE_LABELS,
  TOP_TAKES_DOMAIN_GROUPS,
  TOP_TAKES_DOMAIN_GROUP_LABELS,
  inFlightTweetFetchById,
  inFlightConversationFetchById,
  buildTweetUrl,
  normalizeTweetId,
  canonicalizeHandle,
  normalizeDisplayName,
  normalizeAvatarUrl,
  normalizeTimestamp,
  buildApiUrl,
  buildBaseApiParams,
  pickReferencedTweetId,
  convertApiTweetToPayload,
  createStorageAdapter,
  createTweetClient,
  normalizeTweet,
  normalizeQuoteTweet,
  normalizeTextForDedupe,
  isSpamLikeQuote,
  areNearDuplicateTexts,
  dedupeQuoteTweets,
  isLowInformationAffectiveReaction,
  topTakesContentMultiplier,
  scoreTopTakeComment,
  hasThreadContinuationHint,
  scoreConversationContextPriority,
  selectQuotesForConversationContext,
  selectThreadContinuationsForTweet,
  scoreTopTakeReasoningDensity,
  scoreTopTakeGrounding,
  scoreTopTakePerspectiveUniqueness,
  scoreTopTakeSelection,
  selectTopCommentsForTweet,
  attachTopCommentsToQuoteTweets,
  buildTopTakesCandidateBatch,
  normalizeTopTakesClassification,
  groupTopTakes,
  buildTopTakesPeople,
  readQuoteTweetsForSource,
  buildAnalysisCacheKey,
  summarizeOpenAiBatchTimings,
  estimateOpenAiRemainingMs,
  extractReferenceUrls,
  extractMentionHandles,
  extractMentionPeople,
  canonicalizeReferenceUrl,
  buildReferenceArtifact,
  buildPeopleArtifact,
  buildLocalReplyChains,
  collectReplyChainsForAnchorTweet,
  collectReplyChainsForAnchorTweets,
  resolveParentId,
  fetchTweet,
  fetchTweets,
  fetchConversation,
  resolveRootPath,
  resolveTopTakes
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
} else {
  globalThis.AriadexAlgo = api;
}
