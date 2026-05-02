"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT_DIR, ".env");
const OUTPUT_PATH = path.join(ROOT_DIR, "extension", "dev_env.generated.json");

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

function parseFollowingIds(rawValue) {
  if (typeof rawValue !== "string" || !rawValue.trim()) {
    return [];
  }

  return [...new Set(
    rawValue
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  )];
}

function normalizeRuntimeEnvironment(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "dev";
  }
  return normalized;
}

function resolveGraphApiByEnv(env) {
  const safeEnv = env || {};
  const byEnv = {};

  const devUrl = String(safeEnv.ARIADEX_GRAPH_API_URL_DEV || "").trim();
  const prodUrl = String(safeEnv.ARIADEX_GRAPH_API_URL_PROD || "").trim();

  if (devUrl) {
    byEnv.dev = devUrl;
  }
  if (prodUrl) {
    byEnv.prod = prodUrl;
  }

  return byEnv;
}

function resolveGraphApiUrl(env, runtimeEnv, byEnv) {
  const safeEnv = env || {};
  const explicit = String(safeEnv.ARIADEX_GRAPH_API_URL || "").trim();
  if (explicit) {
    return explicit;
  }

  const fromMap = byEnv?.[runtimeEnv];
  if (typeof fromMap === "string" && fromMap.trim()) {
    return fromMap.trim();
  }

  return "";
}

function buildEnvObject() {
  const fileEnv = fs.existsSync(ENV_PATH)
    ? parseDotEnv(fs.readFileSync(ENV_PATH, "utf8"))
    : {};

  return {
    ...fileEnv,
    ...process.env
  };
}

function resolveBranchName(env) {
  const explicit = String(env?.ARIADEX_BRANCH_NAME || "").trim();
  if (explicit) {
    return explicit;
  }

  try {
    const branchName = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: ROOT_DIR,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return branchName || "";
  } catch {
    return "";
  }
}

function buildGeneratedConfig(env) {
  const safeEnv = env || {};
  const bearerToken = (safeEnv.X_BEARER_TOKEN || safeEnv.X_API_BEARER_TOKEN || "").trim();
  const allowClientDirectApi = String(safeEnv.ARIADEX_ALLOW_CLIENT_DIRECT_API || "").trim().toLowerCase() === "true";

  const followingIds = parseFollowingIds(safeEnv.X_FOLLOWING_IDS || "");
  const environment = normalizeRuntimeEnvironment(safeEnv.ARIADEX_ENV || safeEnv.ARIADEX_RUNTIME_ENV || "dev");
  const branchName = resolveBranchName(safeEnv);
  const graphApiByEnv = resolveGraphApiByEnv(safeEnv);
  const graphApiUrl = resolveGraphApiUrl(safeEnv, environment, graphApiByEnv);
  if (!graphApiUrl && !(allowClientDirectApi && bearerToken)) {
    throw new Error("Missing graph API URL. Set ARIADEX_GRAPH_API_URL (or ARIADEX_GRAPH_API_URL_DEV/PROD).");
  }

  return {
    environment,
    ...(branchName ? { branchName } : {}),
    allowClientDirectApi,
    ...(allowClientDirectApi && bearerToken ? { bearerToken } : {}),
    ...(followingIds.length > 0 ? { followingIds } : {}),
    ...(Object.keys(graphApiByEnv).length > 0 ? { graphApiByEnv } : {}),
    ...(graphApiUrl ? { graphApiUrl } : {})
  };
}

function syncFromEnvironment() {
  if (!fs.existsSync(ENV_PATH)) {
    throw new Error(`Missing .env file at ${ENV_PATH}`);
  }

  const env = buildEnvObject();
  const config = buildGeneratedConfig(env);

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  console.log(`[Ariadex] Wrote ${OUTPUT_PATH}`);
  console.log("[Ariadex] Reload the unpacked extension in chrome://extensions to apply updated credentials.");
}

function main() {
  try {
    syncFromEnvironment();
  } catch (error) {
    console.error(`[Ariadex] ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseDotEnv,
  parseFollowingIds,
  normalizeRuntimeEnvironment,
  resolveGraphApiByEnv,
  resolveGraphApiUrl,
  buildEnvObject,
  resolveBranchName,
  buildGeneratedConfig,
  syncFromEnvironment
};
