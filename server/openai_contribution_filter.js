"use strict";

const DEFAULT_MODEL = process.env.ARIADEX_OPENAI_MODEL || "gpt-4o-mini";
const DEFAULT_ENDPOINT = process.env.ARIADEX_OPENAI_BASE_URL || "https://api.openai.com/v1";

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

function normalizeResponseObject(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const labels = Array.isArray(raw.labels) ? raw.labels : [];
  const byTweetId = {};
  let contributingCount = 0;
  let nonContributingCount = 0;

  for (const label of labels) {
    const id = label && label.id != null ? String(label.id).trim() : "";
    if (!id) {
      continue;
    }
    const contributing = Boolean(label.contributing);
    byTweetId[id] = contributing;
    if (contributing) {
      contributingCount += 1;
    } else {
      nonContributingCount += 1;
    }
  }

  return {
    byTweetId,
    contributingCount,
    nonContributingCount,
    labeledCount: contributingCount + nonContributingCount
  };
}

function parseOpenAiContent(rawContent) {
  if (!rawContent || typeof rawContent !== "string") {
    return null;
  }
  const trimmed = rawContent.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return normalizeResponseObject(JSON.parse(trimmed));
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
        "Contributing=true only when tweet adds argument, evidence, clarification, critique, question, or relevant context.",
        "Contributing=false for shitpost, vaguepost, low-effort reaction, meme-only/comedy-only, spam, or unrelated content.",
        "Return strict JSON only: {\"labels\":[{\"id\":\"<tweet_id>\",\"contributing\":true|false}]}",
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

function splitIntoBatches(items, batchSize) {
  const out = [];
  for (let i = 0; i < items.length; i += batchSize) {
    out.push(items.slice(i, i + batchSize));
  }
  return out;
}

function createOpenAiContributionClassifier({
  apiKey = process.env.OPENAI_API_KEY,
  model = DEFAULT_MODEL,
  endpointBase = DEFAULT_ENDPOINT,
  fetchImpl = (typeof fetch === "function" ? fetch.bind(globalThis) : null),
  logger = null,
  enabled = toBoolean(process.env.ARIADEX_ENABLE_OPENAI_CONTRIBUTION_FILTER, true),
  maxTweetsPerSnapshot = Number(process.env.ARIADEX_OPENAI_MAX_TWEETS_PER_SNAPSHOT || 120),
  batchSize = Number(process.env.ARIADEX_OPENAI_BATCH_SIZE || 30),
  requestTimeoutMs = Number(process.env.ARIADEX_OPENAI_TIMEOUT_MS || 20000)
} = {}) {
  const trimmedApiKey = String(apiKey || "").trim();
  const classifierEnabled = Boolean(enabled && trimmedApiKey && fetchImpl);
  const normalizedBatchSize = Math.max(5, Math.min(50, Math.floor(batchSize || 30)));
  const normalizedMaxTweets = Math.max(10, Math.floor(maxTweetsPerSnapshot || 120));
  const normalizedTimeoutMs = Math.max(2000, Math.floor(requestTimeoutMs || 20000));
  const endpoint = `${String(endpointBase || DEFAULT_ENDPOINT).replace(/\/$/, "")}/chat/completions`;

  async function classifyBatch(batch, meta = {}) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeout = controller
      ? setTimeout(() => controller.abort(), normalizedTimeoutMs)
      : null;

    const startedAtMs = Date.now();
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${trimmedApiKey}`
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: buildMessages(batch)
        }),
        ...(controller ? { signal: controller.signal } : {})
      });

      const raw = await response.text();
      if (!response.ok) {
        throw new Error(`OpenAI classify failed (${response.status} ${response.statusText}): ${raw.slice(0, 500)}`);
      }

      const payload = JSON.parse(raw);
      const content = payload?.choices?.[0]?.message?.content || "";
      const parsed = parseOpenAiContent(content);
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

      return parsed;
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
        byTweetId: {},
        candidateCount: 0,
        classifiedCount: 0,
        contributingCount: 0,
        nonContributingCount: 0
      };
    }

    const safeAlwaysInclude = alwaysIncludeIds instanceof Set ? alwaysIncludeIds : new Set();
    const candidates = [];
    for (const tweet of Array.isArray(tweets) ? tweets : []) {
      const id = tweet && tweet.id != null ? String(tweet.id).trim() : "";
      if (!id || safeAlwaysInclude.has(id)) {
        continue;
      }
      if (!String(tweet.text || "").trim()) {
        continue;
      }
      candidates.push(tweet);
      if (candidates.length >= normalizedMaxTweets) {
        break;
      }
    }

    const batches = splitIntoBatches(candidates, normalizedBatchSize);
    const byTweetId = {};
    let classifiedCount = 0;
    let contributingCount = 0;
    let nonContributingCount = 0;

    for (const batch of batches) {
      try {
        const result = await classifyBatch(batch, {
          requestId,
          canonicalRootId
        });
        Object.assign(byTweetId, result.byTweetId);
        classifiedCount += result.labeledCount;
        contributingCount += result.contributingCount;
        nonContributingCount += result.nonContributingCount;
      } catch (error) {
        if (logger && typeof logger.warn === "function") {
          logger.warn("openai_classification_batch_failed", {
            requestId,
            canonicalRootId,
            batchSize: batch.length,
            errorMessage: error?.message || "unknown_error"
          });
        }
      }
    }

    return {
      enabled: true,
      model,
      byTweetId,
      candidateCount: candidates.length,
      classifiedCount,
      contributingCount,
      nonContributingCount
    };
  }

  return {
    enabled: classifierEnabled,
    model,
    classifyTweets
  };
}

module.exports = {
  createOpenAiContributionClassifier,
  parseOpenAiContent,
  normalizeResponseObject,
  toBoolean
};
