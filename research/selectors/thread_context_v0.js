"use strict";

const {
  buildChildrenIndex,
  buildPathAnchoredSelection,
  buildTweetIndex,
  collectCanonicalReferences,
  collectCanonicalTweetReferences,
  isHumanTweet
} = require("../../server/path_anchored_snapshot.js");

const ALGORITHM_ID = "thread_context_v0";
const DEFAULT_PARAMS = {
  maxDepth: 3,
  maxChildrenPerNode: 4,
  maxTotalTweets: 40,
  minSubstantiveChars: 120,
  minImportanceScore: 3.2,
  maxThreadTweetsPerAnchor: 3,
  maxAddedThreadTweets: 12
};

function mergeParams(params = {}) {
  return {
    ...DEFAULT_PARAMS,
    ...(params || {})
  };
}

function toTimestamp(tweet) {
  const value = Date.parse(String(tweet?.created_at || ""));
  return Number.isFinite(value) ? value : null;
}

function sameAuthor(a, b) {
  return String(a?.author || "").trim() && String(a?.author || "").trim() === String(b?.author || "").trim();
}

function sortSameAuthorChildren(children) {
  return [...children].sort((a, b) => {
    const aTime = toTimestamp(a);
    const bTime = toTimestamp(b);
    if (aTime !== null && bTime !== null && aTime !== bTime) {
      return aTime - bTime;
    }
    const aLikes = Number(a?.likes || 0);
    const bLikes = Number(b?.likes || 0);
    if (bLikes !== aLikes) {
      return bLikes - aLikes;
    }
    return String(a?.id || "").localeCompare(String(b?.id || ""));
  });
}

function findThreadParent(tweet, tweetById) {
  const parentId = String(tweet?.reply_to || "").trim();
  if (!parentId || !tweetById.has(parentId)) {
    return null;
  }
  const parent = tweetById.get(parentId);
  return sameAuthor(tweet, parent) ? parent : null;
}

function findThreadChildren(tweet, repliesByParentId) {
  const tweetId = String(tweet?.id || "").trim();
  if (!tweetId) {
    return [];
  }
  const children = repliesByParentId.get(tweetId) || [];
  return sortSameAuthorChildren(children.filter((child) => sameAuthor(tweet, child)));
}

function completeThreadAroundAnchor(anchor, { tweetById, repliesByParentId, alreadyAddedCount = 0, selectedSet, config, scoreById }) {
  const added = [];
  const remainingGlobalBudget = Math.max(0, config.maxAddedThreadTweets - alreadyAddedCount);
  if (remainingGlobalBudget <= 0) {
    return added;
  }

  const anchorId = String(anchor?.id || "");
  const anchorScore = Number(scoreById.get(anchorId) || 0);
  const localLimit = Math.max(0, Math.min(config.maxThreadTweetsPerAnchor, remainingGlobalBudget));

  let steps = 0;
  let current = anchor;
  while (steps < localLimit) {
    const parent = findThreadParent(current, tweetById);
    if (!parent) {
      break;
    }
    const parentId = String(parent.id);
    if (!selectedSet.has(parentId)) {
      added.push({
        id: parentId,
        parentId: anchorId,
        relationType: "thread_prev",
        importanceScore: Math.max(0, anchorScore - (steps + 1) * 0.08),
        tweet: parent
      });
      selectedSet.add(parentId);
    }
    current = parent;
    steps += 1;
  }

  steps = 0;
  current = anchor;
  while (steps < localLimit) {
    const next = findThreadChildren(current, repliesByParentId).find((candidate) => !selectedSet.has(String(candidate.id)));
    if (!next) {
      break;
    }
    const nextId = String(next.id);
    added.push({
      id: nextId,
      parentId: String(current.id),
      relationType: "thread_next",
      importanceScore: Math.max(0, anchorScore - (steps + 1) * 0.05),
      tweet: next
    });
    selectedSet.add(nextId);
    current = next;
    steps += 1;
  }

  return added;
}

function select({ dataset, clickedTweetId = null, rootHintTweetId = null, params = {} } = {}) {
  const config = mergeParams(params);
  const baseSelection = buildPathAnchoredSelection(dataset, {
    clickedTweetId,
    rootHintTweetId,
    maxDepth: config.maxDepth,
    maxChildrenPerNode: config.maxChildrenPerNode,
    maxTotalTweets: config.maxTotalTweets,
    minSubstantiveChars: config.minSubstantiveChars,
    minImportanceScore: config.minImportanceScore
  });

  const sourceTweets = Array.isArray(dataset?.tweets) ? dataset.tweets.filter(isHumanTweet) : [];
  const tweetById = buildTweetIndex(sourceTweets);
  const { repliesByParentId } = buildChildrenIndex(tweetById);
  const selectedIds = [...new Set((baseSelection.selectedTweetIds || []).map((id) => String(id || "")).filter(Boolean))];
  const selectedSet = new Set(selectedIds);
  const scoreById = new Map(baseSelection.scoreById instanceof Map ? baseSelection.scoreById : []);
  const selectedTweets = selectedIds.map((id) => tweetById.get(id)).filter(Boolean);
  const anchors = [...selectedTweets].sort((a, b) => {
    const aScore = Number(scoreById.get(String(a?.id || "")) || 0);
    const bScore = Number(scoreById.get(String(b?.id || "")) || 0);
    if (bScore !== aScore) {
      return bScore - aScore;
    }
    return String(a?.id || "").localeCompare(String(b?.id || ""));
  });

  const maxExtra = Math.max(0, Math.min(
    Number(config.maxAddedThreadTweets || 0),
    Math.max(0, Number(config.maxTotalTweets || 0) - selectedSet.size)
  ));

  const threadAdds = [];
  for (const anchor of anchors) {
    if (threadAdds.length >= maxExtra) {
      break;
    }
    const additions = completeThreadAroundAnchor(anchor, {
      tweetById,
      repliesByParentId,
      alreadyAddedCount: threadAdds.length,
      selectedSet,
      config: {
        ...config,
        maxAddedThreadTweets: maxExtra
      },
      scoreById
    });
    for (const entry of additions) {
      if (threadAdds.length >= maxExtra) {
        break;
      }
      threadAdds.push(entry);
      scoreById.set(entry.id, entry.importanceScore);
    }
  }

  const finalSelectedIds = new Set(selectedIds);
  for (const entry of threadAdds) {
    finalSelectedIds.add(entry.id);
  }

  const expansions = Array.isArray(baseSelection.expansions) ? baseSelection.expansions.map((level) => ({
    depth: Number(level?.depth || 0),
    tweets: Array.isArray(level?.tweets) ? level.tweets.map((entry) => ({ ...entry })) : []
  })) : [];
  if (threadAdds.length > 0) {
    expansions.push({
      depth: expansions.length + 1,
      tweets: threadAdds.map((entry) => ({
        id: entry.id,
        parentId: entry.parentId,
        relationType: entry.relationType,
        importanceScore: entry.importanceScore
      }))
    });
  }

  const selectedTweetIds = [...finalSelectedIds];
  const selectedTweetsOut = sourceTweets.filter((tweet) => finalSelectedIds.has(String(tweet.id)));
  const references = collectCanonicalReferences(selectedTweetsOut, scoreById);
  const tweetReferences = collectCanonicalTweetReferences(selectedTweetsOut, scoreById, tweetById);

  if (threadAdds.length > 0) {
    return {
      ...baseSelection,
      algorithmId: ALGORITHM_ID,
      params: {
        ...config
      },
      tweets: selectedTweetsOut,
      selectedTweetIds,
      scoreById,
      expansions,
      references,
      tweetReferences,
      diagnostics: {
        ...(baseSelection.diagnostics || {}),
        selectedTweetCount: selectedTweetsOut.length,
        expansionDepthCount: expansions.length,
        referenceCount: references.length,
        tweetReferenceCount: tweetReferences.length,
        notes: [
          ...(Array.isArray(baseSelection?.diagnostics?.notes) ? baseSelection.diagnostics.notes : []),
          `Completed bounded same-author thread context around selected anchors (+${threadAdds.length} tweets).`
        ]
      }
    };
  }

  return {
    ...baseSelection,
    algorithmId: ALGORITHM_ID,
    params: {
      ...config
    },
    diagnostics: {
      ...(baseSelection.diagnostics || {}),
      notes: [
        ...(Array.isArray(baseSelection?.diagnostics?.notes) ? baseSelection.diagnostics.notes : []),
        "Completed bounded same-author thread context around selected anchors (+0 tweets)."
      ]
    }
  };
}

module.exports = {
  algorithmId: ALGORITHM_ID,
  defaultParams: {
    ...DEFAULT_PARAMS
  },
  label: "Thread Context",
  description: "Path-first selector with bounded same-author thread completion around the chosen anchors.",
  select
};
