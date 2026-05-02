"use strict";

const DEFAULT_REPORT_BACKEND_BASE_URL = "http://127.0.0.1:8787";

function normalizeReportSettings(rawSettings = {}) {
  const backendBaseUrl = String(
    rawSettings?.reportBackendBaseUrl
    || rawSettings?.backendBaseUrl
    || DEFAULT_REPORT_BACKEND_BASE_URL
  ).trim().replace(/\/$/, "");

  return {
    backendBaseUrl
  };
}

function extractChatCompletionText(payload) {
  const choices = Array.isArray(payload?.choices) ? payload.choices : [];
  const messageContent = choices[0]?.message?.content;
  if (typeof messageContent === "string") {
    return messageContent.trim();
  }
  if (Array.isArray(messageContent)) {
    return messageContent
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        if (entry?.type === "text" && typeof entry.text === "string") {
          return entry.text;
        }
        return "";
      })
      .join("")
      .trim();
  }
  return "";
}

async function generateReport({
  fetchImpl,
  artifact,
  settings = {},
  onProgress = null
}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("missing_fetch_implementation");
  }

  if (!artifact || typeof artifact !== "object") {
    throw new Error("missing_report_artifact");
  }

  const reportSettings = normalizeReportSettings(settings);
  if (!reportSettings.backendBaseUrl) {
    throw new Error("missing_report_backend_base_url");
  }

  if (typeof onProgress === "function") {
    onProgress({
      phase: "calling_report_backend",
      backendBaseUrl: reportSettings.backendBaseUrl
    });
  }

  const response = await fetchImpl(`${reportSettings.backendBaseUrl}/v1/report`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ artifact })
  });

  if (typeof onProgress === "function") {
    onProgress({
      phase: "awaiting_llm_response",
      backendBaseUrl: reportSettings.backendBaseUrl
    });
  }

  if (!response?.ok) {
    let detail = "";
    try {
      detail = String(await response.text()).trim().slice(0, 300);
    } catch {}
    throw new Error(detail ? `report_generation_failed_${response.status}:${detail}` : `report_generation_failed_${response.status}`);
  }

  const payload = await response.json();
  const report = payload?.report && typeof payload.report === "object" ? payload.report : null;
  if (!report?.text) {
    throw new Error("empty_report_response");
  }

  if (typeof onProgress === "function") {
    onProgress({
      phase: "report_ready",
      model: String(report.model || "").trim(),
      provider: String(report.provider || "").trim()
    });
  }

  return {
    text: String(report.text || "").trim(),
    model: String(report.model || "").trim(),
    apiBaseUrl: String(report.apiBaseUrl || "").trim(),
    provider: String(report.provider || "").trim()
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DEFAULT_REPORT_BACKEND_BASE_URL,
    normalizeReportSettings,
    extractChatCompletionText,
    generateReport
  };
} else {
  globalThis.AriadexV2ReportGeneration = {
    DEFAULT_REPORT_BACKEND_BASE_URL,
    normalizeReportSettings,
    extractChatCompletionText,
    generateReport
  };
}
