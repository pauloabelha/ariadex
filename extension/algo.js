"use strict";

const TWEET_CACHE_KEY = "ariadex_tweet_cache";
const CONVERSATION_CACHE_KEY = "ariadex_conversation_cache";
const QUOTE_TWEET_CACHE_KEY = "ariadex_quote_tweet_cache";
const TOP_TAKES_ANALYSIS_CACHE_KEY = "ariadex_top_takes_analysis_cache";
const TOP_TAKES_ARTIFACT_CACHE_KEY = "ariadex_top_takes_artifact_cache";
const TOP_TAKES_CACHE_VERSION = 5;
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
  topCommentsPerQuote: 3
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
    const response = await effectiveFetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${bearerToken}`
      }
    });

    if (!response.ok) {
      const error = new Error(`tweet_fetch_failed_${response.status}`);
      error.status = response.status;
      error.path = path;
      throw error;
    }

    return response.json();
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
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 2) {
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

async function attachTopCommentsToQuoteTweets(quoteTweets, deps, options = {}) {
  const tweets = ensureArray(quoteTweets).filter(Boolean);
  const commentCount = Math.max(0, Math.min(10, Number(options?.topCommentsPerQuote ?? DEFAULT_OPTIONS.topCommentsPerQuote)));
  if (tweets.length === 0 || commentCount === 0) {
    return tweets.map((tweet) => ({ ...tweet, topComments: [] }));
  }

  const conversationIds = [...new Set(
    tweets.map((tweet) => normalizeTweetId(tweet?.conversationId || tweet?.id || "")).filter(Boolean)
  )];
  const conversationPayloads = await fetchConversations(conversationIds, deps);
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
    return {
      ...tweet,
      topComments: selectTopCommentsForTweet(tweet, byConversationId.get(conversationId) || [], { topCommentsPerQuote: commentCount })
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
    confidence,
    contentMultiplier,
    explanation: normalizeDisplayName(rawEntry?.explanation || rawEntry?.why_it_matters || ""),
    combinedScore,
    raw: tweet
  };
}

function groupTopTakes(classifications, options = {}) {
  const representativesPerGroup = Math.max(1, Math.min(8, Number(options?.representativesPerGroup || options?.representativesPerRole || DEFAULT_OPTIONS.representativesPerRole)));
  const groupedRoles = [];
  const representativeTakes = [];
  const byGroup = new Map();

  for (const classification of ensureArray(classifications)) {
    if (!classification?.tweetId) {
      continue;
    }
    const group = TOP_TAKES_DOMAIN_GROUPS.includes(classification.domainGroup) ? classification.domainGroup : "adjacent";
    const entries = byGroup.get(group) || [];
    entries.push(classification);
    byGroup.set(group, entries);
  }

  for (const group of TOP_TAKES_DOMAIN_GROUPS) {
    const entries = (byGroup.get(group) || [])
      .filter((entry) => entry.combinedScore > 0)
      .sort((left, right) => right.combinedScore - left.combinedScore);
    if (entries.length === 0) {
      continue;
    }

    const selected = [];
    const selectedRoles = new Set();
    for (const entry of entries) {
      if (selected.length >= representativesPerGroup) {
        break;
      }
      if (selectedRoles.has(entry.role)) {
        continue;
      }
      if (selected.some((candidate) => areNearDuplicateTexts(candidate.raw?.text || "", entry.raw?.text || ""))) {
        continue;
      }
      selected.push(entry);
      selectedRoles.add(entry.role);
    }
    for (const entry of entries) {
      if (selected.length >= representativesPerGroup) {
        break;
      }
      if (selected.includes(entry)) {
        continue;
      }
      if (selected.some((candidate) => areNearDuplicateTexts(candidate.raw?.text || "", entry.raw?.text || ""))) {
        continue;
      }
      selected.push(entry);
    }

    groupedRoles.push({
      role: group,
      group,
      label: TOP_TAKES_DOMAIN_GROUP_LABELS[group],
      takeCount: entries.length,
      takes: selected
    });
    representativeTakes.push(...selected.map((entry) => ({
      ...entry,
      selectedBecause: entry.explanation || `${entry.domainGroupLabel} perspective with high substance, novelty, and credibility.`
    })));
  }

  return {
    groupedRoles,
    representativeTakes
  };
}

async function readQuoteTweetsForSource(sourceTweetId, { storage, client }, options = {}) {
  const normalizedTweetId = normalizeTweetId(sourceTweetId);
  if (!normalizedTweetId) {
    return [];
  }

  const maxQuoteTweets = Math.max(1, Math.min(500, Number(options?.maxQuoteTweets || DEFAULT_OPTIONS.maxQuoteTweets)));
  const cache = typeof storage?.readQuoteTweetCache === "function" ? await storage.readQuoteTweetCache() : {};
  const cachedEntry = cache[normalizedTweetId];
  if (
    cachedEntry
    && Array.isArray(cachedEntry.payloads)
    && Number(cachedEntry.maxQuoteTweets || 0) >= maxQuoteTweets
  ) {
    return cachedEntry.payloads.slice(0, maxQuoteTweets);
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
  const sourcePayload = await fetchTweet(normalizedTweetId, deps);
  const sourceTweet = normalizeQuoteTweet(sourcePayload);
  const quotePayloads = await readQuoteTweetsForSource(normalizedTweetId, deps, options);

  if (onProgress) {
    onProgress({ phase: "normalizing_discourse", quoteCount: quotePayloads.length });
  }
  const normalizedQuotes = quotePayloads.map((payload) => normalizeQuoteTweet(payload)).filter(Boolean);
  const dedupedQuotes = dedupeQuoteTweets(normalizedQuotes);
  if (onProgress) {
    onProgress({ phase: "collecting_top_comments", candidateQuoteCount: dedupedQuotes.length, topCommentsPerQuote: Math.max(0, Math.min(10, Number(options?.topCommentsPerQuote ?? DEFAULT_OPTIONS.topCommentsPerQuote))) });
  }
  const candidateQuotes = await attachTopCommentsToQuoteTweets(dedupedQuotes, deps, options);
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
  let sourceDomain = String(analysisCache[cacheKey]?.sourceDomain || "").trim();
  let sourceDomainConfidence = clampScore(analysisCache[cacheKey]?.sourceDomainConfidence);
  if (Array.isArray(analysisCache[cacheKey]?.classifications)) {
    classifications = analysisCache[cacheKey].classifications.map((entry) => ({
      ...entry,
      raw: candidateQuotes.find((tweet) => tweet.id === entry.tweetId) || entry.raw
    }));
  } else {
    for (const batch of batches) {
      if (onProgress) {
        onProgress({
          phase: "sending_batches_to_openai",
          batchIndex: batch.batchIndex + 1,
          batchCount: batches.length,
          quoteCount: batch.quoteTweets.length
        });
      }
      const result = await deps.analyzeTopTakesBatch(batch, options);
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

async function fetchTweet(tweetId, { storage, client }) {
  const normalizedTweetId = normalizeTweetId(tweetId);
  if (!normalizedTweetId) {
    throw new Error("missing_tweet_id");
  }

  const cache = await storage.readCache();
  if (cache[normalizedTweetId]) {
    return cache[normalizedTweetId];
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
  selectTopCommentsForTweet,
  attachTopCommentsToQuoteTweets,
  buildTopTakesCandidateBatch,
  normalizeTopTakesClassification,
  groupTopTakes,
  buildTopTakesPeople,
  readQuoteTweetsForSource,
  buildAnalysisCacheKey,
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
