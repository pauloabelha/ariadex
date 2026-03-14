(() => {
  "use strict";

  const globalScope = typeof globalThis !== "undefined" ? globalThis : {};

  const DEFAULT_API_BASE_URL = "https://api.x.com/2";
  const DEFAULT_OPTIONS = {
    apiBaseUrl: DEFAULT_API_BASE_URL,
    maxPagesPerCollection: 5,
    maxResultsPerPage: 100,
    maxConversationRoots: 8,
    maxConcurrentRootExpansions: 4,
    maxConcurrentRequests: 6,
    maxConnectedTweets: 1500,
    maxNetworkDiscoveryAuthors: 40,
    maxNetworkDiscoveryRoots: 6,
    maxNetworkDiscoveryQueries: 12,
    networkDiscoveryBatchSize: 6,
    includeQuoteTweets: false,
    includeRetweets: false,
    includeQuoteReplies: false,
    requestTimeoutMs: 30000
  };

  const DEFAULT_TWEET_FIELDS = [
    "author_id",
    "conversation_id",
    "created_at",
    "in_reply_to_user_id",
    "public_metrics",
    "referenced_tweets",
    "text"
  ];

  const DEFAULT_USER_FIELDS = [
    "id",
    "name",
    "username",
    "profile_image_url",
    "description",
    "verified",
    "verified_type",
    "public_metrics"
  ];

  const DEFAULT_EXPANSIONS = [
    "author_id"
  ];
  const GLOBAL_RATE_LIMIT_UNTIL_MS_BY_BUCKET = new Map();

  function ensureArray(value) {
    if (Array.isArray(value)) {
      return value;
    }
    if (value == null) {
      return [];
    }
    return [value];
  }

  function normalizeOptions(options = {}) {
    const merged = {
      ...DEFAULT_OPTIONS,
      ...options
    };

    merged.maxPagesPerCollection = Math.max(1, Math.floor(merged.maxPagesPerCollection));
    merged.maxResultsPerPage = Math.max(10, Math.min(100, Math.floor(merged.maxResultsPerPage)));
    merged.maxConversationRoots = Math.max(1, Math.floor(merged.maxConversationRoots));
    merged.maxConcurrentRootExpansions = Math.max(1, Math.min(10, Math.floor(merged.maxConcurrentRootExpansions)));
    merged.maxConcurrentRequests = Math.max(1, Math.min(10, Math.floor(merged.maxConcurrentRequests)));
    merged.maxConnectedTweets = Math.max(10, Math.floor(merged.maxConnectedTweets));
    merged.maxNetworkDiscoveryAuthors = Math.max(1, Math.min(200, Math.floor(merged.maxNetworkDiscoveryAuthors)));
    merged.maxNetworkDiscoveryRoots = Math.max(1, Math.min(20, Math.floor(merged.maxNetworkDiscoveryRoots)));
    merged.maxNetworkDiscoveryQueries = Math.max(1, Math.min(50, Math.floor(merged.maxNetworkDiscoveryQueries)));
    merged.networkDiscoveryBatchSize = Math.max(1, Math.min(10, Math.floor(merged.networkDiscoveryBatchSize)));
    merged.requestTimeoutMs = Math.max(1000, Math.floor(merged.requestTimeoutMs));

    return merged;
  }

  function createConcurrencyLimiter(maxConcurrent) {
    const limit = Math.max(1, Math.floor(Number(maxConcurrent) || 1));
    const queue = [];
    let activeCount = 0;

    const tryRunNext = () => {
      while (activeCount < limit && queue.length > 0) {
        const job = queue.shift();
        activeCount += 1;

        Promise.resolve()
          .then(job.task)
          .then(
            (value) => {
              activeCount -= 1;
              job.resolve(value);
              tryRunNext();
            },
            (error) => {
              activeCount -= 1;
              job.reject(error);
              tryRunNext();
            }
          );
      }
    };

    return function schedule(task) {
      return new Promise((resolve, reject) => {
        queue.push({ task, resolve, reject });
        tryRunNext();
      });
    };
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

  function buildApiUrl(apiBaseUrl, path, params) {
    const normalizedBase = String(apiBaseUrl || DEFAULT_API_BASE_URL).replace(/\/$/, "");
    const normalizedPath = String(path || "").startsWith("/") ? path : `/${path}`;
    const url = new URL(`${normalizedBase}${normalizedPath}`);
    const query = buildQuery(params);
    query.forEach((value, key) => {
      url.searchParams.set(key, value);
    });
    return url;
  }

  function endpointRateLimitBucket(path) {
    const normalized = String(path || "");
    if (normalized.includes("/quote_tweets")) {
      return "quote_tweets";
    }
    if (normalized.includes("/retweeted_by")) {
      return "retweeted_by";
    }
    if (normalized.includes("/tweets/search/recent")) {
      return "search_recent";
    }
    return null;
  }

  function parseHeaderNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function setGlobalRateLimitCooldown(bucket, response) {
    if (!bucket || !response || !response.headers) {
      return;
    }

    const retryAfterSeconds = parseHeaderNumber(response.headers.get("retry-after"));
    const resetEpochSeconds = parseHeaderNumber(response.headers.get("x-rate-limit-reset"));

    let untilMs = null;
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
      untilMs = Date.now() + (retryAfterSeconds * 1000);
    } else if (Number.isFinite(resetEpochSeconds) && resetEpochSeconds > 0) {
      untilMs = resetEpochSeconds * 1000;
    } else {
      untilMs = Date.now() + 60_000;
    }

    GLOBAL_RATE_LIMIT_UNTIL_MS_BY_BUCKET.set(bucket, untilMs);
  }

  function buildRateLimitedError(path, bucket, untilMs) {
    const error = new Error(`X API request skipped due to active ${bucket} cooldown for ${path}`);
    error.status = 429;
    error.rateLimited = true;
    error.cooldownUntilMs = untilMs;
    return error;
  }

  function createTimeoutSignal(timeoutMs) {
    if (typeof AbortController === "undefined") {
      return { signal: undefined, cancel: () => {} };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    return {
      signal: controller.signal,
      cancel: () => clearTimeout(timeout)
    };
  }

  function pickReferencedTweet(tweet, type) {
    const refs = ensureArray(tweet?.referenced_tweets);
    const match = refs.find((ref) => ref && ref.type === type && ref.id);
    return match ? match.id : null;
  }

  function addUsersToMap(userById, users) {
    for (const user of ensureArray(users)) {
      if (!user || !user.id || userById.has(user.id)) {
        continue;
      }
      userById.set(user.id, user);
    }
  }

  function addTweetsToMap(tweetById, tweets, maxConnectedTweets) {
    for (const tweet of ensureArray(tweets)) {
      if (!tweet || !tweet.id || tweetById.has(tweet.id)) {
        continue;
      }
      if (tweetById.size >= maxConnectedTweets) {
        return false;
      }
      tweetById.set(tweet.id, tweet);
    }
    return true;
  }

  function normalizeFollowingSet(input) {
    if (!input) {
      return new Set();
    }

    if (input instanceof Set) {
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

    if (Array.isArray(input)) {
      return normalizeFollowingSet(new Set(input));
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

  function normalizeFollowingLookup(followingSet, maxAuthors) {
    const max = Math.max(1, Math.floor(Number(maxAuthors) || 1));
    const idSet = new Set();
    const usernameSet = new Set();

    for (const raw of followingSet) {
      if (idSet.size + usernameSet.size >= max * 3) {
        break;
      }
      const value = String(raw || "").trim();
      if (!value) {
        continue;
      }

      const lowered = value.toLowerCase();
      if (/^\d+$/.test(value)) {
        idSet.add(value);
        continue;
      }

      const handle = lowered.startsWith("@") ? lowered.slice(1) : lowered;
      if (/^[a-z0-9_]{1,15}$/.test(handle)) {
        usernameSet.add(handle);
      }
    }

    return {
      ids: [...idSet].slice(0, max),
      usernames: [...usernameSet].slice(0, max)
    };
  }

  function buildFollowedTopicSearchQuery({ rootId, usernames }) {
    const normalizedRootId = String(rootId || "").trim();
    const handles = ensureArray(usernames)
      .map((username) => String(username || "").trim().toLowerCase())
      .filter((username) => /^[a-z0-9_]{1,15}$/.test(username));
    if (!normalizedRootId || handles.length === 0) {
      return null;
    }

    const authorClause = handles.map((username) => `from:${username}`).join(" OR ");
    return `(conversation_id:${normalizedRootId} OR quotes:${normalizedRootId}) (${authorClause})`;
  }

  function collectQuoteRootsFromMap(tweetById, canonicalRootId, limit) {
    const out = [];
    const max = Math.max(1, Math.floor(Number(limit) || 1));
    const root = canonicalRootId ? String(canonicalRootId) : "";
    if (!root) {
      return out;
    }

    for (const tweet of tweetById.values()) {
      if (!tweet || !tweet.id) {
        continue;
      }
      if (String(tweet.id) === root) {
        continue;
      }
      const quoted = pickReferencedTweet(tweet, "quoted");
      if (quoted && String(quoted) === root) {
        out.push(String(tweet.id));
      }
      if (out.length >= max) {
        break;
      }
    }

    return out;
  }

  async function createClient({ bearerToken, fetchImpl, options }) {
    if (!bearerToken || typeof bearerToken !== "string") {
      throw new Error("Missing X API bearer token");
    }

    const effectiveFetch = typeof fetchImpl === "function"
      ? fetchImpl
      : (typeof fetch === "function" ? fetch.bind(globalScope) : null);

    if (!effectiveFetch) {
      throw new Error("No fetch implementation available");
    }

    const normalizedOptions = normalizeOptions(options);

    async function request(path, params = {}) {
      const rateLimitBucket = endpointRateLimitBucket(path);
      if (rateLimitBucket) {
        const cooldownUntilMs = GLOBAL_RATE_LIMIT_UNTIL_MS_BY_BUCKET.get(rateLimitBucket) || 0;
        if (cooldownUntilMs > Date.now()) {
          throw buildRateLimitedError(path, rateLimitBucket, cooldownUntilMs);
        }
      }

      const url = buildApiUrl(normalizedOptions.apiBaseUrl, path, params);
      const timeout = createTimeoutSignal(normalizedOptions.requestTimeoutMs);

      try {
        const response = await effectiveFetch(url.toString(), {
          method: "GET",
          headers: {
            Authorization: `Bearer ${bearerToken}`
          },
          signal: timeout.signal
        });

        if (!response.ok) {
          if (response.status === 429 && rateLimitBucket) {
            setGlobalRateLimitCooldown(rateLimitBucket, response);
          }

          const body = await response.text();
          const snippet = body ? body.slice(0, 500) : "";
          const error = new Error(`X API request failed (${response.status} ${response.statusText}) for ${url.pathname}: ${snippet}`);
          error.status = response.status;
          throw error;
        }

        return response.json();
      } finally {
        timeout.cancel();
      }
    }

    return {
      request,
      options: normalizedOptions
    };
  }

  function baseTweetParams(maxResults) {
    return {
      expansions: DEFAULT_EXPANSIONS,
      "tweet.fields": DEFAULT_TWEET_FIELDS,
      "user.fields": DEFAULT_USER_FIELDS,
      ...(typeof maxResults === "number" ? { max_results: maxResults } : {})
    };
  }

  async function fetchTweetById(client, tweetId) {
    const response = await client.request(`/tweets/${tweetId}`, baseTweetParams());
    return {
      tweet: response?.data || null,
      users: ensureArray(response?.includes?.users)
    };
  }

  async function fetchTweetsByIds(client, tweetIds) {
    const ids = ensureArray(tweetIds).filter(Boolean);
    if (ids.length === 0) {
      return {
        tweets: [],
        users: []
      };
    }

    const collectedTweets = [];
    const collectedUsers = [];

    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const response = await client.request("/tweets", {
        ...baseTweetParams(),
        ids: chunk.join(",")
      });

      collectedTweets.push(...ensureArray(response?.data));
      collectedUsers.push(...ensureArray(response?.includes?.users));
    }

    return {
      tweets: collectedTweets,
      users: collectedUsers
    };
  }

  async function fetchUsersByIds(client, userIds) {
    const ids = ensureArray(userIds).filter(Boolean);
    if (ids.length === 0) {
      return [];
    }

    const collectedUsers = [];

    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const response = await client.request("/users", {
        ids: chunk.join(","),
        "user.fields": DEFAULT_USER_FIELDS
      });

      collectedUsers.push(...ensureArray(response?.data));
    }

    return collectedUsers;
  }

  async function fetchUserByUsername(client, username) {
    const normalized = String(username || "").trim().replace(/^@+/, "");
    if (!normalized) {
      return null;
    }

    const response = await client.request(`/users/by/username/${normalized}`, {
      "user.fields": DEFAULT_USER_FIELDS
    });
    return response?.data || null;
  }

  async function fetchFollowingUserIds(client, userId, options = {}) {
    const id = String(userId || "").trim();
    if (!id) {
      return [];
    }

    const maxPages = Math.max(1, Math.min(10, Math.floor(Number(options.maxPages) || 1)));
    const maxResults = Math.max(10, Math.min(1000, Math.floor(Number(options.maxResults) || 200)));
    const maxIds = Math.max(10, Math.min(5000, Math.floor(Number(options.maxIds) || 1000)));

    const ids = [];
    let nextToken = null;

    for (let page = 0; page < maxPages; page += 1) {
      const response = await client.request(`/users/${id}/following`, {
        "user.fields": "id,username",
        max_results: Math.min(1000, maxResults),
        ...(nextToken ? { pagination_token: nextToken } : {})
      });

      for (const user of ensureArray(response?.data)) {
        if (!user || !user.id) {
          continue;
        }
        ids.push(String(user.id));
        if (ids.length >= maxIds) {
          return ids;
        }
      }

      nextToken = response?.meta?.next_token || null;
      if (!nextToken) {
        break;
      }
    }

    return ids;
  }

  async function fetchPaginated(client, path, params = {}) {
    const allData = [];
    const allUsers = [];
    let nextToken = null;

    for (let page = 0; page < client.options.maxPagesPerCollection; page += 1) {
      const response = await client.request(path, {
        ...params,
        ...(nextToken ? { pagination_token: nextToken } : {})
      });

      allData.push(...ensureArray(response?.data));
      allUsers.push(...ensureArray(response?.includes?.users));

      nextToken = response?.meta?.next_token || null;
      if (!nextToken) {
        break;
      }
    }

    return {
      tweets: allData,
      users: allUsers
    };
  }

  async function fetchRetweetedByUsers(client, tweetId) {
    const users = [];
    let nextToken = null;

    for (let page = 0; page < client.options.maxPagesPerCollection; page += 1) {
      const response = await client.request(`/tweets/${tweetId}/retweeted_by`, {
        "user.fields": DEFAULT_USER_FIELDS,
        max_results: client.options.maxResultsPerPage,
        ...(nextToken ? { pagination_token: nextToken } : {})
      });

      users.push(...ensureArray(response?.data));
      nextToken = response?.meta?.next_token || null;
      if (!nextToken) {
        break;
      }
    }

    return users;
  }

  async function resolveCanonicalRootTweetId({ clickedTweetId, rootHintTweetId = null, client }) {
    if (!clickedTweetId && !rootHintTweetId) {
      return null;
    }

    let clickedTweet = null;
    if (clickedTweetId) {
      const clickedLookup = await fetchTweetById(client, clickedTweetId);
      clickedTweet = clickedLookup.tweet;

      const quotedFromClicked = pickReferencedTweet(clickedTweet, "quoted");
      if (quotedFromClicked) {
        return quotedFromClicked;
      }
    }

    const startId = rootHintTweetId || clickedTweetId;
    if (!startId) {
      return null;
    }

    const firstTweet = clickedTweet && clickedTweet.id === startId
      ? clickedTweet
      : (await fetchTweetById(client, startId)).tweet;

    if (!firstTweet) {
      return startId;
    }

    const quotedTweetId = pickReferencedTweet(firstTweet, "quoted");
    if (quotedTweetId) {
      return quotedTweetId;
    }

    const visited = new Set();
    let currentTweet = firstTweet;

    while (currentTweet?.id && !visited.has(currentTweet.id)) {
      visited.add(currentTweet.id);

      const repliedToId = pickReferencedTweet(currentTweet, "replied_to");
      if (!repliedToId || visited.has(repliedToId)) {
        return currentTweet.id;
      }

      const parent = await fetchTweetById(client, repliedToId);
      if (!parent.tweet) {
        return repliedToId;
      }
      currentTweet = parent.tweet;
    }

    return currentTweet?.id || startId;
  }

  function collectMissingReferencedTweetIds(tweetById) {
    const missing = new Set();

    for (const tweet of tweetById.values()) {
      const refs = ensureArray(tweet?.referenced_tweets);
      for (const ref of refs) {
        if (!ref?.id || tweetById.has(ref.id)) {
          continue;
        }
        missing.add(ref.id);
      }
    }

    return [...missing];
  }

  function normalizeApiTweet(tweet, userById) {
    const authorId = tweet?.author_id || null;
    const user = authorId ? (userById.get(authorId) || null) : null;
    const username = user?.username || null;

    const metrics = tweet?.public_metrics || {};
    const id = tweet?.id || null;
    const isSynthetic = Boolean(tweet?.__synthetic);

    const replyTo = pickReferencedTweet(tweet, "replied_to");
    const quoteOf = pickReferencedTweet(tweet, "quoted");
    const repostOf = pickReferencedTweet(tweet, "retweeted");
    const referenced_tweets = [];
    if (replyTo) {
      referenced_tweets.push({ type: "replied_to", id: replyTo });
    }
    if (quoteOf) {
      referenced_tweets.push({ type: "quoted", id: quoteOf });
    }
    if (repostOf) {
      referenced_tweets.push({ type: "retweeted", id: repostOf });
    }

    return {
      id,
      author_id: authorId,
      author: username ? `@${username}` : (authorId ? `user:${authorId}` : null),
      author_profile: user ? {
        id: user.id || null,
        username: user.username || null,
        name: user.name || null,
        profile_image_url: user.profile_image_url || null,
        description: user.description || "",
        verified: Boolean(user.verified),
        verified_type: user.verified_type || null,
        public_metrics: user.public_metrics || {}
      } : null,
      text: tweet?.text || "",
      url: id && !isSynthetic
        ? (username ? `https://x.com/${username}/status/${id}` : `https://x.com/i/web/status/${id}`)
        : null,
      replies: Number.isFinite(metrics.reply_count) ? metrics.reply_count : 0,
      reposts: Number.isFinite(metrics.retweet_count) ? metrics.retweet_count : 0,
      likes: Number.isFinite(metrics.like_count) ? metrics.like_count : 0,
      quote_count: Number.isFinite(metrics.quote_count) ? metrics.quote_count : 0,
      metrics,
      referenced_tweets,
      reply_to: replyTo,
      quote_of: quoteOf,
      repost_of: repostOf,
      type: isSynthetic ? "repost_event" : undefined
    };
  }

  function buildSyntheticRepostTweets({ rootId, users }) {
    const repostTweets = [];

    for (const user of ensureArray(users)) {
      const userId = user?.id != null ? String(user.id) : null;
      if (!userId) {
        continue;
      }

      const username = user?.username ? `@${user.username}` : `user:${userId}`;
      repostTweets.push({
        id: `repost:${rootId}:${userId}`,
        author_id: userId,
        text: `${username} reposted this post`,
        public_metrics: {
          reply_count: 0,
          retweet_count: 0,
          like_count: 0,
          quote_count: 0
        },
        referenced_tweets: [{ type: "retweeted", id: rootId }],
        __synthetic: true
      });
    }

    return repostTweets;
  }

  async function collectConnectedApiTweets({ rootTweetId, client, followingSet = new Set(), onWarning, onProgress }) {
    const tweetById = new Map();
    const userById = new Map();

    const rootQueue = [rootTweetId];
    const processedRoots = new Set();
    let quoteRateLimited = false;
    let retweetRateLimited = false;
    let repliesRateLimited = false;

    if (typeof onProgress === "function") {
      onProgress({
        phase: "collection_started",
        rootTweetId
      });
    }

    while (rootQueue.length > 0 && processedRoots.size < client.options.maxConversationRoots) {
      if (tweetById.size >= client.options.maxConnectedTweets) {
        break;
      }
      if (repliesRateLimited) {
        break;
      }

      const rootId = rootQueue.shift();
      if (!rootId || processedRoots.has(rootId)) {
        continue;
      }
      processedRoots.add(rootId);

      if (typeof onProgress === "function") {
        onProgress({
          phase: "collecting_root",
          rootId,
          processedRoots: processedRoots.size,
          queuedRoots: rootQueue.length,
          tweetCount: tweetById.size
        });
      }

      const rootLookup = await fetchTweetById(client, rootId);
      addUsersToMap(userById, rootLookup.users);
      addTweetsToMap(tweetById, [rootLookup.tweet], client.options.maxConnectedTweets);

      const repliesPromise = fetchPaginated(client, "/tweets/search/recent", {
        ...baseTweetParams(client.options.maxResultsPerPage),
        query: `conversation_id:${rootId}`
      });
      const quotesPromise = (client.options.includeQuoteTweets && !quoteRateLimited)
        ? fetchPaginated(client, `/tweets/${rootId}/quote_tweets`, {
          ...baseTweetParams(client.options.maxResultsPerPage)
        })
        : Promise.resolve({ tweets: [], users: [] });

      const [repliesResult, quotesResult] = await Promise.allSettled([repliesPromise, quotesPromise]);

      if (repliesResult.status === "fulfilled") {
        const conversationReplies = repliesResult.value || { tweets: [], users: [] };
        addUsersToMap(userById, conversationReplies.users);
        addTweetsToMap(tweetById, conversationReplies.tweets, client.options.maxConnectedTweets);
        if (typeof onProgress === "function") {
          onProgress({
            phase: "replies_fetched",
            rootId,
            replies: conversationReplies.tweets.length,
            tweetCount: tweetById.size
          });
        }
      } else {
        const error = repliesResult.reason;
        if (typeof onWarning === "function") {
          onWarning(`conversation replies failed for ${rootId}: ${error?.message || String(error)}`);
        }
        if (error?.status === 429) {
          repliesRateLimited = true;
        }
      }

      let quoteTweets = { tweets: [], users: [] };
      if (quotesResult.status === "fulfilled") {
        quoteTweets = quotesResult.value || quoteTweets;
      } else {
        const error = quotesResult.reason;
        if (typeof onWarning === "function") {
          onWarning(`quote_tweets failed for ${rootId}: ${error?.message || String(error)}`);
        }
        if (error?.status === 429) {
          quoteRateLimited = true;
        }
      }

      addUsersToMap(userById, quoteTweets.users);
      addTweetsToMap(tweetById, quoteTweets.tweets, client.options.maxConnectedTweets);
      if (client.options.includeQuoteTweets && typeof onProgress === "function") {
        onProgress({
          phase: "quotes_fetched",
          rootId,
          quotes: quoteTweets.tweets.length,
          tweetCount: tweetById.size
        });
      }

      if (client.options.includeQuoteReplies) {
        for (const quoteTweet of quoteTweets.tweets) {
          const quoteId = quoteTweet?.id;
          if (!quoteId || processedRoots.has(quoteId)) {
            continue;
          }
          rootQueue.push(quoteId);
        }
        if (typeof onProgress === "function") {
          onProgress({
            phase: "quote_reply_expanded",
            rootId,
            queuedRoots: rootQueue.length
          });
        }
      }

      if (repliesRateLimited) {
        break;
      }

      if (client.options.includeRetweets && !retweetRateLimited) {
        try {
          const repostUsers = await fetchRetweetedByUsers(client, rootId);
          addUsersToMap(userById, repostUsers);

          const repostTweets = buildSyntheticRepostTweets({
            rootId,
            users: repostUsers
          });
          addTweetsToMap(tweetById, repostTweets, client.options.maxConnectedTweets);
          if (typeof onProgress === "function") {
            onProgress({
              phase: "retweets_fetched",
              rootId,
              retweeters: repostUsers.length,
              tweetCount: tweetById.size
            });
          }
        } catch (error) {
          if (typeof onWarning === "function") {
            onWarning(`retweeted_by failed for ${rootId}: ${error.message}`);
          }
          if (error?.status === 429) {
            retweetRateLimited = true;
          }
        }
      }
    }

    const missingReferencedTweetIds = collectMissingReferencedTweetIds(tweetById);
    if (missingReferencedTweetIds.length > 0) {
      try {
        const referencedLookup = await fetchTweetsByIds(client, missingReferencedTweetIds);
        addUsersToMap(userById, referencedLookup.users);
        addTweetsToMap(tweetById, referencedLookup.tweets, client.options.maxConnectedTweets);
        if (typeof onProgress === "function") {
          onProgress({
            phase: "references_hydrated",
            references: referencedLookup.tweets.length,
            tweetCount: tweetById.size
          });
        }
      } catch (error) {
        if (typeof onWarning === "function") {
          onWarning(`Referenced tweet lookup failed: ${error.message}`);
        }
      }
    }

    const missingAuthorIds = [...new Set(
      [...tweetById.values()]
        .map((tweet) => tweet?.author_id)
        .filter((authorId) => authorId && !userById.has(authorId))
    )];

    if (missingAuthorIds.length > 0) {
      try {
        const users = await fetchUsersByIds(client, missingAuthorIds);
        addUsersToMap(userById, users);
        if (typeof onProgress === "function") {
          onProgress({
            phase: "authors_hydrated",
            authors: users.length
          });
        }
      } catch (error) {
        if (typeof onWarning === "function") {
          onWarning(`Author lookup failed: ${error.message}`);
        }
      }
    }

    const normalizedFollowingSet = normalizeFollowingSet(followingSet);
    if (normalizedFollowingSet.size > 0) {
      const followedLookup = normalizeFollowingLookup(normalizedFollowingSet, client.options.maxNetworkDiscoveryAuthors);
      const usernameSet = new Set(followedLookup.usernames);

      if (followedLookup.ids.length > 0) {
        try {
          const followedUsers = await fetchUsersByIds(client, followedLookup.ids);
          for (const user of followedUsers) {
            if (!user || !user.id) {
              continue;
            }
            addUsersToMap(userById, [user]);
            const username = String(user.username || "").trim().toLowerCase();
            if (/^[a-z0-9_]{1,15}$/.test(username)) {
              usernameSet.add(username);
            }
          }
        } catch (error) {
          if (typeof onWarning === "function") {
            onWarning(`followed user lookup failed: ${error.message}`);
          }
        }
      }

      if (usernameSet.size > 0) {
        const discoveryRoots = [
          String(rootTweetId),
          ...collectQuoteRootsFromMap(tweetById, rootTweetId, client.options.maxNetworkDiscoveryRoots)
        ].slice(0, client.options.maxNetworkDiscoveryRoots);
        const usernames = [...usernameSet];
        const batchSize = Math.max(1, Math.min(10, Math.floor(client.options.networkDiscoveryBatchSize || 6)));
        let queryCount = 0;

        for (const discoveryRootId of discoveryRoots) {
          if (tweetById.size >= client.options.maxConnectedTweets) {
            break;
          }
          for (let start = 0; start < usernames.length; start += batchSize) {
            if (queryCount >= client.options.maxNetworkDiscoveryQueries) {
              break;
            }
            const batch = usernames.slice(start, start + batchSize);
            const query = buildFollowedTopicSearchQuery({
              rootId: discoveryRootId,
              usernames: batch
            });
            if (!query) {
              continue;
            }

            queryCount += 1;
            try {
              const response = await fetchPaginated(client, "/tweets/search/recent", {
                ...baseTweetParams(client.options.maxResultsPerPage),
                query
              });
              addUsersToMap(userById, response.users);
              addTweetsToMap(tweetById, response.tweets, client.options.maxConnectedTweets);

              if (typeof onProgress === "function") {
                onProgress({
                  phase: "network_discovery_batch",
                  rootId: discoveryRootId,
                  batchSize: batch.length,
                  queryCount,
                  discovered: response.tweets.length,
                  tweetCount: tweetById.size
                });
              }
            } catch (error) {
              if (typeof onWarning === "function") {
                onWarning(`network discovery failed for ${discoveryRootId}: ${error.message}`);
              }
              if (error?.status === 429) {
                break;
              }
            }
          }
          if (queryCount >= client.options.maxNetworkDiscoveryQueries) {
            break;
          }
        }
      }
    }

    const normalizedTweets = [...tweetById.values()].map((tweet) => normalizeApiTweet(tweet, userById));
    if (typeof onProgress === "function") {
      onProgress({
        phase: "collection_complete",
        tweetCount: normalizedTweets.length,
        userCount: userById.size,
        processedRoots: processedRoots.size
      });
    }

    return {
      tweets: normalizedTweets,
      users: [...userById.values()]
    };
  }

  async function collectConnectedApiTweetsIncremental({ rootTweetId, existingTweets = [], client, onWarning, onProgress }) {
    const existingById = new Map();
    for (const tweet of ensureArray(existingTweets)) {
      if (!tweet || !tweet.id) {
        continue;
      }
      existingById.set(String(tweet.id), tweet);
    }

    const userById = new Map();
    const newTweetById = new Map();
    const queue = [];
    const seenRoots = new Set();

    if (rootTweetId) {
      queue.push(String(rootTweetId));
    }
    for (const tweet of existingById.values()) {
      if (!tweet || !tweet.id) {
        continue;
      }
      if (tweet.quote_of && String(tweet.quote_of) === String(rootTweetId)) {
        queue.push(String(tweet.id));
      }
    }

    const maxIncrementalRoots = Math.max(1, Math.min(50, Math.floor(client.options.maxConversationRoots || 8)));
    const incrementalPages = Math.max(1, Math.min(2, Math.floor(client.options.maxPagesPerCollection || 1)));

    async function fetchPaginatedLimited(path, params = {}) {
      const allData = [];
      const allUsers = [];
      let nextToken = null;

      for (let page = 0; page < incrementalPages; page += 1) {
        const response = await client.request(path, {
          ...params,
          ...(nextToken ? { pagination_token: nextToken } : {})
        });
        allData.push(...ensureArray(response?.data));
        allUsers.push(...ensureArray(response?.includes?.users));
        nextToken = response?.meta?.next_token || null;
        if (!nextToken) {
          break;
        }
      }

      return {
        tweets: allData,
        users: allUsers
      };
    }

    if (typeof onProgress === "function") {
      onProgress({
        phase: "incremental_started",
        rootTweetId
      });
    }

    while (queue.length > 0 && seenRoots.size < maxIncrementalRoots) {
      const currentRoot = queue.shift();
      if (!currentRoot || seenRoots.has(currentRoot)) {
        continue;
      }
      seenRoots.add(currentRoot);

      if (typeof onProgress === "function") {
        onProgress({
          phase: "incremental_collecting_root",
          rootId: currentRoot,
          processedRoots: seenRoots.size
        });
      }

      try {
        const replies = await fetchPaginatedLimited("/tweets/search/recent", {
          ...baseTweetParams(client.options.maxResultsPerPage),
          query: `conversation_id:${currentRoot}`
        });
        addUsersToMap(userById, replies.users);
        for (const tweet of replies.tweets) {
          if (!tweet?.id || existingById.has(tweet.id) || newTweetById.has(tweet.id)) {
            continue;
          }
          newTweetById.set(tweet.id, tweet);
        }
      } catch (error) {
        if (typeof onWarning === "function") {
          onWarning(`incremental replies failed for ${currentRoot}: ${error.message}`);
        }
      }

      if (client.options.includeQuoteTweets) {
        try {
          const quotes = await fetchPaginatedLimited(`/tweets/${currentRoot}/quote_tweets`, {
            ...baseTweetParams(client.options.maxResultsPerPage)
          });
          addUsersToMap(userById, quotes.users);
          for (const tweet of quotes.tweets) {
            if (!tweet?.id || existingById.has(tweet.id) || newTweetById.has(tweet.id)) {
              continue;
            }
            newTweetById.set(tweet.id, tweet);
            if (client.options.includeQuoteReplies) {
              queue.push(String(tweet.id));
            }
          }
        } catch (error) {
          if (typeof onWarning === "function") {
            onWarning(`incremental quote_tweets failed for ${currentRoot}: ${error.message}`);
          }
        }
      }
    }

    const missingReferencedTweetIds = collectMissingReferencedTweetIds(newTweetById)
      .filter((id) => !existingById.has(id));
    if (missingReferencedTweetIds.length > 0) {
      try {
        const referencedLookup = await fetchTweetsByIds(client, missingReferencedTweetIds);
        addUsersToMap(userById, referencedLookup.users);
        for (const tweet of referencedLookup.tweets) {
          if (!tweet?.id || existingById.has(tweet.id) || newTweetById.has(tweet.id)) {
            continue;
          }
          newTweetById.set(tweet.id, tweet);
        }
      } catch (error) {
        if (typeof onWarning === "function") {
          onWarning(`incremental referenced lookup failed: ${error.message}`);
        }
      }
    }

    const missingAuthorIds = [...new Set(
      [...newTweetById.values()]
        .map((tweet) => tweet?.author_id)
        .filter((authorId) => authorId && !userById.has(authorId))
    )];
    if (missingAuthorIds.length > 0) {
      try {
        const users = await fetchUsersByIds(client, missingAuthorIds);
        addUsersToMap(userById, users);
      } catch (error) {
        if (typeof onWarning === "function") {
          onWarning(`incremental author lookup failed: ${error.message}`);
        }
      }
    }

    const normalizedTweets = [...newTweetById.values()].map((tweet) => normalizeApiTweet(tweet, userById));
    if (typeof onProgress === "function") {
      onProgress({
        phase: "incremental_complete",
        newTweetCount: normalizedTweets.length
      });
    }

    return {
      tweets: normalizedTweets,
      users: [...userById.values()]
    };
  }

  async function buildConversationDataset(options = {}) {
    const warnings = [];
    const client = await createClient({
      bearerToken: options.bearerToken,
      fetchImpl: options.fetchImpl,
      options
    });

    if (typeof options.onProgress === "function") {
      options.onProgress({
        phase: "root_resolution_started",
        clickedTweetId: options.clickedTweetId || null,
        rootHintTweetId: options.rootHintTweetId || null
      });
    }

    const canonicalRootId = await resolveCanonicalRootTweetId({
      clickedTweetId: options.clickedTweetId,
      rootHintTweetId: options.rootHintTweetId,
      client
    });

    if (typeof options.onProgress === "function") {
      options.onProgress({
        phase: "root_resolved",
        canonicalRootId: canonicalRootId || null
      });
    }

    if (!canonicalRootId) {
      return {
        canonicalRootId: null,
        tweets: [],
        users: [],
        warnings
      };
    }

    const collected = await collectConnectedApiTweets({
      rootTweetId: canonicalRootId,
      client,
      followingSet: options.followingSet || options.followingIds || [],
      onWarning: (message) => warnings.push(message),
      onProgress: options.onProgress
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

  const api = {
    DEFAULT_API_BASE_URL,
    DEFAULT_OPTIONS,
    createClient,
    resolveCanonicalRootTweetId,
    collectConnectedApiTweets,
    collectConnectedApiTweetsIncremental,
    buildConversationDataset,
    fetchUserByUsername,
    fetchFollowingUserIds,
    normalizeApiTweet,
    pickReferencedTweet
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globalScope.AriadexDataXApiClient = api;
  }
})();
