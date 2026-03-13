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

function main() {
  if (!fs.existsSync(ENV_PATH)) {
    console.error(`[Ariadex] Missing .env file at ${ENV_PATH}`);
    process.exitCode = 1;
    return;
  }

  const env = parseDotEnv(fs.readFileSync(ENV_PATH, "utf8"));
  const bearerToken = (env.X_BEARER_TOKEN || env.X_API_BEARER_TOKEN || "").trim();
  if (!bearerToken) {
    console.error("[Ariadex] Missing X_BEARER_TOKEN (or X_API_BEARER_TOKEN) in .env");
    process.exitCode = 1;
    return;
  }

  const followingIds = parseFollowingIds(env.X_FOLLOWING_IDS || "");
  const config = {
    bearerToken,
    ...(followingIds.length > 0 ? { followingIds } : {})
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  console.log(`[Ariadex] Wrote ${OUTPUT_PATH}`);
  console.log("[Ariadex] Reload the unpacked extension in chrome://extensions to apply updated credentials.");
}

main();
