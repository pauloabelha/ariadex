(() => {
  "use strict";

  const globalScope = typeof globalThis !== "undefined" ? globalThis : {};

  const INDENT_EPSILON = 4;

  function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function buildDepthMap(indents) {
    const sorted = [...indents].map((value) => toFiniteNumber(value, 0)).sort((a, b) => a - b);
    const levels = [];

    for (const indent of sorted) {
      const alreadyCovered = levels.some((existing) => Math.abs(existing - indent) <= INDENT_EPSILON);
      if (!alreadyCovered) {
        levels.push(indent);
      }
    }

    return levels;
  }

  function computeDepths(metadata) {
    const indents = metadata.map((entry) => toFiniteNumber(entry?.indent, 0));
    const levels = buildDepthMap(indents);

    return indents.map((indent) => {
      let bestDepth = 0;
      let bestDiff = Number.POSITIVE_INFINITY;

      for (let i = 0; i < levels.length; i += 1) {
        const diff = Math.abs(levels[i] - indent);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestDepth = i;
        }
      }

      return bestDepth;
    });
  }

  function normalizeHandle(value) {
    const normalized = String(value || "").trim();
    if (!normalized) {
      return "";
    }

    return normalized.startsWith("@") ? normalized.toLowerCase() : `@${normalized.toLowerCase()}`;
  }

  function inferReplyStructure(tweetData, metadata = []) {
    const tweets = Array.isArray(tweetData) ? tweetData : [];
    if (tweets.length === 0) {
      return [];
    }

    const safeMetadata = new Array(tweets.length);
    for (let i = 0; i < tweets.length; i += 1) {
      safeMetadata[i] = metadata[i] || { indent: 0, replyContextHandle: null };
    }

    const depths = computeDepths(safeMetadata);
    const inferred = tweets.map((tweet) => ({ ...tweet }));
    const lastSeenByAuthor = new Map();

    for (let i = 0; i < inferred.length; i += 1) {
      const tweet = inferred[i];
      const currentDepth = depths[i] || 0;

      if (tweet.author) {
        lastSeenByAuthor.set(normalizeHandle(tweet.author), tweet);
      }

      if (tweet.reply_to) {
        continue;
      }

      let inferredParentId = null;
      const contextHandle = normalizeHandle(safeMetadata[i]?.replyContextHandle);
      if (contextHandle) {
        const parentByHandle = lastSeenByAuthor.get(contextHandle);
        if (parentByHandle?.id && parentByHandle.id !== tweet.id) {
          inferredParentId = parentByHandle.id;
        }
      }

      if (!inferredParentId && currentDepth > 0) {
        for (let j = i - 1; j >= 0; j -= 1) {
          if ((depths[j] || 0) < currentDepth) {
            const candidate = inferred[j];
            if (candidate?.id && candidate.id !== tweet.id) {
              inferredParentId = candidate.id;
            }
            break;
          }
        }
      }

      if (inferredParentId) {
        tweet.reply_to = inferredParentId;
      }
    }

    return inferred;
  }

  const api = {
    inferReplyStructure,
    computeDepths,
    buildDepthMap
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globalScope.AriadexCoreReplyInference = api;
  }
})();
