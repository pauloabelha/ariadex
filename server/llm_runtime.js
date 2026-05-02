"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT_DIR, "ariadex.config.json");

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:8091/v1";
const DEFAULT_LOCAL_MODEL = "google_gemma-4-E2B-it-Q4_K_M";
const DEFAULT_LOCAL_SERVER_BINARY = "/home/pauloabelha/alienware16-llm/llama.cpp/build-cuda/bin/llama-server";
const DEFAULT_LOCAL_SERVER_MODEL_PATH = "/home/pauloabelha/alienware16-llm/llama.cpp/models/gemma4/google_gemma-4-E2B-it-Q4_K_M.gguf";

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

function loadRepoConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      return {};
    }
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function getLlmConfig() {
  const repoConfig = loadRepoConfig();
  return repoConfig.llm && typeof repoConfig.llm === "object"
    ? repoConfig.llm
    : {};
}

function normalizeBaseUrl(value, fallback = DEFAULT_OPENAI_BASE_URL) {
  const raw = String(value || fallback || "").trim();
  return raw.replace(/\/$/, "");
}

function parseBaseUrl(value) {
  try {
    return new URL(normalizeBaseUrl(value));
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname || "").trim().toLowerCase();
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized === "[::1]";
}

function isLocalBaseUrl(value) {
  const parsed = parseBaseUrl(value);
  return Boolean(parsed && isLoopbackHostname(parsed.hostname));
}

function isLocalEnabled(explicitLocal) {
  const llmConfig = getLlmConfig();
  return toBoolean(
    explicitLocal,
    toBoolean(process.env.USE_LOCAL_LLM, toBoolean(process.env.ARIADEX_LOCAL, toBoolean(llmConfig.local, true)))
  );
}

function deriveProviderName(baseUrl, explicitLocal) {
  if (isLocalEnabled(explicitLocal) || isLocalBaseUrl(baseUrl)) {
    return "local";
  }
  return "openai";
}

function resolveEndpointBase(explicitBase, { local = undefined } = {}) {
  const llmConfig = getLlmConfig();
  if (explicitBase) {
    return normalizeBaseUrl(explicitBase);
  }

  if (isLocalEnabled(local)) {
    return normalizeBaseUrl(
      process.env.ARIADEX_LOCAL_BASE_URL
      || llmConfig.localBaseUrl
      || DEFAULT_LOCAL_BASE_URL
    );
  }

  return normalizeBaseUrl(
    process.env.ARIADEX_LLM_BASE_URL
    || process.env.ARIADEX_OPENAI_BASE_URL
    || llmConfig.baseUrl
    || DEFAULT_OPENAI_BASE_URL
  );
}

function resolveContributionModel(explicitModel, { local = undefined } = {}) {
  const llmConfig = getLlmConfig();
  if (explicitModel) {
    return String(explicitModel).trim();
  }

  if (isLocalEnabled(local)) {
    return String(
      process.env.ARIADEX_LOCAL_MODEL
      || llmConfig.localModel
      || DEFAULT_LOCAL_MODEL
    ).trim();
  }

  return String(
    process.env.ARIADEX_LLM_MODEL
    || process.env.ARIADEX_OPENAI_MODEL
    || llmConfig.model
    || DEFAULT_OPENAI_MODEL
  ).trim();
}

function resolveArticleModel(explicitModel, { local = undefined } = {}) {
  const llmConfig = getLlmConfig();
  if (explicitModel) {
    return String(explicitModel).trim();
  }

  if (isLocalEnabled(local)) {
    return String(
      process.env.ARIADEX_LOCAL_ARTICLE_MODEL
      || process.env.ARIADEX_LOCAL_MODEL
      || llmConfig.localArticleModel
      || llmConfig.localModel
      || DEFAULT_LOCAL_MODEL
    ).trim();
  }

  return String(
    process.env.ARIADEX_LLM_ARTICLE_MODEL
    || process.env.ARIADEX_OPENAI_ARTICLE_MODEL
    || process.env.ARIADEX_LLM_MODEL
    || process.env.ARIADEX_OPENAI_MODEL
    || llmConfig.articleModel
    || llmConfig.model
    || DEFAULT_OPENAI_MODEL
  ).trim();
}

function resolveApiKeyFromEnv(explicitApiKey, endpointBase, { local = undefined } = {}) {
  const llmConfig = getLlmConfig();
  const trimmed = String(
    explicitApiKey
    || (isLocalEnabled(local)
      ? (process.env.ARIADEX_LOCAL_API_KEY || llmConfig.localApiKey || "")
      : (process.env.ARIADEX_LLM_API_KEY || process.env.OPENAI_API_KEY || llmConfig.apiKey || ""))
  ).trim();
  if (trimmed) {
    return trimmed;
  }
  if (isLocalEnabled(local) || isLocalBaseUrl(endpointBase)) {
    return "";
  }
  return "";
}

function buildAuthHeaders(apiKey) {
  const trimmed = String(apiKey || "").trim();
  return trimmed ? { Authorization: `Bearer ${trimmed}` } : {};
}

function createProviderSignature({ provider, model, endpointBase }) {
  const parsed = parseBaseUrl(endpointBase);
  const endpointId = parsed
    ? `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/$/, "")}`
    : normalizeBaseUrl(endpointBase);
  return `${provider}:${model}@${endpointId}`;
}

function resolveLocalServerConfig() {
  const llmConfig = getLlmConfig();
  const baseUrl = resolveEndpointBase(undefined, { local: true });
  const parsedBaseUrl = parseBaseUrl(baseUrl);
  return {
    enabled: isLocalEnabled(true),
    baseUrl,
    binary: String(
      process.env.ARIADEX_LOCAL_SERVER_BINARY
      || llmConfig.localServerBinary
      || DEFAULT_LOCAL_SERVER_BINARY
    ).trim(),
    modelPath: String(
      process.env.ARIADEX_LOCAL_SERVER_MODEL_PATH
      || llmConfig.localServerModelPath
      || DEFAULT_LOCAL_SERVER_MODEL_PATH
    ).trim(),
    host: String(
      process.env.ARIADEX_LOCAL_SERVER_HOST
      || parsedBaseUrl?.hostname
      || llmConfig.localServerHost
      || "127.0.0.1"
    ).trim(),
    port: Number(
      process.env.ARIADEX_LOCAL_SERVER_PORT
      || parsedBaseUrl?.port
      || llmConfig.localServerPort
      || 8091
    ),
    model: resolveContributionModel(undefined, { local: true }),
    articleModel: resolveArticleModel(undefined, { local: true }),
    apiKey: resolveApiKeyFromEnv(undefined, baseUrl, { local: true })
  };
}

module.exports = {
  CONFIG_PATH,
  DEFAULT_LOCAL_BASE_URL,
  DEFAULT_LOCAL_MODEL,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  buildAuthHeaders,
  createProviderSignature,
  deriveProviderName,
  getLlmConfig,
  isLocalBaseUrl,
  isLocalEnabled,
  resolveApiKeyFromEnv,
  resolveArticleModel,
  resolveContributionModel,
  resolveEndpointBase,
  resolveLocalServerConfig,
  toBoolean
};
