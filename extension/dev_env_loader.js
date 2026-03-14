(() => {
  "use strict";

  const GENERATED_CONFIG_FILE = "dev_env.generated.json";
  const BEARER_STORAGE_KEY = "ariadex.x_api_bearer_token";
  const FOLLOWING_STORAGE_KEY = "ariadex.x_api_following_ids";
  const GRAPH_API_BY_ENV_STORAGE_KEY = "ariadex.graph_api_by_env";
  const RUNTIME_ENV_STORAGE_KEY = "ariadex.runtime_env";
  const ALLOW_CLIENT_DIRECT_API_STORAGE_KEY = "ariadex.allow_client_direct_api";

  function isExtensionContextValid() {
    return (
      typeof chrome !== "undefined"
      && chrome.runtime
      && chrome.runtime.id
      && chrome.runtime.id !== "invalid"
    );
  }

  function getGeneratedConfigUrl() {
    if (!isExtensionContextValid()) {
      return null;
    }

    if (typeof chrome.runtime.getURL !== "function") {
      return null;
    }

    try {
      const url = chrome.runtime.getURL(GENERATED_CONFIG_FILE);
      if (!url || typeof url !== "string") {
        return null;
      }

      const expectedPrefix = `chrome-extension://${chrome.runtime.id}/`;
      if (!url.startsWith(expectedPrefix)) {
        return null;
      }

      return url;
    } catch {
      return null;
    }
  }

  function parseFollowingIds(raw) {
    if (!Array.isArray(raw)) {
      return [];
    }

    const unique = new Set();
    for (const value of raw) {
      if (value == null) {
        continue;
      }
      const normalized = String(value).trim();
      if (normalized) {
        unique.add(normalized);
      }
    }
    return [...unique];
  }

  function applyRuntimeConfig(config) {
    if (!config || typeof config !== "object") {
      return;
    }

    const bearerToken = typeof config.bearerToken === "string" ? config.bearerToken.trim() : "";
    const followingIds = parseFollowingIds(config.followingIds);
    const graphApiUrl = typeof config.graphApiUrl === "string" ? config.graphApiUrl.trim() : "";
    const graphApiByEnv = config.graphApiByEnv && typeof config.graphApiByEnv === "object"
      ? config.graphApiByEnv
      : null;
    const environment = typeof config.environment === "string" ? config.environment.trim().toLowerCase() : "";
    const allowClientDirectApi = typeof config.allowClientDirectApi === "boolean"
      ? config.allowClientDirectApi
      : false;

    if (!bearerToken && followingIds.length === 0 && !graphApiUrl && !graphApiByEnv && !environment && !allowClientDirectApi) {
      return;
    }

    window.AriadexXApiSettings = {
      ...(window.AriadexXApiSettings || {}),
      ...(bearerToken ? { bearerToken } : {}),
      ...(followingIds.length > 0 ? { followingIds } : {}),
      ...(environment ? { environment } : {}),
      allowClientDirectApi,
      ...(graphApiByEnv ? { graphApiByEnv } : {}),
      ...(graphApiUrl ? { graphApiUrl } : {})
    };

    if (bearerToken) {
      try {
        window.localStorage.setItem(BEARER_STORAGE_KEY, bearerToken);
      } catch {}
    }

    if (followingIds.length > 0) {
      try {
        window.localStorage.setItem(FOLLOWING_STORAGE_KEY, JSON.stringify(followingIds));
      } catch {}
    }

    if (graphApiUrl) {
      try {
        window.localStorage.setItem("ariadex.graph_api_url", graphApiUrl);
      } catch {}
    }

    if (graphApiByEnv) {
      try {
        window.localStorage.setItem(GRAPH_API_BY_ENV_STORAGE_KEY, JSON.stringify(graphApiByEnv));
      } catch {}
    }

    if (environment) {
      try {
        window.localStorage.setItem(RUNTIME_ENV_STORAGE_KEY, environment);
      } catch {}
    }

    try {
      window.localStorage.setItem(ALLOW_CLIENT_DIRECT_API_STORAGE_KEY, String(allowClientDirectApi));
    } catch {}
  }

  async function loadGeneratedConfig() {
    if (!isExtensionContextValid()) {
      return;
    }

    const url = getGeneratedConfigUrl();
    if (!url) {
      return;
    }

    // Guard again in case extension context changed between URL generation and fetch.
    if (!isExtensionContextValid()) {
      return;
    }

    const expectedPrefix = `chrome-extension://${chrome.runtime.id}/`;
    if (!url.startsWith(expectedPrefix)) {
      return;
    }

    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        return;
      }

      const config = await response.json();
      applyRuntimeConfig(config);
    } catch {
      // Optional config: ignore missing/invalid file and stale-context fetch failures.
    }
  }

  if (typeof chrome === "undefined" || !chrome.runtime || typeof chrome.runtime.getURL !== "function") {
    return;
  }

  loadGeneratedConfig();
})();
