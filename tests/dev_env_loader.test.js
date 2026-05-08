const test = require("node:test");
const assert = require("node:assert/strict");

const loader = require("../extension/dev_env_loader.js");

test("generated config URL helpers reject invalid extension contexts", () => {
  assert.equal(loader.isExtensionContextValid(null), false);
  assert.equal(loader.isExtensionContextValid({ runtime: { id: "invalid" } }), false);
  assert.equal(loader.getGeneratedConfigUrl({ runtime: { id: "invalid" } }), "");
  assert.equal(loader.isGeneratedConfigUrlSafe("https://example.com/dev_env.generated.json"), false);
  assert.equal(loader.isGeneratedConfigUrlSafe("chrome-extension://abc123/dev_env.generated.json"), true);
});

test("normalizeConfig drops blank and non-string values", () => {
  assert.deepEqual(loader.normalizeConfig({
    bearerToken: " token ",
    apiBaseUrl: "",
    reportBackendBaseUrl: 123
  }), {
    bearerToken: "token"
  });
});

test("persistBearerToken hydrates window state, localStorage, and chrome storage", () => {
  const localValues = {};
  let chromeValues = null;
  const view = {
    localStorage: {
      setItem(key, value) {
        localValues[key] = value;
      }
    }
  };
  const chromeApi = {
    storage: {
      local: {
        set(values, callback) {
          chromeValues = values;
          callback();
        }
      }
    }
  };

  loader.persistBearerToken("token-123", chromeApi, view);

  assert.equal(view.AriadexXApiSettings.bearerToken, "token-123");
  assert.equal(view.AriadexXApiBearerToken, "token-123");
  assert.equal(localValues["ariadex.x_api_bearer_token"], "token-123");
  assert.equal(localValues["ariadex.xApiBearerToken"], "token-123");
  assert.deepEqual(chromeValues, {
    "ariadex.x_api_bearer_token": "token-123",
    "ariadex.xApiBearerToken": "token-123"
  });
});

test("loadGeneratedConfig reads and persists the generated config", async () => {
  const localValues = {};
  let chromeValues = null;
  const view = {
    localStorage: {
      setItem(key, value) {
        localValues[key] = value;
      }
    }
  };
  const chromeApi = {
    runtime: {
      id: "abc123",
      getURL(path) {
        return `chrome-extension://abc123/${path}`;
      }
    },
    storage: {
      local: {
        set(values, callback) {
          chromeValues = values;
          callback();
        }
      }
    }
  };
  const fetchCalls = [];

  const config = await loader.loadGeneratedConfig({
    chromeApi,
    view,
    async fetchImpl(url, options) {
      fetchCalls.push({ url, options });
      return {
        ok: true,
        async json() {
          return {
            bearerToken: "token-abc",
            apiBaseUrl: "https://api.x.com/2",
            reportBackendBaseUrl: "http://127.0.0.1:8787"
          };
        }
      };
    }
  });

  assert.deepEqual(fetchCalls, [{
    url: "chrome-extension://abc123/dev_env.generated.json",
    options: { cache: "no-store" }
  }]);
  assert.equal(config.bearerToken, "token-abc");
  assert.equal(view.AriadexXApiSettings.bearerToken, "token-abc");
  assert.equal(view.AriadexXApiSettings.apiBaseUrl, "https://api.x.com/2");
  assert.equal(view.AriadexReportSettings.backendBaseUrl, "http://127.0.0.1:8787");
  assert.equal(localValues["ariadex.x_api_bearer_token"], "token-abc");
  assert.deepEqual(chromeValues, {
    "ariadex.x_api_bearer_token": "token-abc",
    "ariadex.xApiBearerToken": "token-abc"
  });
});

test("loadGeneratedConfig quietly returns null when config cannot be loaded", async () => {
  assert.equal(await loader.loadGeneratedConfig({
    chromeApi: { runtime: { id: "invalid" } },
    fetchImpl: async () => {
      assert.fail("fetch should not run for invalid extension contexts");
    }
  }), null);

  assert.equal(await loader.loadGeneratedConfig({
    chromeApi: {
      runtime: {
        id: "abc123",
        getURL() {
          return "chrome-extension://abc123/dev_env.generated.json";
        }
      }
    },
    fetchImpl: async () => ({ ok: false })
  }), null);
});
