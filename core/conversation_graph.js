(() => {
  "use strict";

  const globalScope = typeof globalThis !== "undefined" ? globalThis : {};

  function indexTweetsById(tweets) {
    const index = {};
    for (const tweet of tweets || []) {
      if (!tweet || !tweet.id || index[tweet.id]) {
        continue;
      }
      index[tweet.id] = tweet;
    }
    return index;
  }

  function attachReplies(tweets) {
    const uniqueTweets = [];
    const seen = new Set();

    for (const tweet of tweets || []) {
      if (!tweet) {
        continue;
      }

      const identity = tweet.id || tweet.url || `${tweet.author || ""}:${tweet.text || ""}`;
      if (!identity || seen.has(identity)) {
        continue;
      }
      seen.add(identity);
      uniqueTweets.push(tweet);
    }

    const nodeById = {};
    const nodeByTweet = new Map();
    const roots = [];

    uniqueTweets.forEach((tweet, index) => {
      const nodeKey = tweet.id || `fallback:${tweet.url || tweet.author || "unknown"}:${index}`;
      const node = { tweet, children: [] };
      nodeByTweet.set(tweet, { key: nodeKey, node });
      nodeById[nodeKey] = node;
    });

    for (const tweet of uniqueTweets) {
      const nodeEntry = nodeByTweet.get(tweet);
      const node = nodeEntry ? nodeEntry.node : null;
      if (!node) {
        continue;
      }

      if (tweet.id) {
        nodeById[tweet.id] = node;
      }
    }

    for (const tweet of uniqueTweets) {
      const nodeEntry = nodeByTweet.get(tweet);
      const node = nodeEntry ? nodeEntry.node : null;
      if (!node) {
        continue;
      }

      const parentId = tweet.reply_to;
      if (!parentId || parentId === tweet.id || !nodeById[parentId]) {
        roots.push(node);
        continue;
      }

      const parentNode = nodeById[parentId];
      parentNode.children.push(node);
    }

    return {
      tweets: uniqueTweets,
      index: indexTweetsById(uniqueTweets),
      roots
    };
  }

  function buildTypedEdges(tweets, index) {
    const edges = [];
    const seen = new Set();
    const safeIndex = index || {};

    const maybePush = (source, target, type) => {
      if (!source || !target || source === target || !safeIndex[source] || !safeIndex[target]) {
        return;
      }

      const key = `${source}|${target}|${type}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      edges.push({ source, target, type });
    };

    for (const tweet of tweets || []) {
      if (!tweet?.id) {
        continue;
      }

      maybePush(tweet.id, tweet.reply_to, "reply");
      maybePush(tweet.id, tweet.quote_of, "quote");
      maybePush(tweet.id, tweet.repost_of, "repost");
    }

    return edges;
  }

  function buildConversationGraph(tweets) {
    const safeTweets = Array.isArray(tweets) ? tweets : [];
    if (safeTweets.length === 0) {
      return {
        rootId: null,
        nodes: [],
        edges: [],
        root: null,
        children: []
      };
    }

    const { tweets: uniqueTweets, index, roots } = attachReplies(safeTweets);
    const explicitRootTweet = safeTweets.find((tweet) => tweet && tweet.reply_to == null && tweet.id && index[tweet.id]);
    const fallbackRootNode = roots[0] || null;

    const rootNode = explicitRootTweet && explicitRootTweet.id
      ? roots.find((node) => node.tweet.id === explicitRootTweet.id) || fallbackRootNode
      : fallbackRootNode;

    if (!rootNode) {
      return {
        rootId: null,
        nodes: uniqueTweets,
        edges: buildTypedEdges(uniqueTweets, index),
        root: null,
        children: []
      };
    }

    const disconnected = roots.filter((node) => node !== rootNode);
    const edges = buildTypedEdges(uniqueTweets, index);
    return {
      rootId: rootNode.tweet.id || null,
      nodes: uniqueTweets,
      edges,
      root: rootNode.tweet,
      children: [...rootNode.children, ...disconnected]
    };
  }

  const api = {
    indexTweetsById,
    attachReplies,
    buildTypedEdges,
    buildConversationGraph
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globalScope.AriadexCoreConversationGraph = api;
  }
})();
