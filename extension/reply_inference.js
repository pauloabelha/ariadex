(() => {
  "use strict";

  const INDENT_EPSILON = 4;

  function toNumber(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function readIndentationMetrics(tweetElement) {
    if (!tweetElement || typeof tweetElement.getBoundingClientRect !== "function") {
      return {
        left: 0,
        marginLeft: 0,
        paddingLeft: 0,
        indent: 0
      };
    }

    const rect = tweetElement.getBoundingClientRect();
    const left = toNumber(rect.left);

    const view = tweetElement.ownerDocument?.defaultView;
    const computed = view && typeof view.getComputedStyle === "function"
      ? view.getComputedStyle(tweetElement)
      : null;

    const marginLeft = toNumber(computed?.marginLeft || "0");
    const paddingLeft = toNumber(computed?.paddingLeft || "0");

    // Prefer visual placement when available, fallback to local spacing styles.
    const indent = left !== 0 ? left : marginLeft + paddingLeft;

    return {
      left,
      marginLeft,
      paddingLeft,
      indent
    };
  }

  function buildDepthMap(indents) {
    const sorted = [...indents].sort((a, b) => a - b);
    const depthLevels = [];

    for (const indent of sorted) {
      const found = depthLevels.some((existing) => Math.abs(existing - indent) <= INDENT_EPSILON);
      if (!found) {
        depthLevels.push(indent);
      }
    }

    return depthLevels;
  }

  function inferIndentationDepths(tweetElements) {
    const metrics = tweetElements.map((tweetElement) => readIndentationMetrics(tweetElement));
    const depthLevels = buildDepthMap(metrics.map((metric) => metric.indent));

    const depths = metrics.map((metric) => {
      let bestDepth = 0;
      let smallestDiff = Number.POSITIVE_INFINITY;

      for (let i = 0; i < depthLevels.length; i += 1) {
        const diff = Math.abs(depthLevels[i] - metric.indent);
        if (diff < smallestDiff) {
          smallestDiff = diff;
          bestDepth = i;
        }
      }

      return bestDepth;
    });

    return {
      metrics,
      depths
    };
  }

  function extractReplyContextHandle(tweetElement) {
    if (!tweetElement) {
      return null;
    }

    const text = tweetElement.textContent || "";
    const match = text.match(/Replying to\s+@([A-Za-z0-9_]+)/i);
    if (!match) {
      return null;
    }

    return `@${match[1]}`;
  }

  function inferReplyStructure(tweetElements, tweetData) {
    const safeElements = Array.isArray(tweetElements) ? tweetElements : [];
    const safeTweets = Array.isArray(tweetData) ? tweetData : [];
    const limit = Math.min(safeElements.length, safeTweets.length);

    if (limit === 0) {
      return [];
    }

    const { depths } = inferIndentationDepths(safeElements.slice(0, limit));
    const inferredTweets = safeTweets.slice(0, limit).map((tweet) => ({ ...tweet }));
    const lastSeenByAuthor = new Map();

    for (let i = 0; i < inferredTweets.length; i += 1) {
      const tweet = inferredTweets[i];
      const element = safeElements[i];
      const currentDepth = depths[i] || 0;

      if (tweet.author) {
        lastSeenByAuthor.set(tweet.author.toLowerCase(), tweet);
      }

      if (tweet.reply_to) {
        continue;
      }

      let inferredParentId = null;

      // Heuristic 1: reply context text, e.g. "Replying to @username".
      const contextHandle = extractReplyContextHandle(element);
      if (contextHandle) {
        const parentByHandle = lastSeenByAuthor.get(contextHandle.toLowerCase());
        if (parentByHandle && parentByHandle.id && parentByHandle.id !== tweet.id) {
          inferredParentId = parentByHandle.id;
        }
      }

      // Heuristic 2 + fallback: nearest previous tweet with smaller indentation depth.
      if (!inferredParentId && currentDepth > 0) {
        for (let j = i - 1; j >= 0; j -= 1) {
          if ((depths[j] || 0) < currentDepth) {
            const candidate = inferredTweets[j];
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

    return inferredTweets;
  }

  const api = {
    readIndentationMetrics,
    inferIndentationDepths,
    inferReplyStructure
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    window.AriadexReplyInference = api;
  }
})();
