(() => {
  "use strict";

  const conversationGraphApi = typeof module !== "undefined" && module.exports
    ? require("./conversation_graph.js")
    : (window.AriadexConversationGraph || {});
  const threadCollapseApi = typeof module !== "undefined" && module.exports
    ? require("./thread_collapse.js")
    : (window.AriadexThreadCollapse || {});
  const conversationRankApi = typeof module !== "undefined" && module.exports
    ? require("./conversation_rank.js")
    : (window.AriadexConversationRank || {});

  const buildConversationGraph = typeof conversationGraphApi.buildConversationGraph === "function"
    ? conversationGraphApi.buildConversationGraph
    : () => ({ rootId: null, nodes: [], edges: [], root: null, children: [] });
  const collapseAuthorThread = typeof threadCollapseApi.collapseAuthorThread === "function"
    ? threadCollapseApi.collapseAuthorThread
    : (graph) => graph;
  const rankConversationGraph = typeof conversationRankApi.rankConversationGraph === "function"
    ? conversationRankApi.rankConversationGraph
    : () => ({ scores: [], scoreById: {}, topTweetIds: [], iterations: 0, converged: true });

  const DEFAULT_API_BASE_URL = "https://api.x.com/2";
  const DEFAULT_OPTIONS = {
    apiBaseUrl: DEFAULT_API_BASE_URL,
    maxPagesPerCollection: 10,
    maxResultsPerPage: 100,
    maxConversationRoots: 30,
    maxConnectedTweets: 1500,
    includeRetweets: true,
    includeQuoteReplies: true,
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
    "username"
  ];

  const DEFAULT_EXPANSIONS = [
    "author_id"
  ];

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
    merged.maxConnectedTweets = Math.max(10, Math.floor(merged.maxConnectedTweets));
    merged.requestTimeoutMs = Math.max(1000, Math.floor(merged.requestTimeoutMs));

    return merged;
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

  async function createClient({ bearerToken, fetchImpl, options }) {
    if (!bearerToken || typeof bearerToken !== "string") {
      throw new Error("Missing X API bearer token");
    }

    const effectiveFetch = typeof fetchImpl === "function"
      ? fetchImpl
      : (typeof fetch === "function" ? fetch.bind(globalThis) : null);

    if (!effectiveFetch) {
      throw new Error("No fetch implementation available");
    }

    const normalizedOptions = normalizeOptions(options);

    async function request(path, params = {}) {
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
          const body = await response.text();
          const snippet = body ? body.slice(0, 500) : "";
          throw new Error(`X API request failed (${response.status} ${response.statusText}) for ${url.pathname}: ${snippet}`);
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

      // Rule 1: quote tweet resolves directly to the quoted tweet.
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

    // Rule 2: reply tweet climbs the reply chain until the original root.
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

    return {
      id,
      author_id: authorId,
      author: username ? `@${username}` : (authorId ? `user:${authorId}` : null),
      text: tweet?.text || "",
      url: id && !isSynthetic
        ? (username ? `https://x.com/${username}/status/${id}` : `https://x.com/i/web/status/${id}`)
        : null,
      replies: Number.isFinite(metrics.reply_count) ? metrics.reply_count : 0,
      reposts: Number.isFinite(metrics.retweet_count) ? metrics.retweet_count : 0,
      likes: Number.isFinite(metrics.like_count) ? metrics.like_count : 0,
      quote_count: Number.isFinite(metrics.quote_count) ? metrics.quote_count : 0,
      metrics,
      reply_to: pickReferencedTweet(tweet, "replied_to"),
      quote_of: pickReferencedTweet(tweet, "quoted"),
      repost_of: pickReferencedTweet(tweet, "retweeted"),
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

  function buildRankingGraph(graph) {
    const safeGraph = graph || {};
    const safeNodes = Array.isArray(safeGraph.nodes) ? safeGraph.nodes : [];
    const safeEdges = Array.isArray(safeGraph.edges) ? safeGraph.edges : [];

    const nodes = [];
    const nodeIds = new Set();
    for (const node of safeNodes) {
      if (!node || !node.id || node.type === "repost_event") {
        continue;
      }
      nodes.push(node);
      nodeIds.add(node.id);
    }

    const edges = [];
    for (const edge of safeEdges) {
      if (!edge || !nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
        continue;
      }
      if (edge.type !== "reply" && edge.type !== "quote") {
        continue;
      }
      edges.push(edge);
    }

    return {
      ...safeGraph,
      nodes,
      edges
    };
  }

  async function collectConnectedApiTweets({ rootTweetId, client, onWarning }) {
    const tweetById = new Map();
    const userById = new Map();

    const rootQueue = [rootTweetId];
    const processedRoots = new Set();

    while (rootQueue.length > 0 && processedRoots.size < client.options.maxConversationRoots) {
      if (tweetById.size >= client.options.maxConnectedTweets) {
        break;
      }

      const rootId = rootQueue.shift();
      if (!rootId || processedRoots.has(rootId)) {
        continue;
      }
      processedRoots.add(rootId);

      const rootLookup = await fetchTweetById(client, rootId);
      addUsersToMap(userById, rootLookup.users);
      addTweetsToMap(tweetById, [rootLookup.tweet], client.options.maxConnectedTweets);

      const conversationReplies = await fetchPaginated(client, "/tweets/search/recent", {
        ...baseTweetParams(client.options.maxResultsPerPage),
        query: `conversation_id:${rootId}`
      });
      addUsersToMap(userById, conversationReplies.users);
      addTweetsToMap(tweetById, conversationReplies.tweets, client.options.maxConnectedTweets);

      let quoteTweets = { tweets: [], users: [] };
      try {
        quoteTweets = await fetchPaginated(client, `/tweets/${rootId}/quote_tweets`, {
          ...baseTweetParams(client.options.maxResultsPerPage)
        });
      } catch (error) {
        if (typeof onWarning === "function") {
          onWarning(`quote_tweets failed for ${rootId}: ${error.message}`);
        }
      }

      addUsersToMap(userById, quoteTweets.users);
      addTweetsToMap(tweetById, quoteTweets.tweets, client.options.maxConnectedTweets);

      if (client.options.includeQuoteReplies) {
        for (const quoteTweet of quoteTweets.tweets) {
          const quoteId = quoteTweet?.id;
          if (!quoteId || processedRoots.has(quoteId)) {
            continue;
          }
          rootQueue.push(quoteId);
        }
      }

      if (client.options.includeRetweets) {
        try {
          const repostUsers = await fetchRetweetedByUsers(client, rootId);
          addUsersToMap(userById, repostUsers);

          const repostTweets = buildSyntheticRepostTweets({
            rootId,
            users: repostUsers
          });
          addTweetsToMap(tweetById, repostTweets, client.options.maxConnectedTweets);
        } catch (error) {
          if (typeof onWarning === "function") {
            onWarning(`retweeted_by failed for ${rootId}: ${error.message}`);
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
      } catch (error) {
        if (typeof onWarning === "function") {
          onWarning(`Author lookup failed: ${error.message}`);
        }
      }
    }

    const tweets = [...tweetById.values()].map((tweet) => normalizeApiTweet(tweet, userById));
    return {
      tweets,
      users: [...userById.values()]
    };
  }

  async function buildConversationSnapshot(options = {}) {
    const warnings = [];
    const client = await createClient({
      bearerToken: options.bearerToken,
      fetchImpl: options.fetchImpl,
      options
    });

    const canonicalRootId = await resolveCanonicalRootTweetId({
      clickedTweetId: options.clickedTweetId,
      rootHintTweetId: options.rootHintTweetId,
      client
    });

    if (!canonicalRootId) {
      return {
        nodes: [],
        edges: [],
        ranking: [],
        canonicalRootId: null,
        warnings
      };
    }

    const collected = await collectConnectedApiTweets({
      rootTweetId: canonicalRootId,
      client,
      onWarning: (message) => warnings.push(message)
    });

    const graph = buildConversationGraph(collected.tweets);
    const collapsedGraph = collapseAuthorThread(graph);
    const rankingGraph = buildRankingGraph(collapsedGraph);
    const rankingResult = rankConversationGraph(rankingGraph, options.rankOptions || {});

    return {
      canonicalRootId,
      rootId: collapsedGraph.rootId,
      root: collapsedGraph.root,
      nodes: collapsedGraph.nodes,
      edges: collapsedGraph.edges,
      ranking: rankingResult.scores,
      rankingMeta: rankingResult,
      warnings
    };
  }

  const api = {
    DEFAULT_API_BASE_URL,
    DEFAULT_OPTIONS,
    resolveCanonicalRootTweetId,
    collectConnectedApiTweets,
    buildConversationSnapshot,
    normalizeApiTweet,
    pickReferencedTweet
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    window.AriadexXApiConversation = api;
  }
})();
