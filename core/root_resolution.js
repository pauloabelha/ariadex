(() => {
  "use strict";

  const globalScope = typeof globalThis !== "undefined" ? globalThis : {};

  function normalizeId(value) {
    if (value == null) {
      return null;
    }

    const normalized = String(value).trim();
    return normalized || null;
  }

  function pickReferencedTweet(tweet, type) {
    const refs = Array.isArray(tweet?.referenced_tweets) ? tweet.referenced_tweets : [];
    const match = refs.find((ref) => ref && ref.type === type && ref.id);
    return match ? normalizeId(match.id) : null;
  }

  function normalizeTweetIndex(input) {
    if (input instanceof Map) {
      return input;
    }

    const map = new Map();
    if (!input || typeof input !== "object") {
      return map;
    }

    for (const [key, value] of Object.entries(input)) {
      const id = normalizeId(key || value?.id);
      if (!id || map.has(id)) {
        continue;
      }
      map.set(id, value);
    }

    return map;
  }

  function resolveCanonicalRootId({ clickedTweetId, rootHintTweetId = null, tweetById } = {}) {
    const normalizedClickedId = normalizeId(clickedTweetId);
    const normalizedHintId = normalizeId(rootHintTweetId);

    if (!normalizedClickedId && !normalizedHintId) {
      return null;
    }

    const index = normalizeTweetIndex(tweetById);

    if (normalizedClickedId) {
      const clickedTweet = index.get(normalizedClickedId);
      const quotedFromClicked = pickReferencedTweet(clickedTweet, "quoted");
      if (quotedFromClicked) {
        return quotedFromClicked;
      }
    }

    const startId = normalizedHintId || normalizedClickedId;
    if (!startId) {
      return null;
    }

    const firstTweet = index.get(startId);
    if (!firstTweet) {
      return startId;
    }

    const quotedFromStart = pickReferencedTweet(firstTweet, "quoted");
    if (quotedFromStart) {
      return quotedFromStart;
    }

    const visited = new Set();
    let currentTweet = firstTweet;

    while (currentTweet?.id && !visited.has(currentTweet.id)) {
      const currentId = normalizeId(currentTweet.id);
      if (!currentId) {
        break;
      }

      visited.add(currentId);
      const repliedToId = pickReferencedTweet(currentTweet, "replied_to");
      if (!repliedToId || visited.has(repliedToId)) {
        return currentId;
      }

      const parentTweet = index.get(repliedToId);
      if (!parentTweet) {
        return repliedToId;
      }

      currentTweet = parentTweet;
    }

    return normalizeId(currentTweet?.id) || startId;
  }

  const api = {
    pickReferencedTweet,
    resolveCanonicalRootId
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globalScope.AriadexCoreRootResolution = api;
  }
})();
