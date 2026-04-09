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
  merged.ARIADEX_ENABLE_OPENAI_CONTRIBUTION_FILTER = merged.ARIADEX_ENABLE_OPENAI_CONTRIBUTION_FILTER || "true";
  merged.ARIADEX_LLM_MODEL = merged.ARIADEX_LLM_MODEL || merged.ARIADEX_OPENAI_MODEL || "gpt-4o-mini";
  merged.ARIADEX_OPENAI_MODEL = merged.ARIADEX_OPENAI_MODEL || "gpt-4o-mini";
  return merged;
}

function ensureBearer(env) {
  const bearer = (env.X_BEARER_TOKEN || env.X_API_BEARER_TOKEN || "").trim();
  if (!bearer) {
    throw new Error("Missing X_BEARER_TOKEN (or X_API_BEARER_TOKEN) in .env/process env");
  }
}

function run({
  buildEnvObjectImpl = buildEnvObject,
  syncFromEnvironmentImpl = syncFromEnvironment,
  spawnImpl = spawn,
  processObj = process
} = {}) {
  const baseEnv = buildEnvObjectImpl();
  const env = withDefaults({
    ...processObj.env,
    ...baseEnv
  });

  ensureBearer(env);

  // Ensure extension runtime config points to local graph cache service.
  processObj.env.ARIADEX_ENV = env.ARIADEX_ENV;
  processObj.env.ARIADEX_ALLOW_CLIENT_DIRECT_API = env.ARIADEX_ALLOW_CLIENT_DIRECT_API;
  processObj.env.ARIADEX_GRAPH_API_URL = env.ARIADEX_GRAPH_API_URL;
  processObj.env.ARIADEX_GRAPH_API_URL_DEV = env.ARIADEX_GRAPH_API_URL_DEV;
  processObj.env.X_BEARER_TOKEN = env.X_BEARER_TOKEN || env.X_API_BEARER_TOKEN;
  processObj.env.X_API_BEARER_TOKEN = env.X_API_BEARER_TOKEN || env.X_BEARER_TOKEN;
  syncFromEnvironmentImpl();

  const child = spawnImpl(processObj.execPath, [SERVER_ENTRY], {
    cwd: ROOT_DIR,
    env,
    stdio: "inherit"
  });

  const stop = () => {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  };

  processObj.on("SIGINT", stop);
  processObj.on("SIGTERM", stop);

  child.on("exit", (code, signal) => {
    if (signal) {
      processObj.exitCode = 1;
      return;
    }
    processObj.exitCode = code || 0;
  });

  return {
    env,
    child
  };
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    console.error(`[Ariadex] ${error.message}`);
    process.exitCode = 1;
  }
} else {
  module.exports = {
    withDefaults,
    ensureBearer,
    run
  };
}
