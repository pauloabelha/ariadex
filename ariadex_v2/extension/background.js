"use strict";

if (typeof importScripts === "function") {
  importScripts("./algo.js");
}

const algo = typeof module !== "undefined" && module.exports
  ? require("./algo.js")
  : globalThis.AriadeXV2Algo;

const RESOLVE_ROOT_PATH_MESSAGE_TYPE = "ARIADEx_V2_RESOLVE_ROOT_PATH";
const CLEAR_CACHE_MESSAGE_TYPE = "ARIADEx_V2_CLEAR_CACHE";
const RESOLVE_ROOT_PATH_PORT_NAME = "ARIADEx_V2_RESOLVE_ROOT_PATH_PORT";

// The background worker is intentionally thin: it wires Chrome runtime events into the pure algorithm module.
function createBackgroundController({ chromeApi, fetchImpl, algoApi = algo }) {
  const storage = algoApi.createStorageAdapter(chromeApi);
  const client = algoApi.createTweetClient(fetchImpl);

  return {
    // Share one resolver entry point across one-shot requests and streaming progress ports.
    async resolveRootPath(tweetId, options = {}) {
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

    // Support the simplest request-response flow used by tests and fallback content-script code paths.
    registerMessageHandler() {
      chromeApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.type === RESOLVE_ROOT_PATH_MESSAGE_TYPE) {
          this.resolveRootPath(message.tweetId)
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

        return false;
      });
    },

    // Stream live progress to the panel so the user sees the path walk and reference phase unfold.
    registerPortHandler() {
      chromeApi.runtime.onConnect.addListener((port) => {
        if (!port || port.name !== RESOLVE_ROOT_PATH_PORT_NAME) {
          return;
        }

        port.onMessage.addListener((message) => {
          if (message?.type !== RESOLVE_ROOT_PATH_MESSAGE_TYPE) {
            return;
          }

          this.resolveRootPath(message.tweetId, {
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
        });
      });
    }
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    RESOLVE_ROOT_PATH_MESSAGE_TYPE,
    CLEAR_CACHE_MESSAGE_TYPE,
    RESOLVE_ROOT_PATH_PORT_NAME,
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
