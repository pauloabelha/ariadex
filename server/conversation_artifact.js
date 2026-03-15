"use strict";

function cleanText(text) {
  return String(text || "").trim();
}

function buildTweetById(tweets) {
  const out = new Map();
  for (const tweet of Array.isArray(tweets) ? tweets : []) {
    if (tweet?.id) {
      out.set(String(tweet.id), tweet);
    }
  }
  return out;
}

function deriveRootTweet(tweetById, mandatoryPathIds, canonicalRootId) {
  const pathIds = Array.isArray(mandatoryPathIds) ? mandatoryPathIds : [];
  if (pathIds.length > 0 && tweetById.has(String(pathIds[0]))) {
    return tweetById.get(String(pathIds[0])) || null;
  }
  const rootId = String(canonicalRootId || "").trim();
  return rootId ? (tweetById.get(rootId) || null) : null;
}

function toArtifactTweet(tweet, importanceScore = null) {
  return {
    id: String(tweet?.id || ""),
    author: String(tweet?.author || ""),
    text: cleanText(tweet?.text || ""),
    replyTo: tweet?.reply_to || null,
    quoteOf: tweet?.quote_of || null,
    likes: Number(tweet?.likes || 0),
    replies: Number(tweet?.replies || 0),
    quotes: Number(tweet?.quote_count || 0),
    followers: Number(tweet?.author_profile?.public_metrics?.followers_count || 0),
    importanceScore: Number.isFinite(Number(importanceScore)) ? Number(importanceScore) : null,
    url: tweet?.url || null
  };
}

function buildConversationArtifact({ dataset, selection, clickedTweetId = null, canonicalRootId = null } = {}) {
  const tweets = Array.isArray(selection?.tweets) ? selection.tweets : [];
  const tweetById = buildTweetById(tweets);
  const mandatoryPathIds = Array.isArray(selection?.mandatoryPathIds) ? selection.mandatoryPathIds : [];
  const selectedTweetIds = Array.isArray(selection?.selectedTweetIds) ? selection.selectedTweetIds : [];
  const rootTweet = deriveRootTweet(tweetById, mandatoryPathIds, canonicalRootId);
  const scoreById = selection?.scoreById instanceof Map ? selection.scoreById : new Map();

  const mandatoryPath = mandatoryPathIds
    .map((id) => tweetById.get(String(id)))
    .filter(Boolean)
    .map((tweet) => toArtifactTweet(tweet, scoreById.get(String(tweet.id))));

  const expansions = Array.isArray(selection?.expansions)
    ? selection.expansions.map((level) => ({
      depth: Number(level?.depth || 0),
      tweets: Array.isArray(level?.tweets)
        ? level.tweets.map((entry) => {
          const tweet = tweetById.get(String(entry?.id || ""));
          return tweet ? {
            ...toArtifactTweet(tweet, entry?.importanceScore),
            relationType: entry?.relationType || null,
            parentId: entry?.parentId || null
          } : null;
        }).filter(Boolean)
        : []
    }))
    : [];

  const selectedTweets = selectedTweetIds
    .map((id) => tweetById.get(String(id)))
    .filter(Boolean)
    .map((tweet) => toArtifactTweet(tweet, scoreById.get(String(tweet.id))));

  const references = Array.isArray(selection?.references)
    ? selection.references.map((ref) => ({
      canonicalUrl: String(ref?.canonicalUrl || ""),
      displayUrl: String(ref?.displayUrl || ref?.canonicalUrl || ""),
      domain: String(ref?.domain || ""),
      kind: String(ref?.kind || "web"),
      citationCount: Number(ref?.citationCount || 0),
      weightedCitationScore: Number(ref?.weightedCitationScore || 0),
      citedByTweetIds: Array.isArray(ref?.citedByTweetIds) ? ref.citedByTweetIds.map((id) => String(id)) : []
    }))
    : [];

  return {
    version: "path-anchored/v1",
    exploredTweetId: clickedTweetId ? String(clickedTweetId) : null,
    canonicalRootId: canonicalRootId ? String(canonicalRootId) : null,
    rootTweet: rootTweet ? toArtifactTweet(rootTweet, scoreById.get(String(rootTweet.id))) : null,
    mandatoryPath,
    expansions,
    selectedTweets,
    references,
    diagnostics: {
      totalCollectedTweetCount: Array.isArray(dataset?.tweets) ? dataset.tweets.length : 0,
      selectedTweetCount: selectedTweets.length,
      mandatoryPathLength: mandatoryPath.length,
      expansionDepthCount: expansions.length,
      referenceCount: references.length
    }
  };
}

module.exports = {
  buildConversationArtifact
};
