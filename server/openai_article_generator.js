"use strict";

const { canonicalizeUrl, extractUrlsFromText } = require("../ui/panel_renderer.js");

const DEFAULT_MODEL = process.env.ARIADEX_OPENAI_ARTICLE_MODEL || process.env.ARIADEX_OPENAI_MODEL || "gpt-4o-mini";
const DEFAULT_ENDPOINT = process.env.ARIADEX_OPENAI_BASE_URL || "https://api.openai.com/v1";
const ARTICLE_GENERATOR_VERSION = "v2";

function cleanTweetText(text) {
  return String(text || "").trim();
}

function stripUrls(text) {
  return String(text || "").replace(/https?:\/\/\S+/gi, " ").trim();
}

function stripMentions(text) {
  return String(text || "").replace(/@[a-z0-9_]{1,15}/gi, " ").trim();
}

function isExternalReferenceUrl(rawUrl) {
  const canonical = canonicalizeUrl(rawUrl);
  if (!canonical) {
    return false;
  }
  try {
    const parsed = new URL(canonical);
    const host = String(parsed.hostname || "").toLowerCase();
    return !(
      host === "t.co"
      || host === "x.com"
      || host === "twitter.com"
      || host.endsWith(".x.com")
      || host.endsWith(".twitter.com")
    );
  } catch {
    return false;
  }
}

function createReferenceEntries(tweets, scoreById) {
  const byUrl = new Map();

  for (const tweet of Array.isArray(tweets) ? tweets : []) {
    if (!tweet || !tweet.id || !tweet.text) {
      continue;
    }
    const urls = extractUrlsFromText(tweet.text).filter(isExternalReferenceUrl);
    const uniqueUrls = [...new Set(urls.map((url) => canonicalizeUrl(url)).filter(Boolean))];
    for (const canonicalUrl of uniqueUrls) {
      if (!byUrl.has(canonicalUrl)) {
        let domain = "";
        try {
          domain = new URL(canonicalUrl).hostname.replace(/^www\./, "");
        } catch {}
        byUrl.set(canonicalUrl, {
          canonicalUrl,
          displayUrl: canonicalUrl,
          domain,
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

function isHumanTweet(tweet) {
  if (!tweet || !tweet.id) {
    return false;
  }
  const id = String(tweet.id);
  if (id.startsWith("repost:") || id.startsWith("author_thread:")) {
    return false;
  }
  const text = String(tweet.text || "").trim();
  return Boolean(text);
}

function normalizeMatchText(text) {
  return String(text || "")
    .trim()
    .replace(/\u2026/g, "...")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function getTweetPriority(entry, tweet) {
  const followers = Number(tweet?.author_profile?.public_metrics?.followers_count || 0);
  const likes = Number(tweet?.likes || 0);
  const reposts = Number(tweet?.reposts || 0);
  const replies = Number(tweet?.replies || 0);
  const quotes = Number(tweet?.quote_count || 0);
  const score = Number(entry?.score || 0);
  const rtPenalty = /^rt\s+@/i.test(String(tweet?.text || "").trim()) ? -0.15 : 0;
  return score
    + (Math.log1p(Math.max(0, followers)) * 0.01)
    + (Math.log1p(Math.max(0, likes + reposts + replies + quotes)) * 0.02)
    + rtPenalty;
}

function toArticleTweet(entry, tweet) {
  return {
    id: String(tweet.id),
    author: String(tweet.author || ""),
    text: cleanTweetText(tweet.text),
    score: Number(entry?.score || 0),
    reply_to: tweet.reply_to || null,
    quote_of: tweet.quote_of || null,
    followers: Number(tweet?.author_profile?.public_metrics?.followers_count || 0),
    likes: Number(tweet?.likes || 0),
    reposts: Number(tweet?.reposts || 0),
    replies: Number(tweet?.replies || 0),
    quote_count: Number(tweet?.quote_count || 0)
  };
}

function isLikelyLowSignalTweet(tweet) {
  const text = cleanTweetText(tweet?.text || "");
  if (!text) {
    return true;
  }

  const withoutUrls = stripUrls(text);
  const withoutMentions = stripMentions(withoutUrls).replace(/\s+/g, " ").trim();
  const lowered = withoutMentions.toLowerCase();

  if (/^@threadreaderapp\b/i.test(text)) {
    return true;
  }
  if (/^please\s+#unroll\b/i.test(lowered)) {
    return true;
  }
  if (/^(wow|true|based|oblong|interesting|cool|nice|thanks|thank you|yup|yep|indeed|exactly right!?|💯|‼️+)\W*$/i.test(lowered)) {
    return true;
  }
  if (!withoutMentions && extractUrlsFromText(text).length > 0) {
    return true;
  }
  if (withoutMentions.length < 18 && /^@/i.test(text)) {
    return true;
  }
  if (withoutMentions.length < 40 && extractUrlsFromText(text).length > 0) {
    return true;
  }

  return false;
}

function buildDistanceFromAnchors(tweetsById, anchorIds = []) {
  const distanceById = new Map();
  const queue = [];
  const anchors = [...new Set(anchorIds.map((id) => String(id || "").trim()).filter(Boolean))];
  if (anchors.length === 0) {
    return distanceById;
  }

  const childrenByParent = new Map();
  for (const tweet of tweetsById.values()) {
    if (!tweet?.id) {
      continue;
    }
    const childId = String(tweet.id);
    for (const parentId of [tweet.reply_to, tweet.quote_of]) {
      const normalizedParent = String(parentId || "").trim();
      if (!normalizedParent) {
        continue;
      }
      if (!childrenByParent.has(normalizedParent)) {
        childrenByParent.set(normalizedParent, []);
      }
      childrenByParent.get(normalizedParent).push(childId);
    }
  }

  for (const anchorId of anchors) {
    distanceById.set(anchorId, 0);
    queue.push(anchorId);
  }

  while (queue.length > 0) {
    const currentId = queue.shift();
    const currentDistance = distanceById.get(currentId) || 0;
    const children = childrenByParent.get(currentId) || [];
    for (const childId of children) {
      const nextDistance = currentDistance + 1;
      if (distanceById.has(childId) && distanceById.get(childId) <= nextDistance) {
        continue;
      }
      distanceById.set(childId, nextDistance);
      queue.push(childId);
    }
  }

  return distanceById;
}

function resolveCanonicalRootTweet({ tweetsById, snapshot, dataset }) {
  const canonicalRootId = String(snapshot?.canonicalRootId || dataset?.canonicalRootId || "").trim();
  if (canonicalRootId && tweetsById.has(canonicalRootId)) {
    return tweetsById.get(canonicalRootId) || null;
  }
  const datasetRootId = String(dataset?.rootTweet?.id || "").trim();
  if (datasetRootId && !datasetRootId.startsWith("author_thread:")) {
    return dataset.rootTweet;
  }
  const snapshotRootId = String(snapshot?.root?.id || "").trim();
  if (snapshotRootId && !snapshotRootId.startsWith("author_thread:")) {
    return snapshot.root;
  }
  return dataset?.rootTweet || snapshot?.root || null;
}

function collectTopTweets(snapshot, tweetsById, pinnedTweetIds = [], preferredIds = []) {
  const ranking = Array.isArray(snapshot?.ranking) ? snapshot.ranking : [];
  const out = [];
  const seenIds = new Set();
  const authorCounts = new Map();
  const preferredSet = new Set(preferredIds.map((id) => String(id || "").trim()).filter(Boolean));
  const queued = ranking
    .map((entry) => {
      const id = String(entry?.id || "");
      const tweet = tweetsById.get(id);
      if (!isHumanTweet(tweet)) {
        return null;
      }
      const informativeBonus = isLikelyLowSignalTweet(tweet) ? -1.5 : 0;
      const preferredBonus = preferredSet.has(id) ? 0.75 : 0;
      return {
        entry,
        tweet,
        priority: getTweetPriority(entry, tweet) + informativeBonus + preferredBonus
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return String(a.tweet.id).localeCompare(String(b.tweet.id));
    });

  const pushTweet = (entry, tweet) => {
    const id = String(tweet.id);
    if (seenIds.has(id)) {
      return false;
    }
    if (isLikelyLowSignalTweet(tweet) && !preferredSet.has(id)) {
      return false;
    }
    const author = String(tweet.author || "");
    const authorCount = authorCounts.get(author) || 0;
    if (authorCount >= 2) {
      return false;
    }
    seenIds.add(id);
    authorCounts.set(author, authorCount + 1);
    out.push(toArticleTweet(entry, tweet));
    return true;
  };

  for (const pinnedId of pinnedTweetIds) {
    const normalizedId = String(pinnedId || "").trim();
    if (!normalizedId) {
      continue;
    }
    const candidate = queued.find((item) => String(item.tweet.id) === normalizedId);
    if (candidate) {
      pushTweet(candidate.entry, candidate.tweet);
      continue;
    }
    const tweet = tweetsById.get(normalizedId);
    if (isHumanTweet(tweet)) {
      pushTweet({ id: normalizedId, score: 0 }, tweet);
    }
  }

  for (const candidate of queued) {
    const author = String(candidate.tweet.author || "");
    const authorCount = authorCounts.get(author) || 0;
    if (out.length < 12 && authorCount > 0) {
      continue;
    }
    pushTweet(candidate.entry, candidate.tweet);
    if (out.length >= 12) {
      return out;
    }
  }

  for (const candidate of queued) {
    pushTweet(candidate.entry, candidate.tweet);
    if (out.length >= 12) {
      break;
    }
  }

  return out;
}

function buildSourceTweetPool(tweets, topTweets, seedTweet, rootTweet) {
  const pool = [];
  const seenIds = new Set();
  const addTweet = (tweet) => {
    if (!tweet || !tweet.id || seenIds.has(String(tweet.id)) || !isHumanTweet(tweet)) {
      return;
    }
    seenIds.add(String(tweet.id));
    pool.push({
      id: String(tweet.id),
      author: String(tweet.author || "").trim(),
      text: cleanTweetText(tweet.text)
    });
  };

  addTweet(seedTweet);
  addTweet(rootTweet);
  for (const tweet of topTweets) {
    addTweet(tweet);
  }
  for (const tweet of Array.isArray(tweets) ? tweets : []) {
    addTweet(tweet);
    if (pool.length >= 60) {
      break;
    }
  }
  return pool;
}

function buildQuoteBlock(author, text) {
  const normalizedText = String(text || "").trim();
  if (!normalizedText) {
    return "";
  }
  const normalizedAuthor = String(author || "").trim();
  return normalizedAuthor
    ? `${normalizedAuthor} wrote:\n\n"${normalizedText}"`
    : `"${normalizedText}"`;
}

function buildArticleInput({ dataset, snapshot, clickedTweetId = null }) {
  const artifact = snapshot?.pathAnchored?.artifact || null;
  const selectedTweetIds = new Set(
    Array.isArray(snapshot?.pathAnchored?.selectedTweetIds)
      ? snapshot.pathAnchored.selectedTweetIds.map((id) => String(id || "").trim()).filter(Boolean)
      : []
  );
  const datasetTweets = Array.isArray(dataset?.tweets) ? dataset.tweets.filter(isHumanTweet) : [];
  const tweets = selectedTweetIds.size > 0
    ? datasetTweets.filter((tweet) => selectedTweetIds.has(String(tweet.id)))
    : datasetTweets;
  const tweetsById = new Map();
  for (const tweet of tweets) {
    tweetsById.set(String(tweet.id), tweet);
  }

  const scoreById = new Map();
  for (const entry of Array.isArray(snapshot?.ranking) ? snapshot.ranking : []) {
    if (entry?.id) {
      scoreById.set(String(entry.id), Number(entry.score || 0));
    }
  }

  const references = Array.isArray(snapshot?.pathAnchored?.references) && snapshot.pathAnchored.references.length > 0
    ? snapshot.pathAnchored.references.slice(0, 8)
    : createReferenceEntries(tweets, scoreById).slice(0, 8);
  const normalizedClickedTweetId = String(clickedTweetId || "").trim();
  const seedTweet = normalizedClickedTweetId ? (tweetsById.get(normalizedClickedTweetId) || null) : null;
  const rootTweet = resolveCanonicalRootTweet({ tweetsById, snapshot, dataset });
  const distanceById = buildDistanceFromAnchors(tweetsById, [
    seedTweet?.id || null,
    rootTweet?.id || null
  ]);
  const preferredIds = [...distanceById.entries()]
    .filter(([, distance]) => Number.isFinite(distance) && distance <= 2)
    .sort((a, b) => {
      if (a[1] !== b[1]) {
        return a[1] - b[1];
      }
      return String(a[0]).localeCompare(String(b[0]));
    })
    .map(([id]) => id);
  const topTweets = collectTopTweets(snapshot, tweetsById, [
    seedTweet?.id || null,
    rootTweet?.id || null
  ], preferredIds);
  return {
    artifact,
    clickedTweetId: normalizedClickedTweetId || null,
    canonicalRootId: snapshot?.canonicalRootId || dataset?.canonicalRootId || null,
    seedTweet,
    rootTweet,
    metrics: {
      collectedTweetCount: tweets.length,
      rankedTweetCount: Array.isArray(snapshot?.ranking) ? snapshot.ranking.length : 0,
      referenceCount: references.length,
      preferredTweetCount: preferredIds.length
    },
    topTweets,
    references,
    sourceTweets: buildSourceTweetPool(tweets, topTweets, seedTweet, rootTweet)
  };
}

function buildSectionsFromStructuredArticle(article) {
  const sections = [];

  const tldr = String(article?.tldr || article?.summary || "").trim();
  if (tldr) {
    sections.push({
      heading: "TL;DR",
      body: tldr
    });
  }

  const context = String(article?.context || "").trim();
  if (context) {
    sections.push({
      heading: "Context",
      body: context
    });
  }

  const branches = Array.isArray(article?.branches) ? article.branches : [];
  for (const branch of branches) {
    const lines = [];
    const explanation = String(branch?.explanation || "").trim();
    if (explanation) {
      lines.push(explanation);
    }
    const quotes = Array.isArray(branch?.quotes) ? branch.quotes : [];
    for (const quote of quotes) {
      const block = buildQuoteBlock(quote?.author, quote?.text);
      if (block) {
        lines.push(block);
      }
    }
    sections.push({
      heading: String(branch?.title || "Branch").trim() || "Branch",
      body: lines.join("\n\n")
    });
  }

  const references = Array.isArray(article?.references) ? article.references : [];
  if (references.length > 0) {
    sections.push({
      heading: "References",
      body: references
        .map((ref, index) => `${index + 1}. ${ref.displayUrl || ref.canonicalUrl}${ref.domain ? ` (${ref.domain})` : ""}`)
        .join("\n")
    });
  }

  const openQuestions = Array.isArray(article?.openQuestions) ? article.openQuestions : [];
  if (openQuestions.length > 0) {
    sections.push({
      heading: "Open Questions",
      body: openQuestions
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .join("\n")
    });
  }

  return sections;
}

function buildStandardDigestSections(articleInput, article = {}) {
  const artifact = articleInput?.artifact || null;
  if (!artifact || !Array.isArray(artifact.mandatoryPath)) {
    return null;
  }

  const sections = [];
  const exploredTweetId = String(artifact.exploredTweetId || articleInput?.clickedTweetId || "");
  const mandatoryPath = artifact.mandatoryPath || [];
  const rootTweet = artifact.rootTweet || mandatoryPath[0] || null;
  const exploredTweet = mandatoryPath.find((tweet) => String(tweet?.id || "") === exploredTweetId)
    || (Array.isArray(artifact.selectedTweets) ? artifact.selectedTweets.find((tweet) => String(tweet?.id || "") === exploredTweetId) : null)
    || articleInput?.seedTweet
    || null;

  if (exploredTweet?.text) {
    sections.push({
      heading: "Original tweet",
      body: `The original tweet said:\n\n${buildQuoteBlock(exploredTweet.author, exploredTweet.text)}`
    });
  }

  const relationshipNarrative = (() => {
    if (!exploredTweet) {
      return String(article?.summary || article?.tldr || "").trim();
    }
    if (exploredTweet.quoteOf && rootTweet?.id && String(exploredTweet.quoteOf) === String(rootTweet.id)) {
      return "This came as a response to the quoted tweet below.";
    }
    if (exploredTweet.replyTo && rootTweet?.id && String(exploredTweet.replyTo) === String(rootTweet.id)) {
      return "This came as a direct reply to the root tweet below.";
    }
    if (exploredTweet.quoteOf || exploredTweet.replyTo) {
      return "This sits inside a larger ancestor path that gives the conversation its context.";
    }
    return "This is the starting tweet for the digest.";
  })();

  const whyBlocks = [relationshipNarrative];
  if (rootTweet?.text && (!exploredTweet || String(rootTweet.id || "") !== String(exploredTweet.id || ""))) {
    whyBlocks.push(buildQuoteBlock(rootTweet.author, rootTweet.text));
  }
  sections.push({
    heading: "Why this appeared",
    body: whyBlocks.filter(Boolean).join("\n\n")
  });

  if (mandatoryPath.length > 1) {
    const pathBody = mandatoryPath.map((tweet, index) => {
      const label = index === 0
        ? "Root"
        : (String(tweet?.id || "") === exploredTweetId ? "Explored tweet" : `Ancestor ${index}`);
      return `${label}:\n\n${buildQuoteBlock(tweet?.author, tweet?.text)}`;
    }).join("\n\n");
    sections.push({
      heading: "Ancestor path",
      body: `This is the path from the clicked tweet back through its parent context.\n\n${pathBody}`
    });
  }

  const expansionTweets = [];
  for (const level of Array.isArray(artifact.expansions) ? artifact.expansions : []) {
    for (const tweet of Array.isArray(level?.tweets) ? level.tweets : []) {
      expansionTweets.push({
        ...tweet,
        depth: Number(level?.depth || 0)
      });
    }
  }
  if (expansionTweets.length > 0) {
    const branchBody = expansionTweets.slice(0, 8).map((tweet) => {
      const label = tweet.relationType === "quote"
        ? `Quote branch · depth ${tweet.depth || 1}`
        : `Reply branch · depth ${tweet.depth || 1}`;
      return `${label}:\n\n${buildQuoteBlock(tweet?.author, tweet?.text)}`;
    }).join("\n\n");
    sections.push({
      heading: "Important replies and branches",
      body: `These are the substantive replies and quote branches selected from the conversation.\n\n${branchBody}`
    });
  }

  const references = Array.isArray(article?.references) ? article.references : (Array.isArray(articleInput?.references) ? articleInput.references : []);
  if (references.length > 0) {
    sections.push({
      heading: "Evidence",
      body: references
        .map((ref, index) => `${index + 1}. ${ref.displayUrl || ref.canonicalUrl}${ref.domain ? ` (${ref.domain})` : ""}`)
        .join("\n")
    });
  }

  const summary = String(article?.summary || article?.tldr || "").trim();
  if (summary) {
    sections.push({
      heading: "Digest summary",
      body: summary
    });
  }

  return sections;
}

function buildFallbackArticle(articleInput) {
  const rootText = cleanTweetText(articleInput?.rootTweet?.text || "Conversation snapshot");
  const seedText = cleanTweetText(articleInput?.seedTweet?.text || "");
  const topTweets = Array.isArray(articleInput?.topTweets) ? articleInput.topTweets : [];
  const references = Array.isArray(articleInput?.references) ? articleInput.references : [];
  const substantiveTweets = topTweets.filter((tweet) => !isLikelyLowSignalTweet(tweet));

  const titleAuthor = articleInput?.rootTweet?.author ? `${articleInput.rootTweet.author} conversation` : "Ariadex conversation digest";
  const tldrCandidates = substantiveTweets.length > 0 ? substantiveTweets : topTweets;
  const tldr = tldrCandidates.length > 0
    ? [
      buildQuoteBlock(tldrCandidates[0].author, tldrCandidates[0].text),
      tldrCandidates[1] ? buildQuoteBlock(tldrCandidates[1].author, tldrCandidates[1].text) : ""
    ].filter(Boolean).join("\n\n")
    : buildQuoteBlock(articleInput?.rootTweet?.author, rootText);

  const branchTweets = substantiveTweets.length > 0 ? substantiveTweets : topTweets;
  const directQuotes = branchTweets
    .filter((tweet) => tweet.quote_of === articleInput?.seedTweet?.id || tweet.quote_of === articleInput?.rootTweet?.id)
    .slice(0, 4);
  const directReplies = branchTweets
    .filter((tweet) => tweet.reply_to === articleInput?.seedTweet?.id || tweet.reply_to === articleInput?.rootTweet?.id)
    .slice(0, 4);
  const secondOrder = branchTweets
    .filter((tweet) => (
      tweet.reply_to
      && tweet.reply_to !== articleInput?.seedTweet?.id
      && tweet.reply_to !== articleInput?.rootTweet?.id
    ) || (
      tweet.quote_of
      && tweet.quote_of !== articleInput?.seedTweet?.id
      && tweet.quote_of !== articleInput?.rootTweet?.id
    ))
    .slice(0, 4);
  const otherQuotes = branchTweets
    .filter((tweet) => !tweet.reply_to && !tweet.quote_of)
    .slice(0, 3);

  const branches = [];
  if (directQuotes.length > 0) {
    branches.push({
      title: "Quoted takes",
      explanation: directQuotes.length > 1 ? "Direct quote tweets reacting to the seed or canonical root." : "",
      quotes: directQuotes.map((tweet) => ({
        author: tweet.author,
        text: tweet.text
      }))
    });
  }
  if (directReplies.length > 0) {
    branches.push({
      title: "Direct replies",
      explanation: directReplies.length > 1 ? "Replies attached directly to the seed or canonical root." : "",
      quotes: directReplies.map((tweet) => ({
        author: tweet.author,
        text: tweet.text
      }))
    });
  }
  if (secondOrder.length > 0) {
    branches.push({
      title: "Follow-on discussion",
      explanation: secondOrder.length > 1 ? "Replies deeper in the discussion that add evidence or disagreement." : "",
      quotes: secondOrder.map((tweet) => ({
        author: tweet.author,
        text: tweet.text
      }))
    });
  }
  if (otherQuotes.length > 0) {
    branches.push({
      title: branches.length === 0 ? "Captured tweets" : "Other relevant context",
      explanation: "",
      quotes: otherQuotes.map((tweet) => ({
        author: tweet.author,
        text: tweet.text
      }))
    });
  }

  const openQuestions = substantiveTweets.length >= 2
    ? [
      "Which concrete claim in this exchange still lacks a linked paper, benchmark, or method note?",
      "Which part of the discussion depends most on material outside the captured tweets?"
    ]
    : ["What additional replies or quote tweets would clarify this discussion?"];

  const article = {
    title: titleAuthor,
    dek: seedText || rootText,
    tldr,
    summary: tldr,
    context: [
      seedText && articleInput?.seedTweet?.author
        ? buildQuoteBlock(articleInput.seedTweet.author, seedText)
        : "",
      rootText && articleInput?.rootTweet?.author && articleInput?.rootTweet?.id !== articleInput?.seedTweet?.id
        ? `Canonical root:\n\n${buildQuoteBlock(articleInput.rootTweet.author, rootText)}`
        : (!seedText && rootText ? buildQuoteBlock(articleInput?.rootTweet?.author || "The root tweet", rootText) : "")
    ].filter(Boolean).join("\n\n"),
    branches,
    references: references
      .slice(0, 5)
      .map((ref) => ({
        canonicalUrl: ref.canonicalUrl,
        displayUrl: ref.displayUrl,
        domain: ref.domain,
        citationCount: ref.citationCount
      })),
    openQuestions
  };
  article.sections = buildStandardDigestSections(articleInput, article) || buildSectionsFromStructuredArticle(article);
  return article;
}

function restoreExactQuoteText(quote, sourceTweets) {
  const author = String(quote?.author || "").trim();
  const text = String(quote?.text || "").trim();
  if (!text) {
    return { author, text };
  }

  const candidates = (Array.isArray(sourceTweets) ? sourceTweets : []).filter((tweet) => {
    if (!tweet?.text) {
      return false;
    }
    if (!author) {
      return true;
    }
    return String(tweet.author || "").trim() === author;
  });

  for (const candidate of candidates) {
    const candidateText = cleanTweetText(candidate.text);
    if (candidateText === text) {
      return {
        author: author || String(candidate.author || "").trim(),
        text: candidateText
      };
    }
  }

  const normalizedText = normalizeMatchText(text);
  for (const candidate of candidates) {
    const candidateText = cleanTweetText(candidate.text);
    const normalizedCandidate = normalizeMatchText(candidateText);
    if (
      normalizedCandidate === normalizedText
      || normalizedCandidate.includes(normalizedText)
      || normalizedText.includes(normalizedCandidate)
    ) {
      return {
        author: author || String(candidate.author || "").trim(),
        text: candidateText
      };
    }
  }

  return { author, text };
}

function normalizeArticleResponse(raw, fallbackReferences, sourceTweets = [], articleInput = null) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const title = String(raw.title || "").trim();
  const dek = String(raw.dek || "").trim();
  const tldr = String(raw.tldr || raw.summary || "").trim();
  const summary = String(raw.summary || raw.tldr || "").trim();
  if (!title || !summary) {
    return null;
  }
  const article = {
    title,
    dek,
    tldr: tldr || summary,
    summary,
    context: "",
    branches: [],
    references: fallbackReferences,
    openQuestions: []
  };
  article.sections = buildStandardDigestSections(articleInput, article) || buildSectionsFromStructuredArticle(article);
  return article;
}

function createOpenAiArticleGenerator({
  apiKey = process.env.OPENAI_API_KEY,
  model = DEFAULT_MODEL,
  endpointBase = DEFAULT_ENDPOINT,
  fetchImpl = (typeof fetch === "function" ? fetch.bind(globalThis) : null),
  logger = null,
  enabled = true,
  requestTimeoutMs = Number(process.env.ARIADEX_OPENAI_ARTICLE_TIMEOUT_MS || 30000)
} = {}) {
  const trimmedApiKey = String(apiKey || "").trim();
  const generatorEnabled = Boolean(enabled && trimmedApiKey && fetchImpl);
  const endpoint = `${String(endpointBase || DEFAULT_ENDPOINT).replace(/\/$/, "")}/chat/completions`;
  const timeoutMs = Math.max(3000, Math.floor(requestTimeoutMs || 30000));

  async function generateArticle({ dataset, snapshot, requestId = null, canonicalRootId = null, clickedTweetId = null } = {}) {
    const articleInput = buildArticleInput({ dataset, snapshot, clickedTweetId });
    const fallback = buildFallbackArticle(articleInput);
    if (!generatorEnabled) {
      return {
        ...fallback,
        model: null,
        usedOpenAi: false,
        input: articleInput
      };
    }

    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${trimmedApiKey}`
        },
        ...(controller ? { signal: controller.signal } : {}),
        body: JSON.stringify({
          model,
          temperature: 0.3,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: [
                "You are generating a conversation digest for Ariadex.",
                "Ariadex reconstructs Twitter/X discourse graphs.",
                "Your role is not to summarize or invent information.",
                "Your job is only to stitch together verified tweets and references into a readable narrative.",
                "The explored seed tweet is a first-class anchor. Preserve its author and text in the context when available, even if the canonical root is different.",
                "Never invent claims, facts, or arguments.",
                "Only use the tweets and references provided.",
                "Write concise connective narrative only.",
                "Do not output quoted tweet text; Ariadex will render source tweets separately from the structured artifact.",
                "Do not generalize beyond the material.",
                "If a claim cannot be supported by a quote, omit it.",
                "Tone: calm journalist explaining a debate. Concise, neutral, minimal interpretation.",
                "Output structure must be: title, dek, summary.",
                "Keep summary to 2-4 sentences.",
                "Use the artifact's path and selected branches conceptually, but do not restate every quote.",
                "Return strict JSON only:",
                "{\"title\":\"...\",\"dek\":\"...\",\"summary\":\"...\"}"
              ].join(" ")
            },
            {
              role: "user",
              content: JSON.stringify({
                conversation: {
                  artifact: articleInput.artifact,
                  canonicalRootId: articleInput.canonicalRootId,
                  clickedTweetId: articleInput.clickedTweetId,
                  metrics: articleInput.metrics,
                  references: articleInput.references
                }
              })
            }
          ]
        })
      });

      const raw = await response.text();
      if (!response.ok) {
        throw new Error(`OpenAI article generation failed (${response.status} ${response.statusText}): ${raw.slice(0, 300)}`);
      }

      let parsed = null;
      try {
        const payload = JSON.parse(raw);
        const content = payload?.choices?.[0]?.message?.content;
        parsed = typeof content === "string" ? JSON.parse(content) : null;
      } catch {
        parsed = null;
      }

      const normalized = normalizeArticleResponse(parsed, fallback.references, articleInput.sourceTweets, articleInput);
      if (!normalized) {
        throw new Error("OpenAI article generation returned invalid JSON schema");
      }

      logger?.info?.("openai_article_generated", {
        requestId,
        canonicalRootId,
        model,
        referenceCount: normalized.references.length,
        sectionCount: normalized.sections.length
      });

      return {
        ...normalized,
        model,
        usedOpenAi: true,
        input: articleInput
      };
    } catch (error) {
      logger?.warn?.("openai_article_generation_failed", {
        requestId,
        canonicalRootId,
        model,
        errorMessage: error?.message || "unknown_error"
      });
      return {
        ...fallback,
        model,
        usedOpenAi: false,
        input: articleInput
      };
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  return {
    enabled: generatorEnabled,
    model: generatorEnabled ? model : null,
    signature: generatorEnabled ? `article:${ARTICLE_GENERATOR_VERSION}:${model}` : `article:fallback:${ARTICLE_GENERATOR_VERSION}`,
    buildArticleInput,
    generateArticle
  };
}

module.exports = {
  buildArticleInput,
  buildFallbackArticle,
  createOpenAiArticleGenerator,
  createReferenceEntries,
  isExternalReferenceUrl,
  isHumanTweet
};
