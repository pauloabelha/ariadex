(() => {
  "use strict";

  const GENERATED_CONFIG_FILE = "dev_env.generated.json";
  const BEARER_STORAGE_KEYS = [
    "ariadex.x_api_bearer_token",
    "ariadex.xApiBearerToken"
  ];
  const OPENAI_API_KEY_STORAGE_KEYS = [
    "ariadex.openai_api_key",
    "ariadex.openAiApiKey",
    "OPENAI_API_KEY"
  ];
  const OPENAI_MODEL_STORAGE_KEYS = [
    "ariadex.openai_model",
    "ariadex.openAiModel"
  ];
  const OPENAI_BASE_URL_STORAGE_KEYS = [
    "ariadex.openai_base_url",
    "ariadex.openAiBaseUrl"
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
    const openAiApiKey = typeof config.openAiApiKey === "string" ? config.openAiApiKey.trim() : "";
    const openAiModel = typeof config.openAiModel === "string" ? config.openAiModel.trim() : "";
    const openAiBaseUrl = typeof config.openAiBaseUrl === "string" ? config.openAiBaseUrl.trim() : "";

    return {
      ...(bearerToken ? { bearerToken } : {}),
      ...(apiBaseUrl ? { apiBaseUrl } : {}),
      ...(reportBackendBaseUrl ? { reportBackendBaseUrl } : {}),
      ...(openAiApiKey ? { openAiApiKey } : {}),
      ...(openAiModel ? { openAiModel } : {}),
      ...(openAiBaseUrl ? { openAiBaseUrl } : {})
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

  function persistOpenAiSettings(config, chromeApi = chrome, view = globalThis.window) {
    const openAiApiKey = String(config?.openAiApiKey || "").trim();
    const openAiModel = String(config?.openAiModel || "").trim();
    const openAiBaseUrl = String(config?.openAiBaseUrl || "").trim();

    if (view && typeof view === "object" && (openAiApiKey || openAiModel || openAiBaseUrl)) {
      view.AriadexOpenAiSettings = {
        ...(view.AriadexOpenAiSettings || {}),
        ...(openAiApiKey ? { apiKey: openAiApiKey } : {}),
        ...(openAiModel ? { model: openAiModel } : {}),
        ...(openAiBaseUrl ? { baseUrl: openAiBaseUrl } : {})
      };
    }

    const storageValues = {};
    if (openAiApiKey) {
      for (const key of OPENAI_API_KEY_STORAGE_KEYS) {
        storageValues[key] = openAiApiKey;
        try {
          view?.localStorage?.setItem?.(key, openAiApiKey);
        } catch {}
      }
    }
    if (openAiModel) {
      for (const key of OPENAI_MODEL_STORAGE_KEYS) {
        storageValues[key] = openAiModel;
        try {
          view?.localStorage?.setItem?.(key, openAiModel);
        } catch {}
      }
    }
    if (openAiBaseUrl) {
      for (const key of OPENAI_BASE_URL_STORAGE_KEYS) {
        storageValues[key] = openAiBaseUrl;
        try {
          view?.localStorage?.setItem?.(key, openAiBaseUrl);
        } catch {}
      }
    }

    if (Object.keys(storageValues).length > 0 && chromeApi?.storage?.local?.set) {
      chromeApi.storage.local.set(storageValues, () => {});
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
      persistOpenAiSettings(config, chromeApi, view);
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
      OPENAI_API_KEY_STORAGE_KEYS,
      OPENAI_MODEL_STORAGE_KEYS,
      OPENAI_BASE_URL_STORAGE_KEYS,
      isExtensionContextValid,
      getGeneratedConfigUrl,
      isGeneratedConfigUrlSafe,
      normalizeConfig,
      persistBearerToken,
      persistOpenAiSettings,
      loadGeneratedConfig
    };
  } else {
    globalThis.AriadexDevEnvReady = loadGeneratedConfig();
  }
})();
