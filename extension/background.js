"use strict";

if (typeof importScripts === "function") {
  importScripts("./dev_env_loader.js");
  importScripts("./algo.js");
  importScripts("./report_generation.js");
}

const algo = typeof module !== "undefined" && module.exports
  ? require("./algo.js")
  : globalThis.AriadexAlgo;
const devEnvLoader = typeof module !== "undefined" && module.exports
  ? require("./dev_env_loader.js")
  : globalThis;
const reportGeneration = typeof module !== "undefined" && module.exports
  ? require("./report_generation.js")
  : globalThis.AriadexReportGeneration;

const RESOLVE_ROOT_PATH_MESSAGE_TYPE = "ARIADEX_RESOLVE_ROOT_PATH";
const CLEAR_CACHE_MESSAGE_TYPE = "ARIADEX_CLEAR_CACHE";
const GENERATE_REPORT_MESSAGE_TYPE = "ARIADEX_GENERATE_REPORT";
const GENERATE_GIST_MESSAGE_TYPE = "ARIADEX_GENERATE_GIST";
const RESOLVE_TOP_TAKES_MESSAGE_TYPE = "ARIADEX_RESOLVE_TOP_TAKES";
const RESOLVE_ROOT_PATH_PORT_NAME = "ARIADEX_RESOLVE_ROOT_PATH_PORT";
const GENERATE_REPORT_PORT_NAME = "ARIADEX_GENERATE_REPORT_PORT";
const GENERATE_GIST_PORT_NAME = "ARIADEX_GENERATE_GIST_PORT";
const RESOLVE_TOP_TAKES_PORT_NAME = "ARIADEX_RESOLVE_TOP_TAKES_PORT";
const X_API_BEARER_STORAGE_KEYS = [
  "ariadex.x_api_bearer_token",
  "ariadex.xApiBearerToken"
];
const OPENAI_API_KEY_STORAGE_KEYS = [
  "ariadex.openai_api_key",
  "ariadex.openAiApiKey",
  "OPENAI_API_KEY"
];
const OPENAI_MODEL_STORAGE_KEYS = [
  "ariadex.openai_model",
  "ariadex.openAiModel"
];
const OPENAI_BASE_URL_STORAGE_KEYS = [
  "ariadex.openai_base_url",
  "ariadex.openAiBaseUrl"
];
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TOP_TAKES_MODEL = "gpt-5-mini";

function readChromeStorageLocalValue(chromeApi, key) {
  return new Promise((resolve) => {
    const storageLocal = chromeApi?.storage?.local;
    if (!storageLocal?.get) {
      resolve("");
      return;
    }

    storageLocal.get([key], (result) => {
      const runtimeError = chromeApi?.runtime?.lastError;
      if (runtimeError) {
        resolve("");
        return;
      }

      const value = result?.[key];
      resolve(typeof value === "string" ? value.trim() : "");
    });
  });
}

async function resolveBearerToken(chromeApi, providedToken) {
  const directToken = String(providedToken || "").trim();
  if (directToken) {
    return directToken;
  }

  for (const key of X_API_BEARER_STORAGE_KEYS) {
    const candidate = await readChromeStorageLocalValue(chromeApi, key);
    if (candidate) {
      return candidate;
    }
  }

  return "";
}

async function resolveFirstStorageValue(chromeApi, keys, providedValue = "") {
  const directValue = String(providedValue || "").trim();
  if (directValue) {
    return directValue;
  }

  for (const key of keys) {
    const candidate = await readChromeStorageLocalValue(chromeApi, key);
    if (candidate) {
      return candidate;
    }
  }

  return "";
}

function extractOpenAiJsonText(payload) {
  const choices = Array.isArray(payload?.choices) ? payload.choices : [];
  const messageContent = choices[0]?.message?.content;
  if (typeof messageContent === "string") {
    return messageContent.trim();
  }
  if (Array.isArray(messageContent)) {
    return messageContent.map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }
      if (entry?.type === "text" && typeof entry.text === "string") {
        return entry.text;
      }
      return "";
    }).join("").trim();
  }
  return "";
}

function buildTopTakesSystemPrompt() {
  return [
    "You are AriadeX Top Takes, an epistemic discourse analyst for quote tweets.",
    "Your job is not to decide objective truth and not to pick popular tweets.",
    "Do not optimize for popularity, engagement, agreement with the source tweet, ideology, hype, or emotional intensity.",
    "Optimize for tweets that materially improve a reader's understanding of the source tweet and surrounding discourse.",
    "Reward informational contribution, perspective diversity, mechanistic understanding, operational realism, meaningful skepticism, and evidence-based reasoning.",
    "Penalize low-information affective reactions, including short posts whose main contribution is revulsion, excitement, fear, disgust, vibes, or other emotional posture without reasoning, evidence, mechanism, or domain detail.",
    "Skepticism is valuable only when it names a concrete failure mode, assumption, constraint, evidence gap, operational risk, or causal mechanism.",
    "Each quote may include up to three top direct comments. Use those comments as weak context for whether the quote surfaced a useful objection, clarification, correction, or supporting evidence.",
    "Do not let comment engagement override the quote's substance. Comments should adjust the score only when they materially clarify or challenge the quote.",
    "Infer the source tweet's broad domain, then classify each quote author as either Expert or Adjacent for that domain.",
    "Expert means the quote author appears directly domain-fluent for the source tweet's subject based on the quote text and public X profile metadata.",
    "Adjacent means the quote author brings useful neighboring expertise, such as economics, policy, commercialization, deployment, operations, user experience, ethics, investing, or field practice.",
    "Use profile metadata only as weak public evidence. Do not assume credentials are true. Do not equate follower count or verification with expertise.",
    "Prefer demonstrated domain fluency in the quote itself. If profile evidence is missing or ambiguous, say so.",
    "Classify each quote tweet independently inside the batch, while using the batch to understand redundancy and discourse coverage.",
    "Use only these roles: validation, skepticism, evidence, operational_caveat, technical_explanation, methodological_criticism, commercialization_framing, historical_context, synthesis, hype, other.",
    "Return structured JSON only."
  ].join("\n");
}

function buildTopTakesUserPrompt(batch) {
  return JSON.stringify({
    task: "Classify quote tweets by how much they improve a reader's understanding of the source tweet and its discourse.",
    comment_context: "Each quote tweet may include topComments: up to three direct replies sorted by visible engagement. Consider them as discourse context, not as popularity evidence.",
    scorecard: {
      substance: "0 to 1: meaningful reasoning, evidence, specificity, or informative content.",
      novelty: "0 to 1: non-obvious information or a distinct perspective.",
      credibility: "0 to 1: appears informed, grounded, operationally realistic, or domain fluent.",
      low_score_guidance: "Short affective reactions without evidence, mechanism, or domain detail should receive low substance and credibility even when they are skeptical."
    },
    output_shape: {
      sourceDomain: "broad human-readable domain such as robotics, economics, AI research, medicine, law, software engineering, climate science, or other",
      sourceDomainConfidence: 0,
      classifications: [
        {
          tweetId: "string",
          scorecard: {
            substance: 0,
            novelty: 0,
            credibility: 0
          },
          role: "allowed role string",
          domainGroup: "expert or adjacent",
          authorDomainRelevance: 0,
          authorExpertiseSignal: 0,
          expertiseEvidence: "concise public evidence from profile metadata and/or quote text, or say ambiguous",
          isDomainFluentTechnicalTake: false,
          explanation: "one concise sentence explaining why this take matters",
          confidence: 0
        }
      ]
    },
    sourceTweet: batch?.sourceTweet || {},
    quoteTweets: Array.isArray(batch?.quoteTweets) ? batch.quoteTweets : []
  }, null, 2);
}

async function callOpenAiTopTakesBatch({ fetchImpl, batch, providerConfig }) {
  const effectiveFetch = typeof fetchImpl === "function"
    ? fetchImpl
    : (typeof fetch === "function" ? fetch.bind(globalThis) : null);
  if (!effectiveFetch) {
    throw new Error("missing_fetch_implementation");
  }
  if (!providerConfig?.apiKey) {
    throw new Error("missing_openai_api_key");
  }

  const response = await effectiveFetch(`${String(providerConfig.apiBaseUrl || DEFAULT_OPENAI_BASE_URL).replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${providerConfig.apiKey}`
    },
    body: JSON.stringify({
      model: providerConfig.model || DEFAULT_TOP_TAKES_MODEL,
      temperature: 0.1,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "ariadex_top_takes_batch",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              sourceDomain: { type: "string" },
              sourceDomainConfidence: { type: "number" },
              classifications: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    tweetId: { type: "string" },
                    scorecard: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        substance: { type: "number" },
                        novelty: { type: "number" },
                        credibility: { type: "number" }
                      },
                      required: ["substance", "novelty", "credibility"]
                    },
                    role: {
                      type: "string",
                      enum: algo.TOP_TAKES_ROLES
                    },
                    domainGroup: {
                      type: "string",
                      enum: algo.TOP_TAKES_DOMAIN_GROUPS
                    },
                    authorDomainRelevance: { type: "number" },
                    authorExpertiseSignal: { type: "number" },
                    expertiseEvidence: { type: "string" },
                    isDomainFluentTechnicalTake: { type: "boolean" },
                    explanation: { type: "string" },
                    confidence: { type: "number" }
                  },
                  required: ["tweetId", "scorecard", "role", "domainGroup", "authorDomainRelevance", "authorExpertiseSignal", "expertiseEvidence", "isDomainFluentTechnicalTake", "explanation", "confidence"]
                }
              }
            },
            required: ["sourceDomain", "sourceDomainConfidence", "classifications"]
          }
        }
      },
      messages: [
        { role: "system", content: buildTopTakesSystemPrompt() },
        { role: "user", content: buildTopTakesUserPrompt(batch) }
      ]
    })
  });

  if (!response?.ok) {
    let detail = "";
    try {
      detail = String(await response.text()).trim().slice(0, 300);
    } catch {}
    throw new Error(detail ? `top_takes_openai_failed_${response.status}:${detail}` : `top_takes_openai_failed_${response.status}`);
  }

  const payload = await response.json();
  const text = extractOpenAiJsonText(payload);
  if (!text) {
    throw new Error("empty_top_takes_response");
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("invalid_top_takes_json");
  }

  return {
    provider: "openai",
    model: providerConfig.model,
    apiBaseUrl: providerConfig.apiBaseUrl,
    sourceDomain: String(parsed?.sourceDomain || "").trim(),
    sourceDomainConfidence: Number(parsed?.sourceDomainConfidence || 0),
    classifications: Array.isArray(parsed?.classifications) ? parsed.classifications : []
  };
}

// The background worker is intentionally thin: it wires Chrome runtime events into the pure algorithm module.
function createBackgroundController({ chromeApi, fetchImpl, algoApi = algo }) {
  const storage = algoApi.createStorageAdapter(chromeApi);
  const effectiveFetch = typeof fetchImpl === "function"
    ? fetchImpl
    : (typeof fetch === "function" ? fetch.bind(globalThis) : null);

  return {
    // Share one resolver entry point across one-shot requests and streaming progress ports.
    async resolveRootPath(tweetId, options = {}) {
      let generatedConfig = null;
      if (typeof devEnvLoader?.loadGeneratedConfig === "function") {
        try {
          generatedConfig = await devEnvLoader.loadGeneratedConfig({
            chromeApi,
            fetchImpl: effectiveFetch,
            view: typeof window !== "undefined" ? window : null
          });
        } catch {}
      } else if (globalThis?.AriadexDevEnvReady && typeof globalThis.AriadexDevEnvReady.then === "function") {
        try {
          await globalThis.AriadexDevEnvReady;
        } catch {}
      }

      const bearerToken = await resolveBearerToken(chromeApi, options?.bearerToken || "");
      const apiBaseUrl = String(
        options?.apiBaseUrl
        || generatedConfig?.apiBaseUrl
        || globalThis?.AriadexXApiSettings?.apiBaseUrl
        || algoApi.DEFAULT_API_BASE_URL
      ).trim() || algoApi.DEFAULT_API_BASE_URL;
      const client = algoApi.createTweetClient(fetchImpl, {
        bearerToken,
        apiBaseUrl,
        onProgress: typeof options?.onProgress === "function" ? options.onProgress : null
      });
      return algoApi.resolveRootPath(tweetId, {
        storage,
        client,
        onProgress: typeof options?.onProgress === "function" ? options.onProgress : null
      });
    },

    async resolveTopTakes(tweetId, options = {}) {
      let generatedConfig = null;
      if (typeof devEnvLoader?.loadGeneratedConfig === "function") {
        try {
          generatedConfig = await devEnvLoader.loadGeneratedConfig({
            chromeApi,
            fetchImpl: effectiveFetch,
            view: typeof window !== "undefined" ? window : null
          });
        } catch {}
      }

      const bearerToken = await resolveBearerToken(chromeApi, options?.bearerToken || "");
      const apiBaseUrl = String(
        options?.apiBaseUrl
        || generatedConfig?.apiBaseUrl
        || globalThis?.AriadexXApiSettings?.apiBaseUrl
        || algoApi.DEFAULT_API_BASE_URL
      ).trim() || algoApi.DEFAULT_API_BASE_URL;
      const openAiApiKey = await resolveFirstStorageValue(chromeApi, OPENAI_API_KEY_STORAGE_KEYS, options?.openAiApiKey || "");
      const openAiModel = await resolveFirstStorageValue(chromeApi, OPENAI_MODEL_STORAGE_KEYS, options?.openAiModel || "");
      const openAiBaseUrl = await resolveFirstStorageValue(chromeApi, OPENAI_BASE_URL_STORAGE_KEYS, options?.openAiBaseUrl || "");
      const client = algoApi.createTweetClient(fetchImpl, {
        bearerToken,
        apiBaseUrl,
        maxQuoteTweets: options?.maxQuoteTweets,
        maxQuotePages: options?.maxQuotePages,
        maxRateLimitRetries: options?.maxRateLimitRetries,
        rateLimitRetryDelayMs: options?.rateLimitRetryDelayMs,
        rateLimitMaxWaitMs: options?.rateLimitMaxWaitMs,
        onProgress: typeof options?.onProgress === "function" ? options.onProgress : null
      });
      const providerConfig = {
        apiKey: openAiApiKey,
        apiBaseUrl: openAiBaseUrl || DEFAULT_OPENAI_BASE_URL,
        model: openAiModel || DEFAULT_TOP_TAKES_MODEL
      };

      return algoApi.resolveTopTakes(tweetId, {
        storage,
        client,
        onProgress: typeof options?.onProgress === "function" ? options.onProgress : null,
        analyzeTopTakesBatch(batch, batchOptions) {
          return callOpenAiTopTakesBatch({
            fetchImpl: effectiveFetch,
            batch,
            providerConfig: {
              ...providerConfig,
              model: String(batchOptions?.model || providerConfig.model || DEFAULT_TOP_TAKES_MODEL)
            }
          });
        }
      }, {
        maxQuoteTweets: options?.maxQuoteTweets,
        maxQuotePages: options?.maxQuotePages,
        quoteBatchSize: options?.quoteBatchSize,
        maxRateLimitRetries: options?.maxRateLimitRetries,
        rateLimitRetryDelayMs: options?.rateLimitRetryDelayMs,
        rateLimitMaxWaitMs: options?.rateLimitMaxWaitMs,
        model: providerConfig.model
      });
    },

    async clearCache() {
      await storage.clearCache();
      return { cleared: true };
    },

    async generateReport(artifact, options = {}) {
      let generatedConfig = null;
      if (typeof options?.onProgress === "function") {
        options.onProgress({ phase: "loading_report_config" });
      }
      if (typeof devEnvLoader?.loadGeneratedConfig === "function") {
        try {
          generatedConfig = await devEnvLoader.loadGeneratedConfig({
            chromeApi,
            fetchImpl: effectiveFetch,
            view: typeof window !== "undefined" ? window : null
          });
        } catch {}
      }

      const reportSettings = reportGeneration.normalizeReportSettings({
        reportBackendBaseUrl: options?.reportBackendBaseUrl
          || generatedConfig?.reportBackendBaseUrl
          || globalThis?.AriadexReportSettings?.backendBaseUrl
          || ""
      });

      return reportGeneration.generateReport({
        fetchImpl: effectiveFetch,
        artifact,
        settings: reportSettings,
        onProgress: typeof options?.onProgress === "function" ? options.onProgress : null
      });
    },

    async generateGist(artifact, options = {}) {
      let generatedConfig = null;
      if (typeof options?.onProgress === "function") {
        options.onProgress({ phase: "loading_report_config" });
      }
      if (typeof devEnvLoader?.loadGeneratedConfig === "function") {
        try {
          generatedConfig = await devEnvLoader.loadGeneratedConfig({
            chromeApi,
            fetchImpl: effectiveFetch,
            view: typeof window !== "undefined" ? window : null
          });
        } catch {}
      }

      const reportSettings = reportGeneration.normalizeReportSettings({
        reportBackendBaseUrl: options?.reportBackendBaseUrl
          || generatedConfig?.reportBackendBaseUrl
          || globalThis?.AriadexReportSettings?.backendBaseUrl
          || ""
      });

      return reportGeneration.generateGist({
        fetchImpl: effectiveFetch,
        artifact,
        settings: reportSettings,
        onProgress: typeof options?.onProgress === "function" ? options.onProgress : null
      });
    },

    // Support the simplest request-response flow used by tests and fallback content-script code paths.
    registerMessageHandler() {
      chromeApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.type === RESOLVE_ROOT_PATH_MESSAGE_TYPE) {
          this.resolveRootPath(message.tweetId, {
            bearerToken: message?.bearerToken || "",
            apiBaseUrl: message?.apiBaseUrl || ""
          })
            .then((artifact) => {
              sendResponse({ ok: true, artifact });
            })
            .catch((error) => {
              sendResponse({ ok: false, error: error?.message || "root_path_resolution_failed" });
            });

          return true;
        }

        if (message?.type === CLEAR_CACHE_MESSAGE_TYPE) {
          this.clearCache()
            .then((result) => {
              sendResponse({ ok: true, ...result });
            })
            .catch((error) => {
              sendResponse({ ok: false, error: error?.message || "cache_clear_failed" });
            });

          return true;
        }

        if (message?.type === GENERATE_REPORT_MESSAGE_TYPE) {
          this.generateReport(message?.artifact || {}, {
            reportBackendBaseUrl: message?.reportBackendBaseUrl || ""
          })
            .then((report) => {
              sendResponse({ ok: true, report });
            })
            .catch((error) => {
              sendResponse({ ok: false, error: error?.message || "report_generation_failed" });
            });

          return true;
        }

        if (message?.type === GENERATE_GIST_MESSAGE_TYPE) {
          this.generateGist(message?.artifact || {}, {
            reportBackendBaseUrl: message?.reportBackendBaseUrl || ""
          })
            .then((report) => {
              sendResponse({ ok: true, report });
            })
            .catch((error) => {
              sendResponse({ ok: false, error: error?.message || "gist_generation_failed" });
            });

          return true;
        }

        if (message?.type === RESOLVE_TOP_TAKES_MESSAGE_TYPE) {
          this.resolveTopTakes(message.tweetId, {
            bearerToken: message?.bearerToken || "",
            apiBaseUrl: message?.apiBaseUrl || "",
            openAiApiKey: message?.openAiApiKey || "",
            openAiModel: message?.openAiModel || "",
            openAiBaseUrl: message?.openAiBaseUrl || "",
            maxQuoteTweets: message?.maxQuoteTweets,
            maxQuotePages: message?.maxQuotePages
          })
            .then((artifact) => {
              sendResponse({ ok: true, artifact });
            })
            .catch((error) => {
              sendResponse({ ok: false, error: error?.message || "top_takes_failed" });
            });

          return true;
        }

        return false;
      });
    },

    // Stream live progress to the panel so the user sees the path walk and reference phase unfold.
    registerPortHandler() {
      chromeApi.runtime.onConnect.addListener((port) => {
        if (!port || (port.name !== RESOLVE_ROOT_PATH_PORT_NAME && port.name !== GENERATE_REPORT_PORT_NAME && port.name !== GENERATE_GIST_PORT_NAME && port.name !== RESOLVE_TOP_TAKES_PORT_NAME)) {
          return;
        }

        port.onMessage.addListener((message) => {
          if (message?.type === RESOLVE_ROOT_PATH_MESSAGE_TYPE) {
            this.resolveRootPath(message.tweetId, {
              bearerToken: message?.bearerToken || "",
              apiBaseUrl: message?.apiBaseUrl || "",
              onProgress(progress) {
                port.postMessage({ type: "progress", progress });
              }
            })
              .then((artifact) => {
                port.postMessage({ type: "result", artifact });
              })
              .catch((error) => {
                port.postMessage({ type: "error", error: error?.message || "root_path_resolution_failed" });
              });
            return;
          }

          if (message?.type === GENERATE_REPORT_MESSAGE_TYPE) {
            this.generateReport(message?.artifact || {}, {
              reportBackendBaseUrl: message?.reportBackendBaseUrl || "",
              onProgress(progress) {
                port.postMessage({ type: "progress", progress });
              }
            })
              .then((report) => {
                port.postMessage({ type: "result", report });
              })
              .catch((error) => {
                port.postMessage({ type: "error", error: error?.message || "report_generation_failed" });
              });
            return;
          }

          if (message?.type === GENERATE_GIST_MESSAGE_TYPE) {
            this.generateGist(message?.artifact || {}, {
              reportBackendBaseUrl: message?.reportBackendBaseUrl || "",
              onProgress(progress) {
                port.postMessage({ type: "progress", progress });
              }
            })
              .then((report) => {
                port.postMessage({ type: "result", report });
              })
              .catch((error) => {
                port.postMessage({ type: "error", error: error?.message || "gist_generation_failed" });
              });
            return;
          }

          if (message?.type === RESOLVE_TOP_TAKES_MESSAGE_TYPE) {
            this.resolveTopTakes(message.tweetId, {
              bearerToken: message?.bearerToken || "",
              apiBaseUrl: message?.apiBaseUrl || "",
              openAiApiKey: message?.openAiApiKey || "",
              openAiModel: message?.openAiModel || "",
              openAiBaseUrl: message?.openAiBaseUrl || "",
              maxQuoteTweets: message?.maxQuoteTweets,
              maxQuotePages: message?.maxQuotePages,
              onProgress(progress) {
                port.postMessage({ type: "progress", progress });
              }
            })
              .then((artifact) => {
                port.postMessage({ type: "result", artifact });
              })
              .catch((error) => {
                port.postMessage({ type: "error", error: error?.message || "top_takes_failed" });
              });
          }
        });
      });
    }
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    RESOLVE_ROOT_PATH_MESSAGE_TYPE,
    CLEAR_CACHE_MESSAGE_TYPE,
    GENERATE_REPORT_MESSAGE_TYPE,
    GENERATE_GIST_MESSAGE_TYPE,
    RESOLVE_TOP_TAKES_MESSAGE_TYPE,
    RESOLVE_ROOT_PATH_PORT_NAME,
    GENERATE_REPORT_PORT_NAME,
    GENERATE_GIST_PORT_NAME,
    RESOLVE_TOP_TAKES_PORT_NAME,
    X_API_BEARER_STORAGE_KEYS,
    OPENAI_API_KEY_STORAGE_KEYS,
    OPENAI_MODEL_STORAGE_KEYS,
    OPENAI_BASE_URL_STORAGE_KEYS,
    DEFAULT_OPENAI_BASE_URL,
    DEFAULT_TOP_TAKES_MODEL,
    readChromeStorageLocalValue,
    resolveBearerToken,
    resolveFirstStorageValue,
    extractOpenAiJsonText,
    buildTopTakesSystemPrompt,
    buildTopTakesUserPrompt,
    callOpenAiTopTakesBatch,
    createBackgroundController
  };
} else {
  const controller = createBackgroundController({
    chromeApi: chrome,
    fetchImpl: fetch.bind(globalThis)
  });
  controller.registerMessageHandler();
  controller.registerPortHandler();
}
