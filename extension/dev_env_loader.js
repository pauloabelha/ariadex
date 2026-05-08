(() => {
  "use strict";

  const GENERATED_CONFIG_FILE = "dev_env.generated.json";
  const BEARER_STORAGE_KEYS = [
    "ariadex.x_api_bearer_token",
    "ariadex.xApiBearerToken"
  ];

  function isExtensionContextValid(chromeApi = chrome) {
    return Boolean(
      chromeApi
      && chromeApi.runtime
      && chromeApi.runtime.id
      && chromeApi.runtime.id !== "invalid"
    );
  }

  function getGeneratedConfigUrl(chromeApi = chrome) {
    if (!isExtensionContextValid(chromeApi) || typeof chromeApi.runtime?.getURL !== "function") {
      return "";
    }

    try {
      return String(chromeApi.runtime.getURL(GENERATED_CONFIG_FILE) || "");
    } catch {
      return "";
    }
  }

  function isGeneratedConfigUrlSafe(url) {
    if (!url) {
      return false;
    }

    try {
      const parsed = new URL(String(url));
      return parsed.protocol === "chrome-extension:" && Boolean(parsed.hostname) && parsed.hostname !== "invalid";
    } catch {
      return false;
    }
  }

  function normalizeConfig(config) {
    if (!config || typeof config !== "object") {
      return {};
    }

    const bearerToken = typeof config.bearerToken === "string" ? config.bearerToken.trim() : "";
    const apiBaseUrl = typeof config.apiBaseUrl === "string" ? config.apiBaseUrl.trim() : "";
    const reportBackendBaseUrl = typeof config.reportBackendBaseUrl === "string" ? config.reportBackendBaseUrl.trim() : "";

    return {
      ...(bearerToken ? { bearerToken } : {}),
      ...(apiBaseUrl ? { apiBaseUrl } : {}),
      ...(reportBackendBaseUrl ? { reportBackendBaseUrl } : {})
    };
  }

  function persistBearerToken(bearerToken, chromeApi = chrome, view = globalThis.window) {
    const trimmedToken = String(bearerToken || "").trim();
    if (!trimmedToken) {
      return;
    }

    if (view && typeof view === "object") {
      view.AriadexXApiSettings = {
        ...(view.AriadexXApiSettings || {}),
        bearerToken: trimmedToken
      };
      view.AriadexXApiBearerToken = trimmedToken;
    }

    for (const key of BEARER_STORAGE_KEYS) {
      try {
        view?.localStorage?.setItem?.(key, trimmedToken);
      } catch {}
    }

    if (chromeApi?.storage?.local?.set) {
      chromeApi.storage.local.set({
        [BEARER_STORAGE_KEYS[0]]: trimmedToken,
        [BEARER_STORAGE_KEYS[1]]: trimmedToken
      }, () => {});
    }
  }

  async function loadGeneratedConfig({
    chromeApi = chrome,
    fetchImpl = typeof fetch === "function" ? fetch.bind(globalThis) : null,
    view = globalThis.window
  } = {}) {
    if (!fetchImpl || !isExtensionContextValid(chromeApi)) {
      return null;
    }

    const url = getGeneratedConfigUrl(chromeApi);
    if (!isGeneratedConfigUrlSafe(url)) {
      return null;
    }

    try {
      const response = await fetchImpl(url, { cache: "no-store" });
      if (!response?.ok) {
        return null;
      }

      const config = normalizeConfig(await response.json());
      if (config.bearerToken) {
        persistBearerToken(config.bearerToken, chromeApi, view);
      }
      if (config.apiBaseUrl && view && typeof view === "object") {
        view.AriadexXApiSettings = {
          ...(view.AriadexXApiSettings || {}),
          apiBaseUrl: config.apiBaseUrl
        };
      }
      if (view && typeof view === "object" && config.reportBackendBaseUrl) {
        view.AriadexReportSettings = {
          ...(view.AriadexReportSettings || {}),
          backendBaseUrl: config.reportBackendBaseUrl
        };
      }
      return config;
    } catch {
      return null;
    }
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      GENERATED_CONFIG_FILE,
      BEARER_STORAGE_KEYS,
      isExtensionContextValid,
      getGeneratedConfigUrl,
      isGeneratedConfigUrlSafe,
      normalizeConfig,
      persistBearerToken,
      loadGeneratedConfig
    };
  } else {
    globalThis.AriadexV2DevEnvReady = loadGeneratedConfig();
  }
})();
