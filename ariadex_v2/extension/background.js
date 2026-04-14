"use strict";

const TWEET_CACHE_KEY = "ariadex_v2_tweet_cache";

function buildSyndicationToken(tweetId) {
  return ((Number(tweetId) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

function buildTweetUrl(screenName, tweetId) {
  return `https://x.com/${encodeURIComponent(String(screenName || "i"))}/status/${encodeURIComponent(String(tweetId || ""))}`;
}

function normalizeTweetId(tweetId) {
  return String(tweetId || "").trim();
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
    }
  };
}

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

function normalizeTweet(payload) {
  if (!payload || !payload.id_str) {
    return null;
  }

  return {
    id: String(payload.id_str),
    author: String(payload.user?.screen_name || "unknown"),
    text: String(payload.text || ""),
    url: buildTweetUrl(payload.user?.screen_name || "i", payload.id_str),
    quotedId: payload?.quoted_tweet?.id_str ? String(payload.quoted_tweet.id_str) : "",
    repliedToId: payload?.in_reply_to_status_id_str ? String(payload.in_reply_to_status_id_str) : ""
  };
}

function resolveParentId(tweet) {
  if (!tweet) {
    return { parentId: "", relationType: "" };
  }

  // AriadeX root-path rule: quote ancestry outranks reply ancestry.
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

  const payload = await client.fetchTweetFromNetwork(normalizedTweetId);
  await storage.writeCache({
    ...cache,
    [normalizedTweetId]: payload
  });
  return payload;
}

async function resolveRootPath(tweetId, deps) {
  const path = [];
  const seen = new Set();
  let currentId = normalizeTweetId(tweetId);

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
      outboundRelation: relationType || ""
    });

    currentId = parentId;
  }

  return path.reverse();
}

function createBackgroundController({ chromeApi, fetchImpl }) {
  const storage = createStorageAdapter(chromeApi);
  const client = createTweetClient(fetchImpl);

  return {
    async resolveRootPath(tweetId) {
      return resolveRootPath(tweetId, { storage, client });
    },

    registerMessageHandler() {
      chromeApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.type !== "ARIADEx_V2_RESOLVE_ROOT_PATH") {
          return false;
        }

        this.resolveRootPath(message.tweetId)
          .then((path) => {
            sendResponse({ ok: true, path });
          })
          .catch((error) => {
            sendResponse({ ok: false, error: error?.message || "root_path_resolution_failed" });
          });

        return true;
      });
    }
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TWEET_CACHE_KEY,
    buildSyndicationToken,
    buildTweetUrl,
    normalizeTweetId,
    createStorageAdapter,
    createTweetClient,
    normalizeTweet,
    resolveParentId,
    fetchTweet,
    resolveRootPath,
    createBackgroundController
  };
} else {
  const controller = createBackgroundController({
    chromeApi: chrome,
    fetchImpl: fetch.bind(globalThis)
  });
  controller.registerMessageHandler();
}
