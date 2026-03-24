"use strict";

const {
  DEFAULT_OPTIONS,
  buildTweetIndex,
  collectCanonicalReferences,
  collectCanonicalTweetReferences,
  isHumanTweet
} = require("../../server/path_anchored_snapshot.js");

function normalizeSelectorContext({ dataset, clickedTweetId = null, rootHintTweetId = null } = {}) {
  const sourceTweets = Array.isArray(dataset?.tweets) ? dataset.tweets.filter(isHumanTweet) : [];
  const tweetById = buildTweetIndex(sourceTweets);
  const canonicalRootId = String(dataset?.canonicalRootId || dataset?.rootTweet?.id || "").trim() || null;
  return {
    dataset,
    sourceTweets,
    tweetById,
    clickedTweetId: String(clickedTweetId || dataset?.clickedTweetId || canonicalRootId || "").trim() || null,
    rootHintTweetId: String(rootHintTweetId || dataset?.rootHintTweetId || "").trim() || null,
    canonicalRootId
  };
}

function finalizeSelection({
  algorithmId,
  sourceTweets,
  tweetById,
  selectedIds,
  mandatoryPath,
  expansions = [],
  scoreById = new Map(),
  params = {},
  notes = []
} = {}) {
  const mandatoryPathIds = Array.isArray(mandatoryPath) ? mandatoryPath.map((tweet) => String(tweet?.id || "")).filter(Boolean) : [];
  const selectedTweetIds = [...new Set(
    (selectedIds instanceof Set ? [...selectedIds] : Array.isArray(selectedIds) ? selectedIds : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean)
  )];
  const selectedSet = new Set(selectedTweetIds);
  const selectedTweets = Array.isArray(sourceTweets) ? sourceTweets.filter((tweet) => selectedSet.has(String(tweet.id))) : [];

  for (const pathId of mandatoryPathIds) {
    if (!scoreById.has(pathId)) {
      scoreById.set(pathId, Number.MAX_SAFE_INTEGER / 1e12);
    }
  }

  const references = collectCanonicalReferences(selectedTweets, scoreById);
  const tweetReferences = collectCanonicalTweetReferences(selectedTweets, scoreById, tweetById);

  return {
    algorithmId: String(algorithmId || "unknown_selector"),
    params: {
      ...params
    },
    tweets: selectedTweets,
    mandatoryPathIds,
    selectedTweetIds,
    scoreById,
    expansions,
    references,
    tweetReferences,
    diagnostics: {
      totalSourceTweetCount: Array.isArray(sourceTweets) ? sourceTweets.length : 0,
      selectedTweetCount: selectedTweets.length,
      mandatoryPathLength: mandatoryPathIds.length,
      expansionDepthCount: Array.isArray(expansions) ? expansions.length : 0,
      referenceCount: references.length,
      tweetReferenceCount: tweetReferences.length,
      notes: Array.isArray(notes) ? notes.slice() : []
    }
  };
}

function mergeSelectorParams(defaultParams, params) {
  return {
    ...(defaultParams || DEFAULT_OPTIONS),
    ...(params || {})
  };
}

module.exports = {
  DEFAULT_OPTIONS,
  finalizeSelection,
  mergeSelectorParams,
  normalizeSelectorContext
};
