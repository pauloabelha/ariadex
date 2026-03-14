"use strict";

const {
  buildEnvObject,
  normalizeRuntimeEnvironment,
  syncFromEnvironment
} = require("./sync_env_to_generated_config.js");

function parseArgs(argv) {
  const out = {};
  for (const arg of argv.slice(2)) {
    if (!arg.startsWith("--")) {
      continue;
    }
    const [rawKey, rawValue = ""] = arg.slice(2).split("=");
    const key = rawKey.trim();
    if (!key) {
      continue;
    }
    out[key] = rawValue.trim();
  }
  return out;
}

function run() {
  const args = parseArgs(process.argv);
  const baseEnv = buildEnvObject();

  const runtimeEnv = normalizeRuntimeEnvironment(args.env || baseEnv.ARIADEX_ENV || "dev");
  process.env.ARIADEX_ENV = runtimeEnv;

  if (args.graphApiUrl) {
    process.env.ARIADEX_GRAPH_API_URL = args.graphApiUrl;
  }

  if (args.graphApiUrlDev) {
    process.env.ARIADEX_GRAPH_API_URL_DEV = args.graphApiUrlDev;
  }

  if (args.graphApiUrlProd) {
    process.env.ARIADEX_GRAPH_API_URL_PROD = args.graphApiUrlProd;
  }

  syncFromEnvironment();

  console.log(`[Ariadex] Runtime environment set to ${runtimeEnv}`);
  if (process.env.ARIADEX_GRAPH_API_URL) {
    console.log(`[Ariadex] Active graphApiUrl override: ${process.env.ARIADEX_GRAPH_API_URL}`);
  }
}

try {
  run();
} catch (error) {
  console.error(`[Ariadex] ${error.message}`);
  process.exitCode = 1;
}
