"use strict";

function isGraphApiMessage(message) {
  return Boolean(
    message
    && typeof message === "object"
    && message.type === "ariadex_graph_api_request"
    && typeof message.url === "string"
  );
}

function isAllowedGraphApiUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }

    const host = String(parsed.hostname || "").toLowerCase();
    return host === "127.0.0.1" || host === "localhost";
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isGraphApiMessage(message)) {
    return false;
  }

  (async () => {
    const url = String(message.url || "");
    const method = String(message.method || "GET").toUpperCase();
    const headers = message.headers && typeof message.headers === "object"
      ? message.headers
      : {};

    if (!isAllowedGraphApiUrl(url)) {
      sendResponse({
        ok: false,
        error: "invalid_graph_api_url"
      });
      return;
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: typeof message.body === "string" ? message.body : undefined
      });

      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      sendResponse({
        ok: response.ok,
        status: response.status,
        statusText: response.statusText || "",
        body: payload
      });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error?.message || "background_fetch_failed"
      });
    }
  })();

  return true;
});
