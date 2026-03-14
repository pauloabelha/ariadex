"use strict";

const path = require("node:path");
const { spawn } = require("node:child_process");

const { buildEnvObject, syncFromEnvironment } = require("./sync_env_to_generated_config.js");

const ROOT_DIR = path.resolve(__dirname, "..");
const SERVER_ENTRY = path.join(ROOT_DIR, "server", "graph_cache_server.js");

function withDefaults(env) {
  const merged = { ...env };
  merged.ARIADEX_ENV = merged.ARIADEX_ENV || "dev";
  merged.ARIADEX_ALLOW_CLIENT_DIRECT_API = "false";
  merged.ARIADEX_GRAPH_CACHE_PORT = String(merged.ARIADEX_GRAPH_CACHE_PORT || "8787");
  merged.ARIADEX_GRAPH_API_URL = merged.ARIADEX_GRAPH_API_URL || `http://127.0.0.1:${merged.ARIADEX_GRAPH_CACHE_PORT}`;
  merged.ARIADEX_GRAPH_API_URL_DEV = merged.ARIADEX_GRAPH_API_URL_DEV || merged.ARIADEX_GRAPH_API_URL;
  merged.ARIADEX_GRAPH_CACHE_FILE = merged.ARIADEX_GRAPH_CACHE_FILE
    || path.join(ROOT_DIR, ".cache", "graph_cache_store.json");
  return merged;
}

function ensureBearer(env) {
  const bearer = (env.X_BEARER_TOKEN || env.X_API_BEARER_TOKEN || "").trim();
  if (!bearer) {
    throw new Error("Missing X_BEARER_TOKEN (or X_API_BEARER_TOKEN) in .env/process env");
  }
}

function run() {
  const baseEnv = buildEnvObject();
  const env = withDefaults({
    ...process.env,
    ...baseEnv
  });

  ensureBearer(env);

  // Ensure extension runtime config points to local graph cache service.
  process.env.ARIADEX_ENV = env.ARIADEX_ENV;
  process.env.ARIADEX_ALLOW_CLIENT_DIRECT_API = env.ARIADEX_ALLOW_CLIENT_DIRECT_API;
  process.env.ARIADEX_GRAPH_API_URL = env.ARIADEX_GRAPH_API_URL;
  process.env.ARIADEX_GRAPH_API_URL_DEV = env.ARIADEX_GRAPH_API_URL_DEV;
  process.env.X_BEARER_TOKEN = env.X_BEARER_TOKEN || env.X_API_BEARER_TOKEN;
  process.env.X_API_BEARER_TOKEN = env.X_API_BEARER_TOKEN || env.X_BEARER_TOKEN;
  syncFromEnvironment();

  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: ROOT_DIR,
    env,
    stdio: "inherit"
  });

  const stop = () => {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  child.on("exit", (code, signal) => {
    if (signal) {
      process.exitCode = 1;
      return;
    }
    process.exitCode = code || 0;
  });
}

try {
  run();
} catch (error) {
  console.error(`[Ariadex] ${error.message}`);
  process.exitCode = 1;
}
