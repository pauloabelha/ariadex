"use strict";

const fs = require("node:fs");
const path = require("node:path");

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

function buildEnvObject() {
  const fileEnv = fs.existsSync(ENV_PATH)
    ? parseDotEnv(fs.readFileSync(ENV_PATH, "utf8"))
    : {};

  return {
    ...fileEnv,
    ...process.env
  };
}

function buildGeneratedConfig(env) {
  const safeEnv = env || {};
  const bearerToken = (safeEnv.X_BEARER_TOKEN || safeEnv.X_API_BEARER_TOKEN || "").trim();
  if (!bearerToken) {
    throw new Error("Missing X_BEARER_TOKEN (or X_API_BEARER_TOKEN) in .env/process env");
  }

  const followingIds = parseFollowingIds(safeEnv.X_FOLLOWING_IDS || "");
  const graphApiUrl = (safeEnv.ARIADEX_GRAPH_API_URL || "").trim();

  return {
    bearerToken,
    ...(followingIds.length > 0 ? { followingIds } : {}),
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
  buildEnvObject,
  buildGeneratedConfig,
  syncFromEnvironment
};
