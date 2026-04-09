"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");

const { resolveLocalServerConfig } = require("../server/llm_runtime.js");

function assertFileExists(label, filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${filePath || "(empty)"}`);
  }
}

function run({
  spawnImpl = spawn,
  existsSyncImpl = fs.existsSync,
  resolveConfig = resolveLocalServerConfig,
  consoleImpl = console,
  processObj = process
} = {}) {
  const config = resolveConfig();
  if (!config.enabled) {
    throw new Error("Local LLM is disabled. Set ARIADEX_LOCAL=true or enable llm.local in ariadex.config.json.");
  }

  if (!config.binary || !existsSyncImpl(config.binary)) {
    throw new Error(`Missing llama-server binary: ${config.binary || "(empty)"}`);
  }
  if (!config.modelPath || !existsSyncImpl(config.modelPath)) {
    throw new Error(`Missing local model: ${config.modelPath || "(empty)"}`);
  }

  const command = [
    config.binary,
    "-m",
    config.modelPath,
    "--host",
    config.host,
    "--port",
    String(config.port)
  ];

  consoleImpl.log(`[Ariadex] Starting local LLM server on ${config.baseUrl}`);
  consoleImpl.log(`[Ariadex] Model id: ${config.model}`);
  consoleImpl.log(`[Ariadex] Model path: ${config.modelPath}`);

  const child = spawnImpl(command[0], command.slice(1), {
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

  return { config, command, child };
}

function main() {
  try {
    run();
  } catch (error) {
    console.error(`[Ariadex] ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  assertFileExists,
  run,
  main
};
