"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const REPO_ROOT_DIR = path.resolve(__dirname, "..", "..");
const PROMPT_PATH = path.join(REPO_ROOT_DIR, "prompts", "generate_report.md");
const DEFAULT_BACKEND_BASE_URL = "http://127.0.0.1:8787";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

function parseDotEnv(rawText) {
  const parsed = {};
  for (const rawLine of String(rawText || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

function loadEnvFile() {
  const candidatePaths = [
    path.join(REPO_ROOT_DIR, ".env"),
    path.join(path.resolve(__dirname, ".."), ".env")
  ];
  for (const candidatePath of candidatePaths) {
    if (fs.existsSync(candidatePath)) {
      return parseDotEnv(fs.readFileSync(candidatePath, "utf8"));
    }
  }
  return {};
}

function loadRepoConfig() {
  const configPath = path.join(REPO_ROOT_DIR, "ariadex.config.json");
  try {
    if (!fs.existsSync(configPath)) {
      return {};
    }
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeOptional(value, fallback = "") {
  if (value == null) {
    return String(fallback || "").trim();
  }
  return String(value).trim();
}

function loadPrompt() {
  return fs.readFileSync(PROMPT_PATH, "utf8");
}

function resolveProviderConfig(env = {}, repoConfig = {}) {
  const safeEnv = env || {};
  const llmConfig = repoConfig?.llm && typeof repoConfig.llm === "object" ? repoConfig.llm : {};
  const openAiBaseUrl = normalizeOptional(
    safeEnv.OPENAI_BASE_URL ?? safeEnv.ARIADEX_OPENAI_BASE_URL ?? llmConfig.baseUrl,
    DEFAULT_OPENAI_BASE_URL
  );
  const openAiModel = normalizeOptional(
    safeEnv.OPENAI_MODEL
    ?? safeEnv.REPORT_MODEL_NAME
    ?? safeEnv.ARIADEX_OPENAI_ARTICLE_MODEL
    ?? safeEnv.ARIADEX_OPENAI_MODEL
    ?? llmConfig.articleModel
    ?? llmConfig.model,
    DEFAULT_OPENAI_MODEL
  );
  const openAiApiKey = normalizeOptional(
    safeEnv.OPENAI_API_KEY
    ?? safeEnv.ARIADEX_OPENAI_API_KEY
    ?? llmConfig.apiKey
  );
  if (!openAiApiKey) {
    throw new Error("missing_openai_api_key");
  }

  return {
    provider: "openai",
    apiBaseUrl: openAiBaseUrl,
    model: openAiModel,
    apiKey: openAiApiKey
  };
}

async function callReportModel({ fetchImpl, artifact, prompt, providerConfig }) {
  const effectiveFetch = typeof fetchImpl === "function"
    ? fetchImpl
    : (typeof fetch === "function" ? fetch.bind(globalThis) : null);
  if (!effectiveFetch) {
    throw new Error("missing_fetch_implementation");
  }

  const response = await effectiveFetch(`${providerConfig.apiBaseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(providerConfig.apiKey ? { Authorization: `Bearer ${providerConfig.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: providerConfig.model,
      temperature: 0.4,
      messages: [
        { role: "system", content: String(prompt || "") },
        { role: "user", content: JSON.stringify(artifact, null, 2) }
      ]
    })
  });

  if (!response?.ok) {
    let detail = "";
    try {
      detail = String(await response.text()).trim().slice(0, 300);
    } catch {}
    throw new Error(detail ? `report_generation_failed_${response.status}:${detail}` : `report_generation_failed_${response.status}`);
  }

  const payload = await response.json();
  const text = String(payload?.choices?.[0]?.message?.content || "").trim();
  if (!text) {
    throw new Error("empty_report_response");
  }

  return {
    text,
    model: providerConfig.model,
    apiBaseUrl: providerConfig.apiBaseUrl,
    provider: providerConfig.provider
  };
}

function jsonResponse(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  });
  res.end(`${JSON.stringify(payload)}\n`);
}

function createServer({ fetchImpl, env = null, repoConfig = null } = {}) {
  const resolvedEnv = env || { ...loadEnvFile(), ...process.env };
  const resolvedRepoConfig = repoConfig || loadRepoConfig();
  const prompt = loadPrompt();

  return http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      jsonResponse(res, 200, { ok: true });
      return;
    }

    if (req.method !== "POST" || req.url !== "/v1/report") {
      jsonResponse(res, 404, { ok: false, error: "not_found" });
      return;
    }

    try {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const rawBody = Buffer.concat(chunks).toString("utf8");
      const parsed = rawBody ? JSON.parse(rawBody) : {};
      const artifact = parsed?.artifact;
      if (!artifact || typeof artifact !== "object") {
        jsonResponse(res, 400, { ok: false, error: "missing_report_artifact" });
        return;
      }

      const providerConfig = resolveProviderConfig(resolvedEnv, resolvedRepoConfig);
      const report = await callReportModel({
        fetchImpl,
        artifact,
        prompt,
        providerConfig
      });
      jsonResponse(res, 200, { ok: true, report });
    } catch (error) {
      jsonResponse(res, 500, { ok: false, error: error?.message || "report_backend_failed" });
    }
  });
}

function startServer({ port = null, host = null, fetchImpl, env = null, repoConfig = null } = {}) {
  const effectiveEnv = env || { ...loadEnvFile(), ...process.env };
  const backendBaseUrl = normalizeOptional(
    effectiveEnv.REPORT_BACKEND_BASE_URL,
    DEFAULT_BACKEND_BASE_URL
  );
  let resolvedPort = port;
  let resolvedHost = host;
  if (!resolvedPort || !resolvedHost) {
    try {
      const parsed = new URL(backendBaseUrl);
      resolvedPort = resolvedPort || Number(parsed.port || 8787);
      resolvedHost = resolvedHost || parsed.hostname || "127.0.0.1";
    } catch {
      resolvedPort = resolvedPort || 8787;
      resolvedHost = resolvedHost || "127.0.0.1";
    }
  }
  const server = createServer({ fetchImpl, env: effectiveEnv, repoConfig });
  return new Promise((resolve) => {
    server.listen(resolvedPort, resolvedHost, () => {
      resolve({ server, port: resolvedPort, host: resolvedHost });
    });
  });
}

module.exports = {
  DEFAULT_BACKEND_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  parseDotEnv,
  loadEnvFile,
  loadRepoConfig,
  normalizeOptional,
  loadPrompt,
  resolveProviderConfig,
  callReportModel,
  createServer,
  startServer
};
