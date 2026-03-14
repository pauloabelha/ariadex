"use strict";

const { performance } = require("node:perf_hooks");

const {
  createGraphCacheService,
  MemoryCacheStore,
  createLogger
} = require("../server/graph_cache_server.js");

function toInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
}

function sleep(ms) {
  if (!ms || ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function responseJson(body, status = 200, statusText = "OK", headers = {}) {
  const normalizedHeaders = new Map();
  for (const [key, value] of Object.entries(headers)) {
    normalizedHeaders.set(String(key).toLowerCase(), String(value));
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: {
      get(name) {
        return normalizedHeaders.get(String(name || "").toLowerCase()) || null;
      }
    },
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    }
  };
}

function makeUser(id, username, followersCount = 1000) {
  return {
    id: String(id),
    username: String(username),
    name: String(username),
    profile_image_url: `https://pbs.twimg.com/profile_images/${username}.jpg`,
    description: "",
    verified: false,
    verified_type: null,
    public_metrics: {
      followers_count: Number(followersCount),
      following_count: 0,
      tweet_count: 0,
      listed_count: 0
    }
  };
}

function makeTweet(id, authorId, text, referencedTweets = []) {
  return {
    id: String(id),
    author_id: String(authorId),
    text,
    referenced_tweets: referencedTweets,
    public_metrics: {
      like_count: 10,
      retweet_count: 4,
      reply_count: 3,
      quote_count: 2
    }
  };
}

function buildSyntheticConversation({
  rootId = "1000",
  replyCount = 120,
  quoteCount = 20,
  quoteReplyCount = 2
} = {}) {
  const usersById = new Map();
  const tweetsById = new Map();
  const quotesByRoot = new Map();
  const conversationByRoot = new Map();

  const rootAuthor = makeUser("u_root", "root_author", 250000);
  usersById.set(rootAuthor.id, rootAuthor);
  const rootTweet = makeTweet(rootId, rootAuthor.id, "Synthetic root tweet");
  tweetsById.set(rootId, rootTweet);
  conversationByRoot.set(rootId, [rootTweet]);

  const replies = [];
  for (let i = 0; i < replyCount; i += 1) {
    const userId = `u_r_${i}`;
    const username = `reply_${i}`;
    const user = makeUser(userId, username, 300 + i);
    usersById.set(userId, user);
    const tweetId = `r_${i}`;
    const tweet = makeTweet(tweetId, userId, `Reply ${i}`, [{ type: "replied_to", id: rootId }]);
    tweetsById.set(tweetId, tweet);
    replies.push(tweet);
  }
  conversationByRoot.set(rootId, [rootTweet, ...replies]);

  const quotes = [];
  const followedUser = makeUser("u_followed", "alice", 120000);
  usersById.set(followedUser.id, followedUser);
  const followedQuote = makeTweet("q_followed", followedUser.id, "Followed quote", [{ type: "quoted", id: rootId }]);
  tweetsById.set(followedQuote.id, followedQuote);
  quotes.push(followedQuote);

  for (let i = 0; i < quoteCount; i += 1) {
    const userId = `u_q_${i}`;
    const username = `quote_${i}`;
    const user = makeUser(userId, username, 600 + i);
    usersById.set(userId, user);
    const quoteId = `q_${i}`;
    const quote = makeTweet(quoteId, userId, `Quote ${i}`, [{ type: "quoted", id: rootId }]);
    tweetsById.set(quoteId, quote);
    quotes.push(quote);
  }
  quotesByRoot.set(rootId, quotes);

  for (const quote of quotes) {
    const quoteReplies = [quote];
    for (let j = 0; j < quoteReplyCount; j += 1) {
      const userId = `u_qr_${quote.id}_${j}`;
      const username = `qr_${quote.id}_${j}`;
      const user = makeUser(userId, username, 100 + j);
      usersById.set(userId, user);
      const replyId = `qr_${quote.id}_${j}`;
      const reply = makeTweet(replyId, userId, `Reply to ${quote.id} #${j}`, [{ type: "replied_to", id: quote.id }]);
      tweetsById.set(replyId, reply);
      quoteReplies.push(reply);
    }
    conversationByRoot.set(quote.id, quoteReplies);
    quotesByRoot.set(quote.id, []);
  }

  return {
    rootId: String(rootId),
    tweetsById,
    usersById,
    conversationByRoot,
    quotesByRoot
  };
}

function detectEndpointKind(url) {
  const path = url.pathname;
  if (path === "/2/tweets/search/recent") {
    const query = String(url.searchParams.get("query") || "");
    if (query.includes("from:")) {
      return "search_recent_following";
    }
    return "search_recent_conversation";
  }
  if (/^\/2\/tweets\/[^/]+\/quote_tweets$/.test(path)) {
    return "quote_tweets";
  }
  if (path === "/2/tweets") {
    return "tweets_batch";
  }
  if (path === "/2/users") {
    return "users_batch";
  }
  if (/^\/2\/tweets\/[^/]+$/.test(path)) {
    return "tweet_lookup";
  }
  return "other";
}

function parseFromHandles(query) {
  const out = [];
  const regex = /from:([a-zA-Z0-9_]{1,15})/g;
  let match;
  while ((match = regex.exec(query)) != null) {
    out.push(String(match[1]).toLowerCase());
  }
  return out;
}

function parseDiscoveryRootId(query) {
  const conversationMatch = query.match(/conversation_id:([0-9A-Za-z_]+)/);
  if (conversationMatch && conversationMatch[1]) {
    return String(conversationMatch[1]);
  }
  const quotesMatch = query.match(/quotes:([0-9A-Za-z_]+)/);
  if (quotesMatch && quotesMatch[1]) {
    return String(quotesMatch[1]);
  }
  return null;
}

function createSyntheticFetch({ dataset, latencyMs = 0 }) {
  const callCounters = new Map();

  function bump(kind) {
    callCounters.set(kind, Number(callCounters.get(kind) || 0) + 1);
  }

  async function fetchImpl(urlString) {
    const url = new URL(String(urlString));
    const kind = detectEndpointKind(url);
    bump(kind);
    await sleep(latencyMs);

    const path = url.pathname;
    if (/^\/2\/tweets\/[^/]+$/.test(path)) {
      const id = path.split("/").pop();
      const tweet = dataset.tweetsById.get(id) || null;
      if (!tweet) {
        return responseJson({ data: null, includes: { users: [] } }, 404, "Not Found");
      }
      const user = dataset.usersById.get(tweet.author_id) || null;
      return responseJson({
        data: tweet,
        includes: { users: user ? [user] : [] }
      });
    }

    if (path === "/2/tweets/search/recent") {
      const query = String(url.searchParams.get("query") || "");
      if (query.includes("from:")) {
        const rootId = parseDiscoveryRootId(query);
        const handles = new Set(parseFromHandles(query));
        const quotes = dataset.quotesByRoot.get(rootId) || [];
        const matched = quotes.filter((tweet) => {
          const user = dataset.usersById.get(tweet.author_id);
          const username = String(user?.username || "").toLowerCase();
          return handles.has(username);
        });
        const users = matched
          .map((tweet) => dataset.usersById.get(tweet.author_id))
          .filter(Boolean);
        return responseJson({
          data: matched,
          includes: { users },
          meta: {}
        });
      }

      const conversationMatch = query.match(/^conversation_id:([0-9A-Za-z_]+)$/);
      const rootId = conversationMatch && conversationMatch[1] ? String(conversationMatch[1]) : null;
      const tweets = rootId ? (dataset.conversationByRoot.get(rootId) || []) : [];
      const users = tweets
        .map((tweet) => dataset.usersById.get(tweet.author_id))
        .filter(Boolean);
      return responseJson({
        data: tweets,
        includes: { users },
        meta: {}
      });
    }

    if (/^\/2\/tweets\/[^/]+\/quote_tweets$/.test(path)) {
      const rootId = path.split("/")[3];
      const quotes = dataset.quotesByRoot.get(rootId) || [];
      const users = quotes
        .map((tweet) => dataset.usersById.get(tweet.author_id))
        .filter(Boolean);
      return responseJson({
        data: quotes,
        includes: { users },
        meta: {}
      });
    }

    if (path === "/2/tweets") {
      const ids = String(url.searchParams.get("ids") || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      const tweets = ids
        .map((id) => dataset.tweetsById.get(id))
        .filter(Boolean);
      const users = tweets
        .map((tweet) => dataset.usersById.get(tweet.author_id))
        .filter(Boolean);
      return responseJson({
        data: tweets,
        includes: { users }
      });
    }

    if (path === "/2/users") {
      const ids = String(url.searchParams.get("ids") || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      const users = ids
        .map((id) => dataset.usersById.get(id))
        .filter(Boolean);
      return responseJson({ data: users });
    }

    return responseJson({ title: "unexpected_route", path }, 404, "Not Found");
  }

  return {
    fetchImpl,
    snapshotCounters() {
      return Object.fromEntries(callCounters.entries());
    },
    reset() {
      callCounters.clear();
    }
  };
}

function countersDelta(before, after) {
  const keys = new Set([
    ...Object.keys(before || {}),
    ...Object.keys(after || {})
  ]);
  const out = {};
  for (const key of keys) {
    out[key] = Number(after?.[key] || 0) - Number(before?.[key] || 0);
  }
  return out;
}

function sumCounters(counters) {
  return Object.values(counters || {}).reduce((sum, value) => sum + Number(value || 0), 0);
}

async function timed(task) {
  const started = performance.now();
  const value = await task();
  return {
    value,
    durationMs: performance.now() - started
  };
}

async function runBenchmark(options = {}) {
  const rootId = String(options.rootId || "1000");
  const dataset = buildSyntheticConversation({
    rootId,
    replyCount: toInt(options.replyCount, 120),
    quoteCount: toInt(options.quoteCount, 20),
    quoteReplyCount: toInt(options.quoteReplyCount, 2)
  });
  const syntheticFetch = createSyntheticFetch({
    dataset,
    latencyMs: toInt(options.latencyMs, 0)
  });

  const records = [];
  const logger = createLogger({
    level: "warn",
    sink: (record) => records.push(record)
  });

  const service = createGraphCacheService({
    bearerToken: "benchmark-token",
    fetchImpl: syntheticFetch.fetchImpl,
    cacheStore: new MemoryCacheStore(),
    contributionClassifier: null,
    logger
  });

  const request = {
    clickedTweetId: rootId,
    mode: "deep",
    followingIds: ["alice"],
    incremental: false
  };

  syntheticFetch.reset();
  const beforeCold = syntheticFetch.snapshotCounters();
  const cold = await timed(() => service.getSnapshot(request));
  const afterCold = syntheticFetch.snapshotCounters();
  const coldCalls = countersDelta(beforeCold, afterCold);

  const beforeWarm = syntheticFetch.snapshotCounters();
  const warm = await timed(() => service.getSnapshot(request));
  const afterWarm = syntheticFetch.snapshotCounters();
  const warmCalls = countersDelta(beforeWarm, afterWarm);

  return {
    scenario: {
      rootId,
      replyCount: toInt(options.replyCount, 120),
      quoteCount: toInt(options.quoteCount, 20),
      quoteReplyCount: toInt(options.quoteReplyCount, 2),
      latencyMs: toInt(options.latencyMs, 0)
    },
    cold: {
      durationMs: Number(cold.durationMs.toFixed(2)),
      cacheHit: Boolean(cold.value?.cache?.hit),
      nodeCount: Array.isArray(cold.value?.nodes) ? cold.value.nodes.length : 0,
      edgeCount: Array.isArray(cold.value?.edges) ? cold.value.edges.length : 0,
      requestCounts: coldCalls,
      requestCountTotal: sumCounters(coldCalls)
    },
    warm: {
      durationMs: Number(warm.durationMs.toFixed(2)),
      cacheHit: Boolean(warm.value?.cache?.hit),
      nodeCount: Array.isArray(warm.value?.nodes) ? warm.value.nodes.length : 0,
      edgeCount: Array.isArray(warm.value?.edges) ? warm.value.edges.length : 0,
      requestCounts: warmCalls,
      requestCountTotal: sumCounters(warmCalls)
    },
    speedup: {
      durationRatio: Number((cold.durationMs / Math.max(1e-9, warm.durationMs)).toFixed(4)),
      requestReduction: Math.max(0, sumCounters(coldCalls) - sumCounters(warmCalls))
    },
    warnings: records
      .filter((record) => record.level === "warn" || record.level === "error")
      .map((record) => ({ level: record.level, event: record.event }))
  };
}

function parseCliArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = String(argv[i] || "").trim();
    if (!token.startsWith("--")) {
      continue;
    }
    const [rawKey, rawValue] = token.split("=");
    const key = rawKey.slice(2);
    if (!key) {
      continue;
    }
    out[key] = rawValue == null ? "true" : rawValue;
  }
  return out;
}

async function main() {
  const args = parseCliArgs(process.argv);
  const summary = await runBenchmark(args);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("[Ariadex] benchmark failed", error);
    process.exitCode = 1;
  });
}

module.exports = {
  buildSyntheticConversation,
  createSyntheticFetch,
  runBenchmark
};

