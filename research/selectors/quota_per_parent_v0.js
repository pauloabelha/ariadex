"use strict";

const {
  buildChildrenIndex,
  buildMandatoryPath,
  computeImportanceScore,
  getSubstantiveTextMetrics,
  isLowSignalTweet
} = require("../../server/path_anchored_snapshot.js");
const { finalizeSelection, mergeSelectorParams, normalizeSelectorContext } = require("./shared.js");

const ALGORITHM_ID = "quota_per_parent_v0";
const DEFAULT_PARAMS = {
  maxDepth: 3,
  maxChildrenPerNode: 4,
  maxTotalTweets: 40,
  minSubstantiveChars: 120,
  minImportanceScore: 3.2
};

function select({ dataset, clickedTweetId = null, rootHintTweetId = null, params = {} } = {}) {
  const config = mergeSelectorParams(DEFAULT_PARAMS, params);
  const { sourceTweets, tweetById, canonicalRootId } = normalizeSelectorContext({
    dataset,
    clickedTweetId,
    rootHintTweetId
  });
  const mandatoryPath = buildMandatoryPath(tweetById, clickedTweetId, canonicalRootId, { rootHintTweetId });
  const mandatoryPathSet = new Set(mandatoryPath.map((tweet) => String(tweet.id)));
  const { repliesByParentId, quotesByParentId } = buildChildrenIndex(tweetById);
  const selectedIds = new Set(mandatoryPath.map((tweet) => String(tweet.id)));
  const scoreById = new Map();
  const expansions = [];

  let frontier = mandatoryPath.slice();
  for (let depth = 1; depth <= config.maxDepth && frontier.length > 0 && selectedIds.size < config.maxTotalTweets; depth += 1) {
    const perParentBuckets = [];

    for (const parent of frontier) {
      const parentId = String(parent?.id || "");
      if (!parentId) {
        continue;
      }
      const bucket = [
        ...(repliesByParentId.get(parentId) || []).map((tweet) => ({ tweet, relationType: "reply" })),
        ...(quotesByParentId.get(parentId) || []).map((tweet) => ({ tweet, relationType: "quote" }))
      ].map((entry) => {
        const childId = String(entry?.tweet?.id || "");
        return childId ? {
          id: childId,
          parentId,
          relationType: entry.relationType,
          tweet: entry.tweet
        } : null;
      }).filter(Boolean).filter((entry) => !selectedIds.has(entry.id)).filter((entry) => {
        if (isLowSignalTweet(entry.tweet, config.minSubstantiveChars)) {
          return false;
        }
        const metrics = getSubstantiveTextMetrics(entry.tweet);
        const hasHighEngagement = (Number(entry.tweet?.likes || 0) >= 20) || (Number(entry.tweet?.quote_count || 0) >= 5);
        if (metrics.substantiveChars < config.minSubstantiveChars && !hasHighEngagement) {
          return false;
        }
        entry.importanceScore = computeImportanceScore(entry.tweet, {
          minSubstantiveChars: config.minSubstantiveChars,
          relationType: entry.relationType,
          depth,
          isMandatoryPathChild: mandatoryPathSet.has(parentId)
        });
        return entry.importanceScore >= config.minImportanceScore;
      });

      bucket.sort((a, b) => {
        if (b.importanceScore !== a.importanceScore) {
          return b.importanceScore - a.importanceScore;
        }
        return String(a.id).localeCompare(String(b.id));
      });
      perParentBuckets.push(bucket.slice(0, config.maxChildrenPerNode));
    }

    const chosen = [];
    const remainingBudget = Math.max(0, config.maxTotalTweets - selectedIds.size);
    let anyAdded = true;
    let round = 0;

    while (chosen.length < remainingBudget && anyAdded) {
      anyAdded = false;
      for (const bucket of perParentBuckets) {
        const candidate = bucket[round];
        if (!candidate) {
          continue;
        }
        if (selectedIds.has(candidate.id) || chosen.some((entry) => entry.id === candidate.id)) {
          continue;
        }
        chosen.push(candidate);
        anyAdded = true;
        if (chosen.length >= remainingBudget) {
          break;
        }
      }
      round += 1;
    }

    if (chosen.length === 0) {
      break;
    }

    expansions.push({
      depth,
      tweets: chosen.map((entry) => ({
        id: entry.id,
        parentId: entry.parentId,
        relationType: entry.relationType,
        importanceScore: entry.importanceScore
      }))
    });

    frontier = chosen.map((entry) => entry.tweet);
    for (const entry of chosen) {
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
      "Diversity-biased selector that allocates child picks round-robin across open parents."
    ]
  });
}

module.exports = {
  algorithmId: ALGORITHM_ID,
  defaultParams: {
    ...DEFAULT_PARAMS
  },
  label: "Quota Per Parent",
  description: "Balanced selector that preserves coverage across open frontier parents before filling extra slots.",
  select
};
