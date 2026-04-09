"use strict";

const {
  buildAuthHeaders,
  createProviderSignature,
  deriveProviderName,
  resolveApiKeyFromEnv,
  resolveContributionModel,
  resolveEndpointBase
} = require("./llm_runtime.js");

const DEFAULT_MODEL = resolveContributionModel();
const DEFAULT_ENDPOINT = resolveEndpointBase();

function toBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value || "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function clipText(text, maxLength = 280) {
  const value = String(text || "").trim().replace(/\s+/g, " ");
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return null;
  }
  if (n <= 0) {
    return 0;
  }
  if (n >= 1) {
    return 1;
  }
  return n;
}

function normalizeResponseObject(raw, { threshold = 0.65 } = {}) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const labels = Array.isArray(raw.labels) ? raw.labels : [];
  const byTweetId = {};
  const scoreByTweetId = {};
  const reasonByTweetId = {};
  let contributingCount = 0;
  let nonContributingCount = 0;

  for (const label of labels) {
    const id = label && label.id != null ? String(label.id).trim() : "";
    if (!id) {
      continue;
    }
    const scoreFromField = clamp01(label?.contribution_score);
    const score = scoreFromField != null
      ? scoreFromField
      : (Boolean(label?.contributing) ? 1 : 0);
    const contributing = score >= threshold;
    byTweetId[id] = contributing;
    scoreByTweetId[id] = score;
    reasonByTweetId[id] = String(label?.reason || "").slice(0, 160);
    if (contributing) {
      contributingCount += 1;
    } else {
      nonContributingCount += 1;
    }
  }

  return {
    byTweetId,
    scoreByTweetId,
    reasonByTweetId,
    contributingCount,
    nonContributingCount,
    labeledCount: contributingCount + nonContributingCount
  };
}

function parseOpenAiContent(rawContent, options = {}) {
  if (!rawContent || typeof rawContent !== "string") {
    return null;
  }
  const trimmed = rawContent.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return normalizeResponseObject(JSON.parse(trimmed), options);
  } catch {
    return null;
  }
}

function buildMessages(batch) {
  const compactBatch = batch.map((tweet) => ({
    id: String(tweet.id || ""),
    author_id: String(tweet.author_id || ""),
    author: String(tweet.author || ""),
    text: clipText(tweet.text, 320),
    reply_to: tweet.reply_to || null,
    quote_of: tweet.quote_of || null
  }));

  return [
    {
      role: "system",
      content: [
        "You classify if tweets contribute to the discussion.",
        "Contributing means adding concrete value: argument, evidence, clarification, pointed critique, or specific question tied to the thread.",
        "Non-contributing includes: vague slogan/aphorism, low-effort reaction, joke-only, meme-only, generic cheer/boo, spam, or unrelated text.",
        "Bare assertion without support should score low.",
        "Return strict JSON only:",
        "{\"labels\":[{\"id\":\"<tweet_id>\",\"contribution_score\":0.0-1.0,\"contributing\":true|false,\"reason\":\"short reason\"}]}",
        "Set contributing=true only when contribution_score >= 0.65.",
        "Do not include extra keys or text."
      ].join(" ")
    },
    {
      role: "user",
      content: JSON.stringify({
        tweets: compactBatch
      })
    }
  ];
}

function tokenize(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function heuristicNonContributionReason(tweet) {
  const text = String(tweet?.text || "").trim();
  if (!text) {
    return "empty_text";
  }

  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  const tokens = tokenize(normalized);
  const alphaOnlyLength = normalized.replace(/[^a-z]/g, "").length;

  if (alphaOnlyLength > 0 && alphaOnlyLength < 18) {
    return "too_short";
  }

  if (tokens.length <= 3) {
    return "too_short";
  }

  if (/^(lol|lmao|rofl|haha+|same|based|facts|true|agreed|exactly|yup|yep|nice|cool|wow|this)[.!?]*$/.test(normalized)) {
    return "low_effort_reaction";
  }

  if (/(😂|🤣|😆|😹){2,}/.test(normalized)) {
    return "emoji_only_reaction";
  }

  return null;
}

function splitIntoBatches(items, batchSize) {
  const out = [];
  for (let i = 0; i < items.length; i += batchSize) {
    out.push(items.slice(i, i + batchSize));
  }
  return out;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const safeConcurrency = Math.max(1, Math.floor(Number(concurrency) || 1));
  const output = new Array(items.length);
  let nextIndex = 0;

  async function runOne() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        return;
      }
      output[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(safeConcurrency, items.length); i += 1) {
    workers.push(runOne());
  }
  await Promise.all(workers);
  return output;
}

function createOpenAiContributionClassifier({
  apiKey = undefined,
  model = DEFAULT_MODEL,
  endpointBase = DEFAULT_ENDPOINT,
  fetchImpl = (typeof fetch === "function" ? fetch.bind(globalThis) : null),
  logger = null,
  enabled = toBoolean(process.env.ARIADEX_ENABLE_OPENAI_CONTRIBUTION_FILTER, true),
  scoreThreshold = Number(process.env.ARIADEX_CONTRIBUTION_SCORE_THRESHOLD || 0.65),
  enableHeuristics = toBoolean(process.env.ARIADEX_ENABLE_HEURISTIC_CONTRIBUTION_FILTER, true),
  dedupeByText = toBoolean(process.env.ARIADEX_OPENAI_DEDUPE_BY_TEXT, true),
  includeReason = toBoolean(process.env.ARIADEX_OPENAI_INCLUDE_REASON, false),
  maxConcurrentBatches = Number(process.env.ARIADEX_OPENAI_MAX_CONCURRENT_BATCHES || 2),
  maxTweetsPerSnapshot = Number(process.env.ARIADEX_OPENAI_MAX_TWEETS_PER_SNAPSHOT || 120),
  batchSize = Number(process.env.ARIADEX_OPENAI_BATCH_SIZE || 30),
  requestTimeoutMs = Number(process.env.ARIADEX_OPENAI_TIMEOUT_MS || 20000)
} = {}) {
  const resolvedEndpointBase = resolveEndpointBase(endpointBase);
  const resolvedApiKey = resolveApiKeyFromEnv(apiKey, resolvedEndpointBase);
  const provider = deriveProviderName(resolvedEndpointBase);
  const classifierEnabled = Boolean(enabled && fetchImpl);
  const normalizedBatchSize = Math.max(5, Math.min(50, Math.floor(batchSize || 30)));
  const normalizedMaxTweets = Math.max(10, Math.floor(maxTweetsPerSnapshot || 120));
  const normalizedTimeoutMs = Math.max(2000, Math.floor(requestTimeoutMs || 20000));
  const normalizedMaxConcurrentBatches = Math.max(1, Math.min(6, Math.floor(maxConcurrentBatches || 2)));
  const normalizedScoreThreshold = Number.isFinite(scoreThreshold)
    ? Math.max(0.2, Math.min(0.95, scoreThreshold))
    : 0.65;
  const endpoint = `${resolvedEndpointBase}/chat/completions`;

  async function classifyBatch(batch, meta = {}) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeout = controller
      ? setTimeout(() => controller.abort(), normalizedTimeoutMs)
      : null;

    const startedAtMs = Date.now();
    try {
      const responseSchema = includeReason
        ? "{\"labels\":[{\"id\":\"<tweet_id>\",\"contribution_score\":0.0-1.0,\"contributing\":true|false,\"reason\":\"short reason\"}]}"
        : "{\"labels\":[{\"id\":\"<tweet_id>\",\"contribution_score\":0.0-1.0,\"contributing\":true|false}]}";

      const compactBatch = batch.map((tweet) => ({
        id: String(tweet.id || ""),
        text: clipText(tweet.text, 300),
        rel: tweet.reply_to ? "reply" : (tweet.quote_of ? "quote" : "other")
      }));

      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...buildAuthHeaders(resolvedApiKey)
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: [
                "You classify if tweets contribute to the discussion.",
                "Contributing means adding concrete value: argument, evidence, clarification, critique, or specific question tied to thread context.",
                "Non-contributing includes vague slogan, low-effort reaction, joke-only/comedy-only, spam, or unrelated text.",
                "Bare assertions without support should score low.",
                `Return strict JSON only: ${responseSchema}`,
                `Set contributing=true only when contribution_score >= ${normalizedScoreThreshold.toFixed(2)}.`,
                "No extra keys, no markdown."
              ].join(" ")
            },
            {
              role: "user",
              content: JSON.stringify({ tweets: compactBatch })
            }
          ]
        }),
        ...(controller ? { signal: controller.signal } : {})
      });

      const raw = await response.text();
      if (!response.ok) {
        throw new Error(`OpenAI classify failed (${response.status} ${response.statusText}): ${raw.slice(0, 500)}`);
      }

      const payload = JSON.parse(raw);
      const content = payload?.choices?.[0]?.message?.content || "";
      const parsed = parseOpenAiContent(content, { threshold: normalizedScoreThreshold });
      if (!parsed) {
        throw new Error("OpenAI classify returned invalid JSON payload");
      }

      if (logger && typeof logger.info === "function") {
        logger.info("openai_classification_batch_completed", {
          requestId: meta.requestId || null,
          canonicalRootId: meta.canonicalRootId || null,
          batchSize: batch.length,
          labeledCount: parsed.labeledCount,
          contributingCount: parsed.contributingCount,
          nonContributingCount: parsed.nonContributingCount,
          promptTokens: Number(payload?.usage?.prompt_tokens || 0),
          completionTokens: Number(payload?.usage?.completion_tokens || 0),
          totalTokens: Number(payload?.usage?.total_tokens || 0),
          durationMs: Date.now() - startedAtMs
        });
      }

      return {
        ...parsed,
        usage: {
          promptTokens: Number(payload?.usage?.prompt_tokens || 0),
          completionTokens: Number(payload?.usage?.completion_tokens || 0),
          totalTokens: Number(payload?.usage?.total_tokens || 0)
        }
      };
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  async function classifyTweets(tweets, { requestId = null, canonicalRootId = null, alwaysIncludeIds = new Set() } = {}) {
    if (!classifierEnabled) {
      return {
        enabled: false,
        model,
        llmProvider: provider,
        byTweetId: {},
        scoreByTweetId: {},
        reasonByTweetId: {},
        threshold: normalizedScoreThreshold,
        heuristicRejectedCount: 0,
        candidateCount: 0,
        classifiedCount: 0,
        contributingCount: 0,
        nonContributingCount: 0
      };
    }

    const safeAlwaysInclude = alwaysIncludeIds instanceof Set ? alwaysIncludeIds : new Set();
    const candidates = [];
    const duplicateOfById = {};
    const canonicalIdByTextKey = new Map();
    const byTweetId = {};
    const scoreByTweetId = {};
    const reasonByTweetId = {};
    let heuristicRejectedCount = 0;

    for (const tweet of Array.isArray(tweets) ? tweets : []) {
      const id = tweet && tweet.id != null ? String(tweet.id).trim() : "";
      if (!id || safeAlwaysInclude.has(id)) {
        continue;
      }
      if (!String(tweet.text || "").trim()) {
        continue;
      }
      if (dedupeByText) {
        const textKey = String(tweet.text || "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 300);
        if (textKey) {
          const existingCanonicalId = canonicalIdByTextKey.get(textKey);
          if (existingCanonicalId) {
            duplicateOfById[id] = existingCanonicalId;
            continue;
          }
          canonicalIdByTextKey.set(textKey, id);
        }
      }
      if (enableHeuristics) {
        const heuristicReason = heuristicNonContributionReason(tweet);
        if (heuristicReason) {
          byTweetId[id] = false;
          scoreByTweetId[id] = 0;
          reasonByTweetId[id] = `heuristic:${heuristicReason}`;
          heuristicRejectedCount += 1;
          continue;
        }
      }
      candidates.push(tweet);
      if (candidates.length >= normalizedMaxTweets) {
        break;
      }
    }

    const batches = splitIntoBatches(candidates, normalizedBatchSize);
    let classifiedCount = 0;
    let contributingCount = 0; // includes heuristic + model results
    let nonContributingCount = heuristicRejectedCount;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalTokens = 0;

    const batchResults = await mapWithConcurrency(
      batches,
      normalizedMaxConcurrentBatches,
      async (batch) => {
        try {
          return await classifyBatch(batch, {
            requestId,
            canonicalRootId
          });
        } catch (error) {
          if (logger && typeof logger.warn === "function") {
            logger.warn("openai_classification_batch_failed", {
              requestId,
              canonicalRootId,
              batchSize: batch.length,
              errorMessage: error?.message || "unknown_error"
            });
          }
          return null;
        }
      }
    );

    for (const result of batchResults) {
      if (!result) {
        continue;
      }
      Object.assign(byTweetId, result.byTweetId);
      Object.assign(scoreByTweetId, result.scoreByTweetId || {});
      Object.assign(reasonByTweetId, result.reasonByTweetId || {});
      classifiedCount += result.labeledCount;
      contributingCount += result.contributingCount;
      nonContributingCount += result.nonContributingCount;
      totalPromptTokens += Number(result?.usage?.promptTokens || 0);
      totalCompletionTokens += Number(result?.usage?.completionTokens || 0);
      totalTokens += Number(result?.usage?.totalTokens || 0);
    }

    for (const [id, canonicalId] of Object.entries(duplicateOfById)) {
      if (!canonicalId) {
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(byTweetId, canonicalId)) {
        byTweetId[id] = byTweetId[canonicalId];
        scoreByTweetId[id] = Number.isFinite(scoreByTweetId[canonicalId]) ? scoreByTweetId[canonicalId] : 0;
        reasonByTweetId[id] = reasonByTweetId[canonicalId] || "deduped_from_identical_text";
      }
    }

    return {
      enabled: true,
      model,
      llmProvider: provider,
      threshold: normalizedScoreThreshold,
      byTweetId,
      scoreByTweetId,
      reasonByTweetId,
      heuristicRejectedCount,
      dedupedCount: Object.keys(duplicateOfById).length,
      maxConcurrentBatches: normalizedMaxConcurrentBatches,
      candidateCount: candidates.length,
      classifiedCount,
      contributingCount,
      nonContributingCount,
      usage: {
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        totalTokens
      }
    };
  }

  return {
    enabled: classifierEnabled,
    model,
    llmProvider: provider,
    signature: classifierEnabled
      ? `${createProviderSignature({ provider, model, endpointBase: resolvedEndpointBase })}:th=${normalizedScoreThreshold}:heur=${enableHeuristics ? 1 : 0}`
      : "llm:disabled",
    classifyTweets
  };
}

module.exports = {
  createOpenAiContributionClassifier,
  parseOpenAiContent,
  normalizeResponseObject,
  toBoolean
};
