"use strict";

if (typeof importScripts === "function") {
  importScripts("./dev_env_loader.js");
  importScripts("./algo.js");
  importScripts("./report_generation.js");
}

const algo = typeof module !== "undefined" && module.exports
  ? require("./algo.js")
  : globalThis.AriadeXV2Algo;
const devEnvLoader = typeof module !== "undefined" && module.exports
  ? require("./dev_env_loader.js")
  : globalThis;
const reportGeneration = typeof module !== "undefined" && module.exports
  ? require("./report_generation.js")
  : globalThis.AriadexV2ReportGeneration;

const RESOLVE_ROOT_PATH_MESSAGE_TYPE = "ARIADEx_V2_RESOLVE_ROOT_PATH";
const CLEAR_CACHE_MESSAGE_TYPE = "ARIADEx_V2_CLEAR_CACHE";
const GENERATE_REPORT_MESSAGE_TYPE = "ARIADEx_V2_GENERATE_REPORT";
const RESOLVE_ROOT_PATH_PORT_NAME = "ARIADEx_V2_RESOLVE_ROOT_PATH_PORT";
const GENERATE_REPORT_PORT_NAME = "ARIADEx_V2_GENERATE_REPORT_PORT";
const X_API_BEARER_STORAGE_KEYS = [
  "ariadex.x_api_bearer_token",
  "ariadex.xApiBearerToken"
];

function readChromeStorageLocalValue(chromeApi, key) {
  return new Promise((resolve) => {
    const storageLocal = chromeApi?.storage?.local;
    if (!storageLocal?.get) {
      resolve("");
      return;
    }

    storageLocal.get([key], (result) => {
      const runtimeError = chromeApi?.runtime?.lastError;
      if (runtimeError) {
        resolve("");
        return;
      }

      const value = result?.[key];
      resolve(typeof value === "string" ? value.trim() : "");
    });
  });
}

async function resolveBearerToken(chromeApi, providedToken) {
  const directToken = String(providedToken || "").trim();
  if (directToken) {
    return directToken;
  }

  for (const key of X_API_BEARER_STORAGE_KEYS) {
    const candidate = await readChromeStorageLocalValue(chromeApi, key);
    if (candidate) {
      return candidate;
    }
  }

  return "";
}

// The background worker is intentionally thin: it wires Chrome runtime events into the pure algorithm module.
function createBackgroundController({ chromeApi, fetchImpl, algoApi = algo }) {
  const storage = algoApi.createStorageAdapter(chromeApi);
  const effectiveFetch = typeof fetchImpl === "function"
    ? fetchImpl
    : (typeof fetch === "function" ? fetch.bind(globalThis) : null);

  return {
    // Share one resolver entry point across one-shot requests and streaming progress ports.
    async resolveRootPath(tweetId, options = {}) {
      let generatedConfig = null;
      if (typeof devEnvLoader?.loadGeneratedConfig === "function") {
        try {
          generatedConfig = await devEnvLoader.loadGeneratedConfig({
            chromeApi,
            fetchImpl: effectiveFetch,
            view: typeof window !== "undefined" ? window : null
          });
        } catch {}
      } else if (globalThis?.AriadexV2DevEnvReady && typeof globalThis.AriadexV2DevEnvReady.then === "function") {
        try {
          await globalThis.AriadexV2DevEnvReady;
        } catch {}
      }

      const bearerToken = await resolveBearerToken(chromeApi, options?.bearerToken || "");
      const apiBaseUrl = String(
        options?.apiBaseUrl
        || generatedConfig?.apiBaseUrl
        || globalThis?.AriadexXApiSettings?.apiBaseUrl
        || algoApi.DEFAULT_API_BASE_URL
      ).trim() || algoApi.DEFAULT_API_BASE_URL;
      const client = algoApi.createTweetClient(fetchImpl, {
        bearerToken,
        apiBaseUrl
      });
      return algoApi.resolveRootPath(tweetId, {
        storage,
        client,
        onProgress: typeof options?.onProgress === "function" ? options.onProgress : null
      });
    },

    async clearCache() {
      await storage.clearCache();
      return { cleared: true };
    },

    async generateReport(artifact, options = {}) {
      let generatedConfig = null;
      if (typeof options?.onProgress === "function") {
        options.onProgress({ phase: "loading_report_config" });
      }
      if (typeof devEnvLoader?.loadGeneratedConfig === "function") {
        try {
          generatedConfig = await devEnvLoader.loadGeneratedConfig({
            chromeApi,
            fetchImpl: effectiveFetch,
            view: typeof window !== "undefined" ? window : null
          });
        } catch {}
      }

      const reportSettings = reportGeneration.normalizeReportSettings({
        reportBackendBaseUrl: options?.reportBackendBaseUrl
          || generatedConfig?.reportBackendBaseUrl
          || globalThis?.AriadexReportSettings?.backendBaseUrl
          || ""
      });

      return reportGeneration.generateReport({
        fetchImpl: effectiveFetch,
        artifact,
        settings: reportSettings,
        onProgress: typeof options?.onProgress === "function" ? options.onProgress : null
      });
    },

    // Support the simplest request-response flow used by tests and fallback content-script code paths.
    registerMessageHandler() {
      chromeApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.type === RESOLVE_ROOT_PATH_MESSAGE_TYPE) {
          this.resolveRootPath(message.tweetId, {
            bearerToken: message?.bearerToken || "",
            apiBaseUrl: message?.apiBaseUrl || ""
          })
            .then((artifact) => {
              sendResponse({ ok: true, artifact });
            })
            .catch((error) => {
              sendResponse({ ok: false, error: error?.message || "root_path_resolution_failed" });
            });

          return true;
        }

        if (message?.type === CLEAR_CACHE_MESSAGE_TYPE) {
          this.clearCache()
            .then((result) => {
              sendResponse({ ok: true, ...result });
            })
            .catch((error) => {
              sendResponse({ ok: false, error: error?.message || "cache_clear_failed" });
            });

          return true;
        }

        if (message?.type === GENERATE_REPORT_MESSAGE_TYPE) {
          this.generateReport(message?.artifact || {}, {
            reportBackendBaseUrl: message?.reportBackendBaseUrl || ""
          })
            .then((report) => {
              sendResponse({ ok: true, report });
            })
            .catch((error) => {
              sendResponse({ ok: false, error: error?.message || "report_generation_failed" });
            });

          return true;
        }

        return false;
      });
    },

    // Stream live progress to the panel so the user sees the path walk and reference phase unfold.
    registerPortHandler() {
      chromeApi.runtime.onConnect.addListener((port) => {
        if (!port || (port.name !== RESOLVE_ROOT_PATH_PORT_NAME && port.name !== GENERATE_REPORT_PORT_NAME)) {
          return;
        }

        port.onMessage.addListener((message) => {
          if (message?.type === RESOLVE_ROOT_PATH_MESSAGE_TYPE) {
            this.resolveRootPath(message.tweetId, {
              bearerToken: message?.bearerToken || "",
              apiBaseUrl: message?.apiBaseUrl || "",
              onProgress(progress) {
                port.postMessage({ type: "progress", progress });
              }
            })
              .then((artifact) => {
                port.postMessage({ type: "result", artifact });
              })
              .catch((error) => {
                port.postMessage({ type: "error", error: error?.message || "root_path_resolution_failed" });
              });
            return;
          }

          if (message?.type === GENERATE_REPORT_MESSAGE_TYPE) {
            this.generateReport(message?.artifact || {}, {
              reportBackendBaseUrl: message?.reportBackendBaseUrl || "",
              onProgress(progress) {
                port.postMessage({ type: "progress", progress });
              }
            })
              .then((report) => {
                port.postMessage({ type: "result", report });
              })
              .catch((error) => {
                port.postMessage({ type: "error", error: error?.message || "report_generation_failed" });
              });
          }
        });
      });
    }
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    RESOLVE_ROOT_PATH_MESSAGE_TYPE,
    CLEAR_CACHE_MESSAGE_TYPE,
    GENERATE_REPORT_MESSAGE_TYPE,
    RESOLVE_ROOT_PATH_PORT_NAME,
    GENERATE_REPORT_PORT_NAME,
    X_API_BEARER_STORAGE_KEYS,
    readChromeStorageLocalValue,
    resolveBearerToken,
    createBackgroundController
  };
} else {
  const controller = createBackgroundController({
    chromeApi: chrome,
    fetchImpl: fetch.bind(globalThis)
  });
  controller.registerMessageHandler();
  controller.registerPortHandler();
}
