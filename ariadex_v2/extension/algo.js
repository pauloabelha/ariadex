"use strict";

const TWEET_CACHE_KEY = "ariadex_v2_tweet_cache";
const CONVERSATION_CACHE_KEY = "ariadex_v2_conversation_cache";
const DEFAULT_API_BASE_URL = "https://api.x.com/2";
const DEFAULT_TWEET_FIELDS = [
  "author_id",
  "conversation_id",
  "created_at",
  "entities",
  "in_reply_to_user_id",
  "referenced_tweets",
  "text"
];
const DEFAULT_USER_FIELDS = [
  "id",
  "name",
  "profile_image_url",
  "username"
];
const DEFAULT_EXPANSIONS = [
  "author_id"
];
const DEFAULT_OPTIONS = {
  apiBaseUrl: DEFAULT_API_BASE_URL,
  maxPagesPerCollection: 5,
  maxResultsPerPage: 100
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

  return {
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

    async clearCache() {
      return new Promise((resolve, reject) => {
        chromeApi.storage.local.remove([TWEET_CACHE_KEY, CONVERSATION_CACHE_KEY], () => {
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

  return {
    request,
    fetchTweetFromNetwork,
    fetchTweetsFromNetwork,
    fetchConversationFromNetwork
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
        repliedToId: entry.repliedToId || ""
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

  const referenceArtifact = buildReferenceArtifact(path.reverse());
  const peopleArtifact = buildPeopleArtifact(referenceArtifact.path);

  const rootToExploredNormalizedPath = normalizedPath.reverse();
  const branchParticipantHandles = [...new Set(
    rootToExploredNormalizedPath.map((tweet) => canonicalizeHandle(tweet?.author || "")).filter(Boolean)
  )];
  let replyChains = [];
  if (rootToExploredNormalizedPath.length > 0) {
    if (onProgress) {
      onProgress({
        phase: "collecting_local_reply_chains",
        conversationId: normalizeTweetId(exploredTweet?.conversationId || rootTweet?.conversationId || ""),
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

  const artifact = {
    ...referenceArtifact,
    ...peopleArtifact,
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
  DEFAULT_API_BASE_URL,
  DEFAULT_TWEET_FIELDS,
  DEFAULT_USER_FIELDS,
  DEFAULT_EXPANSIONS,
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
  resolveRootPath
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
} else {
  globalThis.AriadeXV2Algo = api;
}
