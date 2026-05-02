"use strict";

const fs = require("node:fs");
const path = require("node:path");

const V2_ROOT_DIR = path.resolve(__dirname, "..");
const REPO_ROOT_DIR = path.resolve(V2_ROOT_DIR, "..");
const ENV_CANDIDATE_PATHS = [
  path.join(V2_ROOT_DIR, ".env"),
  path.join(REPO_ROOT_DIR, ".env")
];
const OUTPUT_PATH = path.join(V2_ROOT_DIR, "extension", "dev_env.generated.json");
const REPO_CONFIG_PATH = path.join(REPO_ROOT_DIR, "ariadex.config.json");
const DEFAULT_REPORT_BACKEND_BASE_URL = "http://127.0.0.1:8787";

function parseDotEnv(rawText) {
  const parsed = {};
  const lines = String(rawText || "").split(/\r?\n/);

  for (const rawLine of lines) {
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
    if (!key) {
      continue;
    }

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

function resolveEnvPath() {
  return ENV_CANDIDATE_PATHS.find((candidatePath) => fs.existsSync(candidatePath)) || "";
}

function buildEnvObject() {
  const envPath = resolveEnvPath();
  const fileEnv = envPath ? parseDotEnv(fs.readFileSync(envPath, "utf8")) : {};
  let repoConfig = {};
  try {
    if (fs.existsSync(REPO_CONFIG_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(REPO_CONFIG_PATH, "utf8"));
      repoConfig = parsed && typeof parsed === "object" ? parsed : {};
    }
  } catch {}
  return {
    envPath,
    repoConfig,
    env: {
      ...fileEnv,
      ...process.env
    }
  };
}

function resolveReportConfig(env, repoConfig = {}) {
  const safeEnv = env || {};
  const llmConfig = repoConfig?.llm && typeof repoConfig.llm === "object" ? repoConfig.llm : {};
  const normalizeOptional = (value, fallback = "") => {
    if (value == null) {
      return String(fallback || "").trim();
    }
    return String(value).trim();
  };
  return {
    reportBackendBaseUrl: normalizeOptional(
      safeEnv.REPORT_BACKEND_BASE_URL,
      DEFAULT_REPORT_BACKEND_BASE_URL
    )
  };
}

function buildGeneratedConfig(env, repoConfig = {}) {
  const safeEnv = env || {};
  const bearerToken = String(safeEnv.X_BEARER_TOKEN || safeEnv.X_API_BEARER_TOKEN || "").trim();
  const apiBaseUrl = String(safeEnv.ARIADEX_X_API_BASE_URL || safeEnv.X_API_BASE_URL || "").trim();
  const reportConfig = resolveReportConfig(safeEnv, repoConfig);

  if (!bearerToken) {
    throw new Error("Missing X_BEARER_TOKEN or X_API_BEARER_TOKEN in .env/process env");
  }

  return {
    bearerToken,
    ...(apiBaseUrl ? { apiBaseUrl } : {}),
    ...(reportConfig.reportBackendBaseUrl ? { reportBackendBaseUrl: reportConfig.reportBackendBaseUrl } : {})
  };
}

function syncFromEnvironment() {
  const { envPath, env, repoConfig } = buildEnvObject();
  if (!envPath) {
    throw new Error(`Missing .env file. Looked in: ${ENV_CANDIDATE_PATHS.join(", ")}`);
  }

  const config = buildGeneratedConfig(env, repoConfig);
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  console.log(`[Ariadex v2] Wrote ${OUTPUT_PATH} from ${envPath}`);
  console.log("[Ariadex v2] Reload the unpacked extension in chrome://extensions to apply updated credentials.");
}

function main() {
  try {
    syncFromEnvironment();
  } catch (error) {
    console.error(`[Ariadex v2] ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  ENV_CANDIDATE_PATHS,
  OUTPUT_PATH,
  parseDotEnv,
  resolveEnvPath,
  buildEnvObject,
  resolveReportConfig,
  buildGeneratedConfig,
  syncFromEnvironment
};
