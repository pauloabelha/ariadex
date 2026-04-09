"use strict";

const { canonicalizeUrl, extractUrlsFromText } = require("../ui/panel_renderer.js");

const DEFAULT_OPTIONS = {
  maxDepth: 3,
  maxChildrenPerNode: 4,
  maxTotalTweets: 40,
  minSubstantiveChars: 120,
  minImportanceScore: 3.2
};

function cleanText(text) {
  return String(text || "").trim();
}

function stripUrls(text) {
  return String(text || "").replace(/https?:\/\/\S+/gi, " ").trim();
}

function stripMentions(text) {
  return String(text || "").replace(/@[a-z0-9_]{1,15}/gi, " ").trim();
}

function normalizeOptions(options = {}) {
  return {
    maxDepth: Math.max(1, Math.min(5, Math.floor(Number(options.maxDepth) || DEFAULT_OPTIONS.maxDepth))),
    maxChildrenPerNode: Math.max(1, Math.min(10, Math.floor(Number(options.maxChildrenPerNode) || DEFAULT_OPTIONS.maxChildrenPerNode))),
    maxTotalTweets: Math.max(5, Math.min(200, Math.floor(Number(options.maxTotalTweets) || DEFAULT_OPTIONS.maxTotalTweets))),
    minSubstantiveChars: Math.max(40, Math.min(500, Math.floor(Number(options.minSubstantiveChars) || DEFAULT_OPTIONS.minSubstantiveChars))),
    minImportanceScore: Number.isFinite(Number(options.minImportanceScore))
      ? Number(options.minImportanceScore)
      : DEFAULT_OPTIONS.minImportanceScore
  };
}

function isHumanTweet(tweet) {
  if (!tweet?.id) {
    return false;
  }
  const id = String(tweet.id);
  if (id.startsWith("repost:") || id.startsWith("author_thread:")) {
    return false;
  }
  return Boolean(cleanText(tweet.text));
}

function getParentId(tweet) {
  if (!tweet) {
    return null;
  }
  return tweet.quote_of || tweet.reply_to || null;
}

function getParentCandidates(tweet) {
  if (!tweet || typeof tweet !== "object") {
    return [];
  }

  const candidates = [];
  const pushCandidate = (value) => {
    const normalized = String(value || "").trim();
    if (!normalized || candidates.includes(normalized)) {
      return;
    }
    candidates.push(normalized);
  };

  pushCandidate(tweet.quote_of);
  pushCandidate(tweet.reply_to);

  const references = Array.isArray(tweet.referenced_tweets) ? tweet.referenced_tweets : [];
  for (const reference of references) {
    if (String(reference?.type || "").trim().toLowerCase() === "quoted") {
      pushCandidate(reference?.id);
    }
  }
  for (const reference of references) {
    if (String(reference?.type || "").trim().toLowerCase() === "replied_to") {
      pushCandidate(reference?.id);
    }
  }

  return candidates;
}

function resolveParentId(tweet, tweetById, { preferredParentId = null } = {}) {
  const candidates = getParentCandidates(tweet);
  const preferred = String(preferredParentId || "").trim();

  if (preferred && tweetById.has(preferred) && candidates.includes(preferred)) {
    return preferred;
  }

  for (const candidateId of candidates) {
    if (tweetById.has(candidateId)) {
      return candidateId;
    }
  }

  return candidates[0] || null;
}

function buildTweetIndex(tweets) {
  const byId = new Map();
  for (const tweet of Array.isArray(tweets) ? tweets : []) {
    if (tweet?.id && !byId.has(String(tweet.id))) {
      byId.set(String(tweet.id), tweet);
    }
  }
  return byId;
}

function buildMandatoryPath(tweetById, clickedTweetId, fallbackRootId = null, options = {}) {
  const out = [];
  const seen = new Set();
  let currentId = String(clickedTweetId || fallbackRootId || "").trim();
  const preferredFirstHopParentId = String(options?.rootHintTweetId || "").trim();

  while (currentId && tweetById.has(currentId) && !seen.has(currentId)) {
    const tweet = tweetById.get(currentId);
    seen.add(currentId);
    out.push(tweet);
    currentId = String(resolveParentId(tweet, tweetById, {
      preferredParentId: out.length === 1 ? preferredFirstHopParentId : null
    }) || "").trim();
  }

  const fallbackId = String(fallbackRootId || "").trim();
  if (fallbackId && tweetById.has(fallbackId) && !seen.has(fallbackId)) {
    out.push(tweetById.get(fallbackId));
  }

  return out.reverse();
}

function buildChildrenIndex(tweetById) {
  const repliesByParentId = new Map();
  const quotesByParentId = new Map();

  const push = (map, key, tweet) => {
    const normalized = String(key || "").trim();
    if (!normalized) {
      return;
    }
    if (!map.has(normalized)) {
      map.set(normalized, []);
    }
    map.get(normalized).push(tweet);
  };

  for (const tweet of tweetById.values()) {
    if (!isHumanTweet(tweet)) {
      continue;
    }
    if (tweet.reply_to && tweetById.has(String(tweet.reply_to))) {
      push(repliesByParentId, tweet.reply_to, tweet);
    }
    if (tweet.quote_of && tweetById.has(String(tweet.quote_of))) {
      push(quotesByParentId, tweet.quote_of, tweet);
    }
  }

  return {
    repliesByParentId,
    quotesByParentId
  };
}

function getSubstantiveTextMetrics(tweet) {
  const rawText = cleanText(tweet?.text || "");
  const withoutUrls = stripUrls(rawText);
  const withoutMentions = stripMentions(withoutUrls).replace(/\s+/g, " ").trim();
  return {
    rawText,
    withoutUrls,
    withoutMentions,
    substantiveChars: withoutMentions.length
  };
}

function isLowSignalTweet(tweet, minSubstantiveChars) {
  const { rawText, withoutMentions, substantiveChars } = getSubstantiveTextMetrics(tweet);
  const lowered = withoutMentions.toLowerCase();
  if (!rawText) {
    return true;
  }
  if (/^@threadreaderapp\b/i.test(rawText)) {
    return true;
  }
  if (/^please\s+#unroll\b/i.test(lowered)) {
    return true;
  }
  if (/^(wow|true|based|nice|cool|thanks|thank you|interesting|oblong|yup|yep|indeed|great thread)\W*$/i.test(lowered)) {
    return true;
  }
  if (substantiveChars < Math.max(18, Math.floor(minSubstantiveChars * 0.35)) && /^@/i.test(rawText)) {
    return true;
  }
  return false;
}

function computeImportanceScore(tweet, { minSubstantiveChars, relationType = "reply", depth = 1, isMandatoryPathChild = false } = {}) {
  const followers = Number(tweet?.author_profile?.public_metrics?.followers_count || 0);
  const likes = Number(tweet?.likes || 0);
  const quotes = Number(tweet?.quote_count || 0);
  const replies = Number(tweet?.replies || 0);
  const { substantiveChars } = getSubstantiveTextMetrics(tweet);
  const substanceScore = substantiveChars / Math.max(1, minSubstantiveChars);
  const relationBonus = relationType === "quote" ? 0.45 : 0.25;
  const pathBonus = isMandatoryPathChild ? 0.4 : 0;
  const depthPenalty = Math.max(0, depth - 1) * 0.35;
  return (
    (Math.log1p(Math.max(0, likes)) * 0.9)
    + (Math.log1p(Math.max(0, quotes)) * 1.35)
    + (Math.log1p(Math.max(0, replies)) * 0.4)
    + (Math.log1p(Math.max(0, followers)) * 0.28)
    + substanceScore
    + relationBonus
    + pathBonus
    - depthPenalty
  );
}

function classifyReference(url) {
  const canonical = canonicalizeUrl(url);
  if (!canonical) {
    return null;
  }
  try {
    const parsed = new URL(canonical);
    const host = String(parsed.hostname || "").toLowerCase();
    const pathname = String(parsed.pathname || "").toLowerCase();
    const isXArticle = (host === "x.com" || host === "twitter.com") && /^\/i\/article\/\d+/.test(pathname);
    if (
      (!isXArticle && host === "x.com")
      || (!isXArticle && host === "twitter.com")
      || host.endsWith(".x.com")
      || host.endsWith(".twitter.com")
      || host === "t.co"
    ) {
      return null;
    }

    let kind = "web";
    if (isXArticle) {
      kind = "document";
    } else if (pathname.endsWith(".pdf") || host.includes("arxiv.org") || host.includes("doi.org")) {
      kind = "document";
    } else if (host.includes("youtube.com") || host.includes("youtu.be") || host.includes("vimeo.com")) {
      kind = "video";
    } else if (host.includes("loom.com")) {
      kind = "video";
    } else if (host.includes("github.com") || host.includes("gitlab.com")) {
      kind = "document";
    } else if (host.includes("docs.") || pathname.includes("/docs/")) {
      kind = "document";
    }

    return {
      canonicalUrl: canonical,
      displayUrl: canonical,
      domain: host.replace(/^www\./, ""),
      kind
    };
  } catch {
    return null;
  }
}

function classifyTweetReference(url) {
  const canonical = canonicalizeUrl(url);
  if (!canonical) {
    return null;
  }

  try {
    const parsed = new URL(canonical);
    const host = String(parsed.hostname || "").toLowerCase();
    if (
      !(host === "x.com" || host === "twitter.com" || host.endsWith(".x.com") || host.endsWith(".twitter.com"))
    ) {
      return null;
    }

    const pathname = String(parsed.pathname || "");
    const internalMatch = pathname.match(/^\/i\/status\/(\d+)/);
    const statusMatch = internalMatch ? null : pathname.match(/^\/([^/]+)\/status\/(\d+)/);
    if (!statusMatch && !internalMatch) {
      return null;
    }

    const handle = statusMatch ? String(statusMatch[1] || "").trim().toLowerCase() : "i";
    const tweetId = statusMatch ? String(statusMatch[2] || "").trim() : String(internalMatch[1] || "").trim();
    if (!tweetId) {
      return null;
    }

    return {
      canonicalUrl: statusMatch ? `https://x.com/${handle}/status/${tweetId}` : `https://x.com/i/status/${tweetId}`,
      displayUrl: statusMatch ? `https://x.com/${handle}/status/${tweetId}` : `https://x.com/i/status/${tweetId}`,
      tweetId,
      handle: statusMatch ? handle : null
    };
  } catch {
    return null;
  }
}

function collectCanonicalReferences(selectedTweets, scoreById) {
  const byUrl = new Map();

  for (const tweet of Array.isArray(selectedTweets) ? selectedTweets : []) {
    if (!tweet?.id) {
      continue;
    }
    const textUrls = tweet?.text ? extractUrlsFromText(tweet.text) : [];
    const entityUrls = Array.isArray(tweet?.external_urls) ? tweet.external_urls : [];
    const canonicalRefs = [...new Set(
      [...textUrls, ...entityUrls]
        .map(classifyReference)
        .filter(Boolean)
        .map((ref) => ref.canonicalUrl)
    )];

    for (const canonicalUrl of canonicalRefs) {
      const classified = classifyReference(canonicalUrl);
      if (!classified) {
        continue;
      }
      if (!byUrl.has(canonicalUrl)) {
        byUrl.set(canonicalUrl, {
          ...classified,
          citationCount: 0,
          weightedCitationScore: 0,
          citedByTweetIds: []
        });
      }
      const entry = byUrl.get(canonicalUrl);
      entry.citationCount += 1;
      entry.weightedCitationScore += Number(scoreById.get(String(tweet.id)) || 0);
      entry.citedByTweetIds.push(String(tweet.id));
    }
  }

  return [...byUrl.values()]
    .map((entry) => ({
      ...entry,
      citedByTweetIds: [...new Set(entry.citedByTweetIds)]
    }))
    .sort((a, b) => {
      if (b.weightedCitationScore !== a.weightedCitationScore) {
        return b.weightedCitationScore - a.weightedCitationScore;
      }
      if (b.citationCount !== a.citationCount) {
        return b.citationCount - a.citationCount;
      }
      return String(a.canonicalUrl).localeCompare(String(b.canonicalUrl));
    });
}

function collectCanonicalTweetReferences(selectedTweets, scoreById, tweetById) {
  const byTweetId = new Map();

  for (const tweet of Array.isArray(selectedTweets) ? selectedTweets : []) {
    if (!tweet?.id) {
      continue;
    }

    const textUrls = tweet?.text ? extractUrlsFromText(tweet.text) : [];
    const entityUrls = Array.isArray(tweet?.external_urls) ? tweet.external_urls : [];
    const canonicalRefs = [...new Map(
      [...textUrls, ...entityUrls]
        .map(classifyTweetReference)
        .filter(Boolean)
        .map((ref) => [ref.tweetId, ref])
    ).values()];

    for (const classified of canonicalRefs) {
      const linkedTweetId = String(classified.tweetId || "");
      if (!classified) {
        continue;
      }
      if (!byTweetId.has(linkedTweetId)) {
        byTweetId.set(linkedTweetId, {
          ...classified,
          citationCount: 0,
          weightedCitationScore: 0,
          citedByTweetIds: [],
          isInDataset: tweetById.has(String(linkedTweetId))
        });
      }
      const entry = byTweetId.get(linkedTweetId);
      entry.citationCount += 1;
      entry.weightedCitationScore += Number(scoreById.get(String(tweet.id)) || 0);
      entry.citedByTweetIds.push(String(tweet.id));
      entry.isInDataset = entry.isInDataset || tweetById.has(String(linkedTweetId));
    }
  }

  return [...byTweetId.values()]
    .map((entry) => ({
      ...entry,
      citedByTweetIds: [...new Set(entry.citedByTweetIds)]
    }))
    .sort((a, b) => {
      if (b.weightedCitationScore !== a.weightedCitationScore) {
        return b.weightedCitationScore - a.weightedCitationScore;
      }
      if (b.citationCount !== a.citationCount) {
        return b.citationCount - a.citationCount;
      }
      return String(a.tweetId).localeCompare(String(b.tweetId));
    });
}

function buildPathAnchoredSelection(dataset, options = {}) {
  const config = normalizeOptions(options);
  const sourceTweets = Array.isArray(dataset?.tweets) ? dataset.tweets.filter(isHumanTweet) : [];
  const tweetById = buildTweetIndex(sourceTweets);
  const fallbackRootId = String(dataset?.canonicalRootId || dataset?.rootTweet?.id || "").trim();
  const clickedTweetId = String(options.clickedTweetId || dataset?.clickedTweetId || fallbackRootId).trim();
  const rootHintTweetId = String(options.rootHintTweetId || dataset?.rootHintTweetId || "").trim();
  const mandatoryPath = buildMandatoryPath(tweetById, clickedTweetId, fallbackRootId, {
    rootHintTweetId
  });
  const { repliesByParentId, quotesByParentId } = buildChildrenIndex(tweetById);

  const selectedIds = new Set(mandatoryPath.map((tweet) => String(tweet.id)));
  const mandatoryPathSet = new Set(selectedIds);
  const scoreById = new Map();
  const selectedByDepth = [];

  let frontier = mandatoryPath.slice();
  for (let depth = 1; depth <= config.maxDepth && frontier.length > 0; depth += 1) {
    const candidateById = new Map();

    for (const parent of frontier) {
      const parentId = String(parent?.id || "");
      if (!parentId) {
        continue;
      }
      const typedChildren = [
        ...(repliesByParentId.get(parentId) || []).map((tweet) => ({ tweet, relationType: "reply" })),
        ...(quotesByParentId.get(parentId) || []).map((tweet) => ({ tweet, relationType: "quote" }))
      ];

      const perParent = [];
      for (const child of typedChildren) {
        const tweet = child.tweet;
        const childId = String(tweet?.id || "");
        if (!childId || selectedIds.has(childId)) {
          continue;
        }
        if (isLowSignalTweet(tweet, config.minSubstantiveChars)) {
          continue;
        }
        const metrics = getSubstantiveTextMetrics(tweet);
        const hasHighEngagement = (Number(tweet?.likes || 0) >= 20) || (Number(tweet?.quote_count || 0) >= 5);
        if (metrics.substantiveChars < config.minSubstantiveChars && !hasHighEngagement) {
          continue;
        }

        const importanceScore = computeImportanceScore(tweet, {
          minSubstantiveChars: config.minSubstantiveChars,
          relationType: child.relationType,
          depth,
          isMandatoryPathChild: mandatoryPathSet.has(parentId)
        });
        if (importanceScore < config.minImportanceScore) {
          continue;
        }
        perParent.push({
          id: childId,
          tweet,
          parentId,
          relationType: child.relationType,
          depth,
          importanceScore
        });
      }

      perParent.sort((a, b) => {
        if (b.importanceScore !== a.importanceScore) {
          return b.importanceScore - a.importanceScore;
        }
        return String(a.id).localeCompare(String(b.id));
      });

      for (const candidate of perParent.slice(0, config.maxChildrenPerNode)) {
        const existing = candidateById.get(candidate.id);
        if (!existing || existing.importanceScore < candidate.importanceScore) {
          candidateById.set(candidate.id, candidate);
        }
      }
    }

    const sortedCandidates = [...candidateById.values()].sort((a, b) => {
      if (b.importanceScore !== a.importanceScore) {
        return b.importanceScore - a.importanceScore;
      }
      return String(a.id).localeCompare(String(b.id));
    });

    const remainingBudget = Math.max(0, config.maxTotalTweets - selectedIds.size);
    const chosen = sortedCandidates.slice(0, remainingBudget);
    if (chosen.length === 0) {
      break;
    }

    selectedByDepth.push({
      depth,
      tweets: chosen.map((entry) => ({
        id: entry.id,
        parentId: entry.parentId,
        relationType: entry.relationType,
        importanceScore: entry.importanceScore
      }))
    });

    frontier = [];
    for (const candidate of chosen) {
      selectedIds.add(candidate.id);
      frontier.push(candidate.tweet);
      scoreById.set(candidate.id, candidate.importanceScore);
    }
  }

  const selectedTweets = sourceTweets.filter((tweet) => selectedIds.has(String(tweet.id)));
  for (const tweet of mandatoryPath) {
    if (!scoreById.has(String(tweet.id))) {
      scoreById.set(String(tweet.id), Number.MAX_SAFE_INTEGER / 1e12);
    }
  }
  const references = collectCanonicalReferences(selectedTweets, scoreById);
  const tweetReferences = collectCanonicalTweetReferences(selectedTweets, scoreById, tweetById);

  return {
    tweets: selectedTweets,
    mandatoryPathIds: mandatoryPath.map((tweet) => String(tweet.id)),
    selectedTweetIds: [...selectedIds],
    scoreById,
    expansions: selectedByDepth,
    references,
    tweetReferences,
    diagnostics: {
      totalSourceTweetCount: sourceTweets.length,
      selectedTweetCount: selectedTweets.length,
      mandatoryPathLength: mandatoryPath.length,
      referenceCount: references.length,
      tweetReferenceCount: tweetReferences.length
    }
  };
}

module.exports = {
  DEFAULT_OPTIONS,
  buildPathAnchoredSelection,
  buildChildrenIndex,
  buildMandatoryPath,
  buildTweetIndex,
  collectCanonicalReferences,
  collectCanonicalTweetReferences,
  classifyReference,
  classifyTweetReference,
  computeImportanceScore,
  getSubstantiveTextMetrics,
  isHumanTweet,
  isLowSignalTweet,
  normalizeOptions,
  resolveParentId
};
