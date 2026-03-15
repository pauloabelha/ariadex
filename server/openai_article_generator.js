"use strict";

const { canonicalizeUrl, extractUrlsFromText } = require("../ui/panel_renderer.js");

const DEFAULT_MODEL = process.env.ARIADEX_OPENAI_ARTICLE_MODEL || process.env.ARIADEX_OPENAI_MODEL || "gpt-4o-mini";
const DEFAULT_ENDPOINT = process.env.ARIADEX_OPENAI_BASE_URL || "https://api.openai.com/v1";

function clipText(text, maxLength = 280) {
  const value = String(text || "").trim().replace(/\s+/g, " ");
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function cleanTweetText(text) {
  return String(text || "").trim();
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

function collectTopTweets(snapshot, tweetsById) {
  const ranking = Array.isArray(snapshot?.ranking) ? snapshot.ranking : [];
  const out = [];
  for (const entry of ranking) {
    const id = String(entry?.id || "");
    const tweet = tweetsById.get(id);
    if (!isHumanTweet(tweet)) {
      continue;
    }
    out.push({
      id,
      author: String(tweet.author || ""),
      text: cleanTweetText(tweet.text),
      score: Number(entry?.score || 0),
      reply_to: tweet.reply_to || null,
      quote_of: tweet.quote_of || null
    });
    if (out.length >= 8) {
      break;
    }
  }
  return out;
}

function buildArticleInput({ dataset, snapshot, clickedTweetId = null }) {
  const tweets = Array.isArray(dataset?.tweets) ? dataset.tweets.filter(isHumanTweet) : [];
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

  const references = createReferenceEntries(tweets, scoreById).slice(0, 8);
  const topTweets = collectTopTweets(snapshot, tweetsById);
  const normalizedClickedTweetId = String(clickedTweetId || "").trim();
  const seedTweet = normalizedClickedTweetId ? (tweetsById.get(normalizedClickedTweetId) || null) : null;
  return {
    clickedTweetId: normalizedClickedTweetId || null,
    canonicalRootId: snapshot?.canonicalRootId || dataset?.canonicalRootId || null,
    seedTweet,
    rootTweet: snapshot?.root || dataset?.rootTweet || null,
    metrics: {
      collectedTweetCount: tweets.length,
      rankedTweetCount: Array.isArray(snapshot?.ranking) ? snapshot.ranking.length : 0,
      referenceCount: references.length
    },
    topTweets,
    references
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
      const author = String(quote?.author || "").trim();
      const text = String(quote?.text || "").trim();
      if (!text) {
        continue;
      }
      if (author) {
        lines.push(`${author} wrote:`);
      }
      lines.push(`"${text}"`);
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

function buildFallbackArticle(articleInput) {
  const rootText = cleanTweetText(articleInput?.rootTweet?.text || "Conversation snapshot");
  const seedText = cleanTweetText(articleInput?.seedTweet?.text || "");
  const topTweets = Array.isArray(articleInput?.topTweets) ? articleInput.topTweets : [];
  const references = Array.isArray(articleInput?.references) ? articleInput.references : [];

  const titleAuthor = articleInput?.rootTweet?.author ? `${articleInput.rootTweet.author} conversation` : "Ariadex conversation digest";
  const tldr = topTweets.length > 0
    ? `${topTweets[0].author || "One participant"} is the top-ranked visible contribution in this snapshot. The digest below keeps the discussion tied to direct tweet quotes and cited references.`
    : "This digest uses only the captured tweets and cited references from the conversation snapshot.";

  const replyQuotes = topTweets.filter((tweet) => tweet.reply_to).slice(0, 3);
  const quoteQuotes = topTweets.filter((tweet) => tweet.quote_of).slice(0, 3);
  const otherQuotes = topTweets.filter((tweet) => !tweet.reply_to && !tweet.quote_of).slice(0, 3);

  const branches = [];
  if (quoteQuotes.length > 0) {
    branches.push({
      title: "Quote branch",
      explanation: "These tweets quote another tweet in the captured conversation.",
      quotes: quoteQuotes.map((tweet) => ({
        author: tweet.author,
        text: tweet.text
      }))
    });
  }
  if (replyQuotes.length > 0) {
    branches.push({
      title: "Reply branch",
      explanation: "These tweets reply directly within the captured conversation.",
      quotes: replyQuotes.map((tweet) => ({
        author: tweet.author,
        text: tweet.text
      }))
    });
  }
  if (branches.length === 0 && otherQuotes.length > 0) {
    branches.push({
      title: "Captured tweets",
      explanation: "These are the highest-ranked tweets available in the snapshot.",
      quotes: otherQuotes.map((tweet) => ({
        author: tweet.author,
        text: tweet.text
      }))
    });
  }

  const openQuestions = topTweets.length >= 2
    ? [
      "Which of the quoted positions best matches the root tweet context?",
      "Which cited references would change how these tweets are read?"
    ]
    : ["What additional replies or quote tweets would clarify this discussion?"];

  const article = {
    title: titleAuthor,
    dek: seedText || rootText,
    tldr,
    summary: tldr,
    context: [
      seedText && articleInput?.seedTweet?.author
        ? `${articleInput.seedTweet.author} wrote:\n\n"${seedText}"`
        : "",
      rootText && articleInput?.rootTweet?.author && articleInput?.rootTweet?.id !== articleInput?.seedTweet?.id
        ? `The canonical root from ${articleInput.rootTweet.author} was:\n\n"${rootText}"`
        : (!seedText && rootText ? `${articleInput?.rootTweet?.author || "The root tweet"} wrote:\n\n"${rootText}"` : "")
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
  article.sections = buildSectionsFromStructuredArticle(article);
  return article;
}

function normalizeArticleResponse(raw, fallbackReferences) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const title = String(raw.title || "").trim();
  const dek = String(raw.dek || "").trim();
  const tldr = String(raw.tldr || raw.summary || "").trim();
  const context = String(raw.context || "").trim();
  const branches = Array.isArray(raw.branches)
    ? raw.branches.map((branch) => ({
      title: String(branch?.title || "").trim(),
      explanation: String(branch?.explanation || "").trim(),
      quotes: Array.isArray(branch?.quotes)
        ? branch.quotes.map((quote) => ({
          author: String(quote?.author || "").trim(),
          text: String(quote?.text || "").trim()
        })).filter((quote) => quote.text)
        : []
    })).filter((branch) => branch.title || branch.explanation || branch.quotes.length > 0)
    : [];
  const openQuestions = Array.isArray(raw.openQuestions)
    ? raw.openQuestions.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (!title || !tldr || !context || branches.length === 0) {
    return null;
  }
  const article = {
    title,
    dek,
    tldr,
    summary: tldr,
    context,
    branches,
    references: Array.isArray(raw.references) && raw.references.length > 0
      ? raw.references.map((ref) => ({
        canonicalUrl: String(ref?.canonicalUrl || "").trim(),
        displayUrl: String(ref?.displayUrl || ref?.canonicalUrl || "").trim(),
        domain: String(ref?.domain || "").trim(),
        citationCount: Number(ref?.citationCount || 0)
      })).filter((ref) => ref.canonicalUrl)
      : fallbackReferences,
    openQuestions
  };
  article.sections = buildSectionsFromStructuredArticle(article);
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
                "Preserve direct quotes whenever possible.",
                "Narration should only connect quotes, not replace them.",
                "Do not generalize beyond the material.",
                "If a claim cannot be supported by a quote, omit it.",
                "Tone: calm journalist explaining a debate. Concise, neutral, quote-heavy, minimal interpretation.",
                "At least 50% of the article content should be direct quotes copied exactly from the original tweets.",
                "Output structure must be: title, tldr, context, branches, references, openQuestions.",
                "Each branch must include: title, explanation, quotes.",
                "Quotes must be traceable to provided tweets.",
                "Return strict JSON only:",
                "{\"title\":\"...\",\"dek\":\"...\",\"tldr\":\"...\",\"context\":\"...\",\"branches\":[{\"title\":\"...\",\"explanation\":\"...\",\"quotes\":[{\"author\":\"@name\",\"text\":\"exact tweet text\"}]}],\"references\":[{\"canonicalUrl\":\"...\",\"displayUrl\":\"...\",\"domain\":\"...\",\"citationCount\":1}],\"openQuestions\":[\"...\"]}"
              ].join(" ")
            },
            {
              role: "user",
              content: JSON.stringify({
                conversation: articleInput
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

      const normalized = normalizeArticleResponse(parsed, fallback.references);
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
    signature: generatorEnabled ? `article:${model}` : "article:fallback",
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
