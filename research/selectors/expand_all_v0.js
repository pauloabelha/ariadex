"use strict";

const {
  buildChildrenIndex,
  buildMandatoryPath,
  computeImportanceScore,
  getSubstantiveTextMetrics,
  isLowSignalTweet
} = require("../../server/path_anchored_snapshot.js");
const { finalizeSelection, mergeSelectorParams, normalizeSelectorContext } = require("./shared.js");

const ALGORITHM_ID = "expand_all_v0";
const DEFAULT_PARAMS = {
  maxDepth: 3,
  maxTotalTweets: 80,
  minSubstantiveChars: 80,
  includeLowSignal: false
};

function select({ dataset, clickedTweetId = null, rootHintTweetId = null, params = {} } = {}) {
  const config = mergeSelectorParams(DEFAULT_PARAMS, params);
  const { sourceTweets, tweetById, canonicalRootId } = normalizeSelectorContext({
    dataset,
    clickedTweetId,
    rootHintTweetId
  });
  const mandatoryPath = buildMandatoryPath(tweetById, clickedTweetId, canonicalRootId, { rootHintTweetId });
  const { repliesByParentId, quotesByParentId } = buildChildrenIndex(tweetById);
  const selectedIds = new Set(mandatoryPath.map((tweet) => String(tweet.id)));
  const scoreById = new Map();
  const expansions = [];

  let frontier = mandatoryPath.slice();
  for (let depth = 1; depth <= config.maxDepth && frontier.length > 0 && selectedIds.size < config.maxTotalTweets; depth += 1) {
    const chosen = [];

    for (const parent of frontier) {
      const parentId = String(parent?.id || "");
      const children = [
        ...(repliesByParentId.get(parentId) || []).map((tweet) => ({ tweet, relationType: "reply" })),
        ...(quotesByParentId.get(parentId) || []).map((tweet) => ({ tweet, relationType: "quote" }))
      ];

      for (const child of children) {
        const tweet = child.tweet;
        const childId = String(tweet?.id || "");
        if (!childId || selectedIds.has(childId)) {
          continue;
        }
        if (!config.includeLowSignal && isLowSignalTweet(tweet, config.minSubstantiveChars)) {
          continue;
        }
        const metrics = getSubstantiveTextMetrics(tweet);
        if (metrics.substantiveChars < Math.max(20, Math.floor(config.minSubstantiveChars * 0.3)) && !config.includeLowSignal) {
          continue;
        }

        const importanceScore = computeImportanceScore(tweet, {
          minSubstantiveChars: config.minSubstantiveChars,
          relationType: child.relationType,
          depth,
          isMandatoryPathChild: mandatoryPath.some((entry) => String(entry?.id || "") === parentId)
        });
        chosen.push({
          id: childId,
          parentId,
          relationType: child.relationType,
          importanceScore,
          tweet
        });
      }
    }

    chosen.sort((a, b) => {
      if (String(a.parentId) !== String(b.parentId)) {
        return String(a.parentId).localeCompare(String(b.parentId));
      }
      if (a.relationType !== b.relationType) {
        return String(a.relationType).localeCompare(String(b.relationType));
      }
      return String(a.id).localeCompare(String(b.id));
    });

    const remainingBudget = Math.max(0, config.maxTotalTweets - selectedIds.size);
    const kept = chosen.slice(0, remainingBudget);
    if (kept.length === 0) {
      break;
    }

    expansions.push({
      depth,
      tweets: kept.map((entry) => ({
        id: entry.id,
        parentId: entry.parentId,
        relationType: entry.relationType,
        importanceScore: entry.importanceScore
      }))
    });

    frontier = kept.map((entry) => entry.tweet);
    for (const entry of kept) {
      selectedIds.add(entry.id);
      scoreById.set(entry.id, entry.importanceScore);
    }
  }

  return finalizeSelection({
    algorithmId: ALGORITHM_ID,
    sourceTweets,
    tweetById,
    selectedIds,
    mandatoryPath,
    expansions,
    scoreById,
    params: config,
    notes: [
      "Breadth-first expansion baseline without competitive pruning across frontier nodes."
    ]
  });
}

module.exports = {
  algorithmId: ALGORITHM_ID,
  defaultParams: {
    ...DEFAULT_PARAMS
  },
  label: "Expand All",
  description: "Breadth-heavy baseline that keeps all discovered children until the global budget is exhausted.",
  select
};
