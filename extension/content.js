(() => {
  "use strict";

  const BUTTON_ATTR = "data-ariadex-button";
  const TOP_TAKES_BUTTON_ATTR = "data-ariadex-top-takes-button";
  const PANEL_ID = "ariadex-panel";
  const ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
  const MESSAGE_TYPE = "ARIADEX_RESOLVE_ROOT_PATH";
  const CLEAR_CACHE_MESSAGE_TYPE = "ARIADEX_CLEAR_CACHE";
  const GENERATE_REPORT_MESSAGE_TYPE = "ARIADEX_GENERATE_REPORT";
  const GENERATE_GIST_MESSAGE_TYPE = "ARIADEX_GENERATE_GIST";
  const RESOLVE_TOP_TAKES_MESSAGE_TYPE = "ARIADEX_RESOLVE_TOP_TAKES";
  const RESOLVE_ROOT_PATH_PORT_NAME = "ARIADEX_RESOLVE_ROOT_PATH_PORT";
  const GENERATE_REPORT_PORT_NAME = "ARIADEX_GENERATE_REPORT_PORT";
  const GENERATE_GIST_PORT_NAME = "ARIADEX_GENERATE_GIST_PORT";
  const RESOLVE_TOP_TAKES_PORT_NAME = "ARIADEX_RESOLVE_TOP_TAKES_PORT";
  const DEFAULT_TAB = "path";
  const PANEL_MARGIN = 20;
  const TOP_TAKES_INITIAL_RENDER_COUNT = 5;
  const TOP_TAKES_RENDER_BATCH_SIZE = 10;
  const X_API_BEARER_STORAGE_KEYS = [
    "ariadex.x_api_bearer_token",
    "ariadex.xApiBearerToken"
  ];

  // Keep UI strings compact and predictable before rendering them into the panel.
  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function canonicalizeHandle(value) {
    const normalized = String(value || "").trim().replace(/^@+/, "").toLowerCase();
    return /^[a-z0-9_]{1,15}$/.test(normalized) ? normalized : "";
  }

  function readLocalStorageValue(key, view = globalThis.window) {
    try {
      return view?.localStorage?.getItem?.(key) || "";
    } catch {
      return "";
    }
  }

  function readXApiBearerToken(view = globalThis.window) {
    const settingsToken = String(view?.AriadexXApiSettings?.bearerToken || "").trim();
    if (settingsToken) {
      return settingsToken;
    }

    const windowToken = String(view?.AriadexXApiBearerToken || "").trim();
    if (windowToken) {
      return windowToken;
    }

    for (const key of X_API_BEARER_STORAGE_KEYS) {
      const candidate = String(readLocalStorageValue(key, view) || "").trim();
      if (candidate) {
        return candidate;
      }
    }
    return "";
  }

  function readChromeStorageLocalValue(key, chromeApi = chrome) {
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
        resolve(typeof value === "string" ? value : "");
      });
    });
  }

  async function readXApiBearerTokenWithFallbacks(chromeApi = chrome, view = globalThis.window) {
    const directToken = readXApiBearerToken(view);
    if (directToken) {
      return directToken;
    }

    for (const key of X_API_BEARER_STORAGE_KEYS) {
      const candidate = String(await readChromeStorageLocalValue(key, chromeApi) || "").trim();
      if (candidate) {
        return candidate;
      }
    }

    return "";
  }

  async function awaitDevEnvHydration(globalObj = globalThis) {
    const pending = globalObj?.AriadexDevEnvReady;
    if (!pending || typeof pending.then !== "function") {
      return;
    }

    try {
      await pending;
    } catch {
      // Optional hydration should not block manual token entry or later fallbacks.
    }
  }

  function readConfiguredApiBaseUrl(view = globalThis.window) {
    return String(view?.AriadexXApiSettings?.apiBaseUrl || "").trim();
  }

  // Convert a path position into the label shown to the reader.
  function baseLabelForIndex(tweet, index, clickedId) {
    if (index === 0) {
      return "Root";
    }
    if (tweet?.id === clickedId) {
      return "Explored";
    }
    return `Ancestor ${index}`;
  }

  // Describe how the current tweet attaches to its structural parent in the path.
  function relationLabel(tweet, parentTweet, parentIndex, clickedId) {
    if (!tweet || !parentTweet || !tweet.outboundRelation) {
      return "";
    }

    const parentLabel = baseLabelForIndex(parentTweet, parentIndex, clickedId);
    if (tweet.outboundRelation === "quote") {
      return `quoted ${parentLabel}`;
    }
    if (tweet.outboundRelation === "reply") {
      return `replied to ${parentLabel}`;
    }
    return `${tweet.outboundRelation} ${parentLabel}`;
  }

  // Add UI-friendly labels and titles without mutating the background artifact.
  function buildPathEntries(path, clickedId) {
    return (Array.isArray(path) ? path : []).map((tweet, index, list) => {
      const parentTweet = index > 0 ? list[index - 1] : null;
      const label = baseLabelForIndex(tweet, index, clickedId);
      const relation = relationLabel(tweet, parentTweet, index - 1, clickedId);
      return {
        ...tweet,
        label,
        relation,
        title: relation ? `${label} (${relation})` : label
      };
    });
  }

  // Render inline reference markers like [1] [2] for a path tweet.
  function buildReferenceBadgeText(referenceNumbers) {
    const numbers = Array.isArray(referenceNumbers) ? referenceNumbers : [];
    if (numbers.length === 0) {
      return "";
    }
    return numbers.map((number) => `[${number}]`).join(" ");
  }

  function buildExportFilename(clickedId) {
    const normalizedId = String(clickedId || "root-path").trim() || "root-path";
    return `ariadex-${normalizedId}.json`;
  }

  function buildReportFilename(clickedId) {
    const normalizedId = String(clickedId || "root-path").trim() || "root-path";
    return `ariadex-${normalizedId}-report.md`;
  }

  function buildGistFilename(clickedId) {
    const normalizedId = String(clickedId || "root-path").trim() || "root-path";
    return `ariadex-${normalizedId}-gist.md`;
  }

  function triggerJsonDownload(payload, filename, root = document) {
    const view = root?.defaultView;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const objectUrl = view?.URL?.createObjectURL?.(blob);
    if (!objectUrl) {
      throw new Error("download_unavailable");
    }

    const link = root.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    link.style.display = "none";
    root.body.appendChild(link);
    link.click();
    link.remove();
    view.URL.revokeObjectURL(objectUrl);
  }

  function triggerTextDownload(text, filename, root = document) {
    const view = root?.defaultView;
    const blob = new Blob([String(text || "")], { type: "text/markdown;charset=utf-8" });
    const objectUrl = view?.URL?.createObjectURL?.(blob);
    if (!objectUrl) {
      throw new Error("download_unavailable");
    }

    const link = root.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    link.style.display = "none";
    root.body.appendChild(link);
    link.click();
    link.remove();
    view.URL.revokeObjectURL(objectUrl);
  }

  async function copyTextToClipboard(text, root = document) {
    const value = String(text || "");
    const view = root?.defaultView || globalThis;
    const clipboard = view?.navigator?.clipboard;
    if (!clipboard?.writeText) {
      throw new Error("clipboard_unavailable");
    }
    await clipboard.writeText(value);
  }

  function setAccessibleLabel(element, label) {
    if (!element) {
      return;
    }
    element.title = label;
    try {
      element.setAttribute("aria-label", label);
    } catch {
      element.ariaLabel = label;
    }
  }

  function createCopyIcon(root = document) {
    const icon = root.createElement("span");
    icon.className = "ariadex-copy-icon";

    const backSquare = root.createElement("span");
    backSquare.className = "ariadex-copy-icon-back";

    const frontSquare = root.createElement("span");
    frontSquare.className = "ariadex-copy-icon-front";

    icon.appendChild(backSquare);
    icon.appendChild(frontSquare);
    return icon;
  }

  // Turn low-level resolver progress into short UX copy that keeps moving.
  function formatProgressMessage(progress) {
    const phase = String(progress?.phase || "").trim();
    const ancestorCount = Number(progress?.ancestorCount || 0);
    const tweetCount = Number(progress?.tweetCount || 0);
    const referenceCount = Number(progress?.referenceCount || 0);
    const nextRelationType = String(progress?.nextRelationType || "").trim();

    if (phase === "start") {
      return "Tracing the root path from the explored tweet...";
    }

    if (phase === "path_walk") {
      if (ancestorCount <= 0) {
        return nextRelationType
          ? `Found the explored tweet. Following its ${nextRelationType} parent...`
          : "Found the explored tweet. Checking whether it has a parent...";
      }

      if (nextRelationType) {
        return `Tracing the root path... ${ancestorCount} ancestor${ancestorCount === 1 ? "" : "s"} found so far. Next hop is a ${nextRelationType}.`;
      }

      return `Tracing the root path... ${ancestorCount} ancestor${ancestorCount === 1 ? "" : "s"} found so far.`;
    }

    if (phase === "canonicalizing_refs") {
      return `Root path complete. Canonicalizing references across ${tweetCount} tweet${tweetCount === 1 ? "" : "s"}...`;
    }

    if (phase === "collecting_local_reply_chains") {
      return "Root path complete. Fetching replies to the explored tweet from the X API...";
    }

    if (phase === "done") {
      return `Done. Resolved ${tweetCount} path tweet${tweetCount === 1 ? "" : "s"} and ${referenceCount} reference${referenceCount === 1 ? "" : "s"}.`;
    }

    return "Tracing the root path...";
  }

  function formatLookupErrorMessage(error) {
    const rawMessage = normalizeText(error?.message || error || "");
    if (!rawMessage) {
      return "Path lookup failed.";
    }

    const normalized = rawMessage.toLowerCase();
    if (
      normalized.includes("missing_x_api_bearer_token")
      || normalized.includes("missing x_api_token")
      || normalized.includes("missing x api token")
      || normalized.includes("missing bearer token")
    ) {
      return "Path lookup failed: missing X API bearer token. Set `ariadex.x_api_bearer_token` in page localStorage or chrome.storage.local, then reload X.";
    }

    if (normalized.includes("tweet_fetch_failed_401") || normalized.includes("tweet_fetch_failed_403")) {
      return "Path lookup failed: X rejected the bearer token. Check that the token is valid and has access to the requested API endpoints.";
    }

    if (
      normalized.includes("extension context invalidated")
      || normalized.includes("receiving end does not exist")
      || normalized.includes("message port closed before a response was received")
      || normalized.includes("root_path_port_disconnected")
    ) {
      return "Path lookup failed: the extension background worker was unavailable. Reload the unpacked extension in chrome://extensions, refresh X, and try again.";
    }

    return `Path lookup failed: ${rawMessage}`;
  }

  function formatReportErrorMessage(error) {
    const rawMessage = normalizeText(error?.message || error || "");
    if (!rawMessage) {
      return "Generation failed.";
    }

    const normalized = rawMessage.toLowerCase();
    if (
      normalized.includes("report_generation_failed_401")
      || normalized.includes("report_generation_failed_403")
    ) {
      return "Generation failed: the configured model API rejected the request. Check the API key, model, and endpoint.";
    }
    if (normalized.includes("report_generation_failed_429")) {
      return "Generation failed: the configured model API rate-limited the request. Check quota, billing, or retry later.";
    }
    if (
      normalized.includes("failed to fetch")
      || normalized.includes("networkerror")
      || normalized.includes("report_generation_failed_404")
      || normalized.includes("report_generation_failed_500")
      || normalized.includes("report_generation_failed_502")
      || normalized.includes("report_generation_failed_503")
      || normalized.includes("report_generation_failed_504")
    ) {
      return "Generation failed: the AriadeX report backend is unavailable. Start or reload the backend, then check local network access.";
    }
    if (normalized.includes("missing_openai_api_key")) {
      return "Generation failed: the backend is missing OPENAI_API_KEY.";
    }
    if (normalized.includes("empty_report_response")) {
      return "Generation failed: the model returned an empty response.";
    }

    return `Generation failed: ${rawMessage}`;
  }

  function formatReportProgressMessage(progress) {
    const phase = String(progress?.phase || "").trim();
    if (phase === "loading_report_config") {
      return "Generating report... preparing request.";
    }
    if (phase === "calling_report_backend") {
      return "Generating report... packaging conversation context.";
    }
    if (phase === "awaiting_llm_response") {
      return "Generating report... waiting for OpenAI.";
    }
    if (phase === "report_ready") {
      const model = normalizeText(progress?.model || "");
      return model
        ? `Report ready. Generated with ${model}.`
        : "Report ready.";
    }
    return "Generating report...";
  }

  function formatGistProgressMessage(progress) {
    const phase = String(progress?.phase || "").trim();
    if (phase === "loading_report_config") {
      return "Generating gist... preparing request.";
    }
    if (phase === "calling_gist_backend") {
      return "Generating gist... distilling the thread.";
    }
    if (phase === "awaiting_llm_response") {
      return "Generating gist... waiting for OpenAI.";
    }
    if (phase === "gist_ready") {
      const model = normalizeText(progress?.model || "");
      return model
        ? `Gist ready. Generated with ${model}.`
        : "Gist ready.";
    }
    return "Generating gist...";
  }

  function formatTopTakesProgressMessage(progress) {
    const phase = String(progress?.phase || "").trim();
    if (phase === "collecting_quote_tweets") {
      return "Collecting quote tweets from X...";
    }
    if (phase === "top_takes_cache_hit") {
      return "Loading cached Top Takes...";
    }
    if (phase === "normalizing_discourse") {
      const count = Number(progress?.quoteCount || 0);
      return `Normalizing discourse across ${count} quote tweet${count === 1 ? "" : "s"}...`;
    }
    if (phase === "collecting_top_comments") {
      const count = Number(progress?.candidateQuoteCount || 0);
      const commentCount = Number(progress?.topCommentsPerQuote || 0);
      return `Collecting top ${commentCount} comment${commentCount === 1 ? "" : "s"} for ${count} candidate quote${count === 1 ? "" : "s"}...`;
    }
    if (phase === "sending_batches_to_openai") {
      const batchIndex = Number(progress?.batchIndex || 0);
      const batchCount = Number(progress?.batchCount || 0);
      return batchCount
        ? `Sending quote batch ${batchIndex}/${batchCount} to OpenAI...`
        : "Sending quote batches to OpenAI...";
    }
    if (phase === "analyzing_epistemic_roles") {
      return "Analyzing epistemic roles...";
    }
    if (phase === "grouping_perspectives") {
      return "Grouping perspectives...";
    }
    if (phase === "selecting_representative_takes") {
      return "Selecting representative takes...";
    }
    if (phase === "rendering_top_takes") {
      return "Rendering Top Takes...";
    }
    if (phase === "top_takes_ready") {
      const count = Number(progress?.representativeTakeCount || 0);
      return `Top Takes ready. Selected ${count} representative take${count === 1 ? "" : "s"}.`;
    }
    return "Building Top Takes...";
  }

  function formatTopTakesErrorMessage(error) {
    const rawMessage = normalizeText(error?.message || error || "");
    if (!rawMessage) {
      return "Top Takes failed.";
    }
    const normalized = rawMessage.toLowerCase();
    if (normalized.includes("missing_openai_api_key")) {
      return "Top Takes failed: missing OpenAI API key. Set `ariadex.openai_api_key` in chrome.storage.local.";
    }
    if (normalized.includes("missing_x_api_bearer_token")) {
      return "Top Takes failed: missing X API bearer token.";
    }
    if (normalized.includes("tweet_fetch_failed_401") || normalized.includes("tweet_fetch_failed_403")) {
      return "Top Takes failed: X rejected the bearer token or quote-tweet endpoint access.";
    }
    if (normalized.includes("top_takes_openai_failed_401") || normalized.includes("top_takes_openai_failed_403")) {
      return "Top Takes failed: OpenAI rejected the API key or model access.";
    }
    if (normalized.includes("top_takes_openai_failed_429")) {
      return "Top Takes failed: OpenAI rate-limited the request.";
    }
    return `Top Takes failed: ${rawMessage}`;
  }

  // Discover tweet cards so we can attach the button to whatever X has rendered.
  function findTweetArticles(root = document) {
    return [...root.querySelectorAll(ARTICLE_SELECTOR)];
  }

  // Resolve the containing tweet card even if the click lands on a nested child element.
  function findClosestTweetArticle(node) {
    return node?.closest?.(ARTICLE_SELECTOR) || null;
  }

  // Pull the tweet id from the tweet's status link in the DOM.
  function extractTweetId(article) {
    const statusLink = article?.querySelector?.('a[href*="/status/"]');
    if (!statusLink) {
      return "";
    }
    const href = statusLink.getAttribute("href") || "";
    const match = href.match(/\/status\/(\d+)/);
    return match ? match[1] : "";
  }

  // Create the floating panel once and reuse it across repeated explore clicks.
  function ensurePanel(root = document) {
    let panel = root.getElementById(PANEL_ID);
    if (panel) {
      return panel;
    }

    panel = root.createElement("aside");
    panel.id = PANEL_ID;
    panel.className = "ariadex-panel";
    panel.__ariadexV2State = {
      activeTab: DEFAULT_TAB,
      position: null,
      latestArtifact: null,
      latestTopTakesArtifact: null,
      latestClickedId: "",
      latestReport: null,
      latestGist: null
    };
    root.body.appendChild(panel);
    return panel;
  }

  function getViewportBounds(root = document) {
    const view = root?.defaultView || globalThis;
    return {
      width: Number(view?.innerWidth || 0),
      height: Number(view?.innerHeight || 0)
    };
  }

  function getPanelSize(panel) {
    const rect = panel?.getBoundingClientRect?.();
    const width = Number(rect?.width || panel?.offsetWidth || 420);
    const height = Number(rect?.height || panel?.offsetHeight || 320);
    return { width, height };
  }

  function clampPanelPosition(position, panel, root = document) {
    const nextLeft = Number(position?.left || 0);
    const nextTop = Number(position?.top || 0);
    const { width: viewportWidth, height: viewportHeight } = getViewportBounds(root);
    const { width: panelWidth, height: panelHeight } = getPanelSize(panel);
    const maxLeft = Math.max(PANEL_MARGIN, viewportWidth - panelWidth - PANEL_MARGIN);
    const maxTop = Math.max(PANEL_MARGIN, viewportHeight - panelHeight - PANEL_MARGIN);

    return {
      left: Math.min(Math.max(PANEL_MARGIN, nextLeft), maxLeft),
      top: Math.min(Math.max(PANEL_MARGIN, nextTop), maxTop)
    };
  }

  function applyPanelPosition(panel, position, root = document) {
    if (!panel || !position) {
      return;
    }

    const clamped = clampPanelPosition(position, panel, root);
    panel.style.left = `${clamped.left}px`;
    panel.style.top = `${clamped.top}px`;
    panel.style.right = "auto";
  }

  function makePanelMovable(panel, handle, root = document) {
    if (!panel || !handle) {
      return;
    }

    if (typeof panel.__ariadexV2DragCleanup === "function") {
      panel.__ariadexV2DragCleanup();
    }

    const view = root?.defaultView;
    if (!view?.addEventListener || !view?.removeEventListener) {
      return;
    }

    const state = panel.__ariadexV2State && typeof panel.__ariadexV2State === "object"
      ? panel.__ariadexV2State
      : { activeTab: DEFAULT_TAB, position: null, latestArtifact: null, latestClickedId: "" };
    panel.__ariadexV2State = state;

    function onMouseDown(event) {
      if (event.button !== 0) {
        return;
      }
      if (event.target?.closest?.("button, a, input, textarea, select")) {
        return;
      }

      const rect = panel.getBoundingClientRect();
      const dragOffsetX = Number(event.clientX) - Number(rect.left || 0);
      const dragOffsetY = Number(event.clientY) - Number(rect.top || 0);

      function onMouseMove(moveEvent) {
        const nextPosition = clampPanelPosition({
          left: Number(moveEvent.clientX) - dragOffsetX,
          top: Number(moveEvent.clientY) - dragOffsetY
        }, panel, root);
        state.position = nextPosition;
        applyPanelPosition(panel, nextPosition, root);
      }

      function onMouseUp() {
        view.removeEventListener("mousemove", onMouseMove);
        view.removeEventListener("mouseup", onMouseUp);
        handle.classList.remove("ariadex-panel-header-dragging");
      }

      handle.classList.add("ariadex-panel-header-dragging");
      view.addEventListener("mousemove", onMouseMove);
      view.addEventListener("mouseup", onMouseUp);
      event.preventDefault();
    }

    handle.classList.add("ariadex-panel-header-draggable");
    handle.addEventListener("mousedown", onMouseDown);
    panel.__ariadexV2DragCleanup = () => {
      handle.removeEventListener("mousedown", onMouseDown);
    };
  }

  // Shared header renderer for loading, error, and resolved artifact states.
  function renderHeader(panel, root, metaText, titleText = "AriadeX · Root Path") {
    const header = root.createElement("div");
    header.className = "ariadex-panel-header";

    const title = root.createElement("div");
    title.className = "ariadex-title";
    title.textContent = titleText;

    const meta = root.createElement("div");
    meta.className = "ariadex-meta";
    meta.textContent = normalizeText(metaText || "Tracing root path...");

    const actions = root.createElement("div");
    actions.className = "ariadex-header-actions";

    const exportButton = root.createElement("button");
    exportButton.type = "button";
    exportButton.className = "ariadex-header-button";
    exportButton.textContent = "Export";
    exportButton.addEventListener("click", () => {
      const state = panel.__ariadexV2State && typeof panel.__ariadexV2State === "object"
        ? panel.__ariadexV2State
        : null;
      const latestArtifact = state?.latestArtifact;
      if (!latestArtifact) {
        meta.textContent = "Nothing to export yet.";
        return;
      }

      try {
        triggerJsonDownload({
          clickedTweetId: state?.latestClickedId || "",
          exportedAt: new Date().toISOString(),
          artifact: latestArtifact
        }, buildExportFilename(state?.latestClickedId || ""), root);
        meta.textContent = "Exported JSON snapshot.";
      } catch (error) {
        meta.textContent = `Export failed: ${error.message}`;
      }
    });
    actions.appendChild(exportButton);

    const reportButton = root.createElement("button");
    reportButton.type = "button";
    reportButton.className = "ariadex-header-button";
    reportButton.textContent = "Generate Report";
    reportButton.addEventListener("click", async () => {
      const state = panel.__ariadexV2State && typeof panel.__ariadexV2State === "object"
        ? panel.__ariadexV2State
        : null;
      const latestArtifact = state?.latestArtifact;
      if (!latestArtifact) {
        meta.textContent = "Nothing to turn into a report yet.";
        return;
      }

      meta.textContent = formatReportProgressMessage({ phase: "loading_report_config" });
      try {
        const report = await generateReportArtifact(
          latestArtifact,
          root.defaultView?.chrome || chrome,
          (progress) => {
            meta.textContent = formatReportProgressMessage(progress);
          }
        );
        const nextState = panel.__ariadexV2State && typeof panel.__ariadexV2State === "object"
          ? panel.__ariadexV2State
          : {};
        nextState.latestReport = {
          text: String(report?.text || "").trim(),
          model: String(report?.model || "").trim(),
          apiBaseUrl: String(report?.apiBaseUrl || "").trim(),
          generatedAt: new Date().toISOString()
        };
        nextState.activeTab = "report";
        panel.__ariadexV2State = nextState;
        renderArtifact(nextState.latestArtifact || latestArtifact, nextState.latestClickedId || "", root);
      } catch (error) {
        meta.textContent = formatReportErrorMessage(error);
      }
    });
    actions.appendChild(reportButton);

    const gistButton = root.createElement("button");
    gistButton.type = "button";
    gistButton.className = "ariadex-header-button";
    gistButton.textContent = "Generate Gist";
    gistButton.addEventListener("click", async () => {
      const state = panel.__ariadexV2State && typeof panel.__ariadexV2State === "object"
        ? panel.__ariadexV2State
        : null;
      const latestArtifact = state?.latestArtifact;
      if (!latestArtifact) {
        meta.textContent = "Nothing to turn into a gist yet.";
        return;
      }

      meta.textContent = formatGistProgressMessage({ phase: "loading_report_config" });
      try {
        const gist = await generateGistArtifact(
          latestArtifact,
          root.defaultView?.chrome || chrome,
          (progress) => {
            meta.textContent = formatGistProgressMessage(progress);
          }
        );
        const nextState = panel.__ariadexV2State && typeof panel.__ariadexV2State === "object"
          ? panel.__ariadexV2State
          : {};
        nextState.latestGist = {
          text: String(gist?.text || "").trim(),
          model: String(gist?.model || "").trim(),
          apiBaseUrl: String(gist?.apiBaseUrl || "").trim(),
          generatedAt: new Date().toISOString()
        };
        nextState.activeTab = "gist";
        panel.__ariadexV2State = nextState;
        renderArtifact(nextState.latestArtifact || latestArtifact, nextState.latestClickedId || "", root);
      } catch (error) {
        meta.textContent = formatReportErrorMessage(error);
      }
    });
    actions.appendChild(gistButton);

    const clearButton = root.createElement("button");
    clearButton.type = "button";
    clearButton.className = "ariadex-header-button";
    clearButton.textContent = "Clear Cache";
    clearButton.addEventListener("click", async () => {
      meta.textContent = "Clearing cache...";
      try {
        await clearTweetCache(root.defaultView?.chrome || chrome);
        meta.textContent = "Cache cleared.";
      } catch (error) {
        meta.textContent = `Cache clear failed: ${error.message}`;
      }
    });
    actions.appendChild(clearButton);

    header.appendChild(title);
    header.appendChild(meta);
    header.appendChild(actions);
    panel.appendChild(header);
    makePanelMovable(panel, header, root);

    const state = panel.__ariadexV2State && typeof panel.__ariadexV2State === "object"
      ? panel.__ariadexV2State
      : null;
    if (state?.position) {
      applyPanelPosition(panel, state.position, root);
    }
  }

  // Minimal single-message view used while loading or when resolution fails.
  function renderStatus(message, root = document) {
    const panel = ensurePanel(root);
    panel.innerHTML = "";
    renderHeader(panel, root, message);
  }

  function renderTopTakesStatus(message, root = document) {
    const panel = ensurePanel(root);
    panel.innerHTML = "";
    renderHeader(panel, root, message, "AriadeX · Top Takes");
  }

  // Build the path tab with relation labels, tweet text, and inline reference markers.
  function renderPathTab(path, clickedId, root) {
    const list = root.createElement("ol");
    list.className = "ariadex-list";

    for (const entry of buildPathEntries(path, clickedId)) {
      const item = root.createElement("li");
      item.className = "ariadex-item";

      const role = root.createElement("div");
      role.className = "ariadex-item-role";
      role.textContent = entry.title;

      const author = root.createElement("div");
      author.className = "ariadex-item-author";
      author.textContent = `@${String(entry.author || "unknown").replace(/^@/, "")}`;

      const text = root.createElement("div");
      text.className = "ariadex-item-text";
      text.textContent = entry.text || "(no text)";

      const badgeText = buildReferenceBadgeText(entry.referenceNumbers);
      if (badgeText) {
        const refs = root.createElement("div");
        refs.className = "ariadex-item-refs";
        refs.textContent = badgeText;
        item.appendChild(role);
        item.appendChild(author);
        item.appendChild(text);
        item.appendChild(refs);
      } else {
        item.appendChild(role);
        item.appendChild(author);
        item.appendChild(text);
      }

      const id = root.createElement("div");
      id.className = "ariadex-item-id";
      id.textContent = entry.id;

      item.appendChild(id);

      item.addEventListener("click", () => {
        if (entry.url) {
          root.defaultView.location.href = entry.url;
        }
      });

      list.appendChild(item);
    }

    return list;
  }

  // Build the deduped references tab from the canonical reference list.
  function renderReferencesTab(references, root) {
    if (!Array.isArray(references) || references.length === 0) {
      const empty = root.createElement("div");
      empty.className = "ariadex-empty";
      empty.textContent = "No external references found on this path or its reply chains.";
      return empty;
    }

    const list = root.createElement("ol");
    list.className = "ariadex-list";

    for (const reference of references) {
      const item = root.createElement("li");
      item.className = "ariadex-item";

      const role = root.createElement("div");
      role.className = "ariadex-item-role";
      role.textContent = `Reference [${reference.number}]`;

      const url = root.createElement("div");
      url.className = "ariadex-item-text";
      url.textContent = reference.canonicalUrl;

      const meta = root.createElement("div");
      meta.className = "ariadex-item-id";
      meta.textContent = `${reference.domain} · cited by ${reference.citedByTweetIds.length} tweet${reference.citedByTweetIds.length === 1 ? "" : "s"}`;

      item.appendChild(role);
      item.appendChild(url);
      item.appendChild(meta);

      item.addEventListener("click", () => {
        root.defaultView.open(reference.canonicalUrl, "_blank", "noopener,noreferrer");
      });

      list.appendChild(item);
    }

    return list;
  }

  // Build the deduped people tab from canonical root-path participants and mentions.
  function renderPeopleTab(people, root) {
    if (!Array.isArray(people) || people.length === 0) {
      const empty = root.createElement("div");
      empty.className = "ariadex-empty";
      empty.textContent = "No people were collected on this root path.";
      return empty;
    }

    const list = root.createElement("ol");
    list.className = "ariadex-list";

    for (const person of people) {
      const item = root.createElement("li");
      item.className = "ariadex-item";

      if (person.avatarUrl) {
        const avatar = root.createElement("img");
        avatar.className = "ariadex-person-avatar";
        avatar.src = person.avatarUrl;
        avatar.alt = person.displayName
          ? `${person.displayName} profile picture`
          : `@${String(person.handle || "").replace(/^@/, "")} profile picture`;
        avatar.loading = "lazy";
        item.appendChild(avatar);
      }

      const role = root.createElement("div");
      role.className = "ariadex-item-role";
      role.textContent = `@${String(person.handle || "").replace(/^@/, "")}`;

      const displayName = root.createElement("div");
      displayName.className = "ariadex-item-author";
      displayName.textContent = person.displayName || "(no display name)";

      const profile = root.createElement("div");
      profile.className = "ariadex-item-text";
      profile.textContent = person.profileUrl || "";

      const sourceTypes = Array.isArray(person.sourceTypes) ? person.sourceTypes : [];
      const citedByTweetIds = Array.isArray(person.citedByTweetIds) ? person.citedByTweetIds : [];
      const meta = root.createElement("div");
      meta.className = "ariadex-item-id";
      meta.textContent = `${sourceTypes.join(", ") || "person"} · seen in ${citedByTweetIds.length} path tweet${citedByTweetIds.length === 1 ? "" : "s"}`;

      item.appendChild(role);
      item.appendChild(displayName);
      item.appendChild(profile);
      item.appendChild(meta);

      item.addEventListener("click", () => {
        if (person.profileUrl) {
          root.defaultView.open(person.profileUrl, "_blank", "noopener,noreferrer");
        }
      });

      list.appendChild(item);
    }

    return list;
  }

  function renderReplyChainsTab(replyChains, path, clickedId, root) {
    if (!Array.isArray(replyChains) || replyChains.length === 0) {
      const empty = root.createElement("div");
      empty.className = "ariadex-empty";
      empty.textContent = "No replies to the explored tweet were found.";
      return empty;
    }

    const pathEntries = buildPathEntries(path, clickedId);
    const labelById = new Map(pathEntries.map((tweet) => [tweet.id, tweet.label]));
    const list = root.createElement("ol");
    list.className = "ariadex-list";

    for (const chain of replyChains) {
      const item = root.createElement("li");
      item.className = "ariadex-item";

      const header = root.createElement("div");
      header.className = "ariadex-item-role";
      const anchorLabel = labelById.get(String(chain.anchorTweetId || "")) || "Path Tweet";
      header.textContent = `${anchorLabel} Reply Chain · ${Array.isArray(chain.tweets) ? chain.tweets.length : 0} tweet${Array.isArray(chain.tweets) && chain.tweets.length === 1 ? "" : "s"}`;

      const participants = root.createElement("div");
      participants.className = "ariadex-item-author";
      const anchorHandle = String(chain.anchorAuthor || "").replace(/^@/, "");
      const participantText = (Array.isArray(chain.participantHandles) ? chain.participantHandles : [])
        .map((handle) => `@${String(handle || "").replace(/^@/, "")}`)
        .join(" · ");
      participants.textContent = anchorHandle
        ? `Reply to @${anchorHandle} · ${participantText}`
        : participantText;

      const meta = root.createElement("div");
      meta.className = "ariadex-item-id";
      meta.textContent = (Array.isArray(chain.tweets) ? chain.tweets : [])
        .map((tweet) => tweet.id)
        .join(", ");

      const tweetList = root.createElement("ol");
      tweetList.className = "ariadex-list";

      for (const tweet of Array.isArray(chain.tweets) ? chain.tweets : []) {
        const tweetItem = root.createElement("li");
        tweetItem.className = "ariadex-item";

        const tweetRole = root.createElement("div");
        tweetRole.className = "ariadex-item-role";
        tweetRole.textContent = "Reply Tweet";

        const tweetAuthor = root.createElement("div");
        tweetAuthor.className = "ariadex-item-author";
        tweetAuthor.textContent = `@${String(tweet.author || "").replace(/^@/, "")}`;

        const tweetText = root.createElement("div");
        tweetText.className = "ariadex-item-text";
        tweetText.textContent = String(tweet.text || "(no text)");

        const tweetMeta = root.createElement("div");
        tweetMeta.className = "ariadex-item-id";
        tweetMeta.textContent = String(tweet.id || "");

        tweetItem.appendChild(tweetRole);
        tweetItem.appendChild(tweetAuthor);
        tweetItem.appendChild(tweetText);
        tweetItem.appendChild(tweetMeta);

        tweetItem.addEventListener("click", () => {
          if (tweet.url) {
            root.defaultView.location.href = tweet.url;
          }
        });

        tweetList.appendChild(tweetItem);
      }

      item.appendChild(header);
      item.appendChild(participants);
      item.appendChild(meta);
      item.appendChild(tweetList);

      list.appendChild(item);
    }

    return list;
  }

  function renderGeneratedTextTab(entry, options = {}, root = document) {
    if (!entry?.text) {
      const empty = root.createElement("div");
      empty.className = "ariadex-empty";
      empty.textContent = String(options?.emptyText || "Nothing has been generated yet.");
      return empty;
    }

    const container = root.createElement("div");
    container.className = "ariadex-list";

    const item = root.createElement("article");
    item.className = "ariadex-item";

    const topRow = root.createElement("div");
    topRow.className = "ariadex-report-top";

    const header = root.createElement("div");
    header.className = "ariadex-item-role";
    header.textContent = String(options?.headerText || "Generated Text");

    const meta = root.createElement("div");
    meta.className = "ariadex-item-id";
    const generatedAt = normalizeText(entry?.generatedAt || "");
    const reportMeta = [
      generatedAt ? `Generated ${generatedAt}` : "",
      entry?.model ? `model ${entry.model}` : ""
    ].filter(Boolean).join(" · ");
    meta.textContent = reportMeta;

    const body = root.createElement("div");
    body.className = "ariadex-item-text";
    body.style.whiteSpace = "pre-wrap";
    body.textContent = String(entry?.text || "");

    const actions = root.createElement("div");
    actions.className = "ariadex-report-actions";

    const copyButton = root.createElement("button");
    copyButton.type = "button";
    copyButton.className = "ariadex-header-button ariadex-report-icon-button";
    setAccessibleLabel(copyButton, String(options?.copyLabel || "Copy Markdown"));

    const copyIcon = createCopyIcon(root);
    const copyLabel = root.createElement("span");
    copyLabel.textContent = "Copy";
    copyButton.appendChild(copyIcon);
    copyButton.appendChild(copyLabel);
    copyButton.addEventListener("click", async () => {
      try {
        await copyTextToClipboard(String(entry?.text || ""), root);
        copyLabel.textContent = "Copied";
      } catch {
        copyLabel.textContent = "Copy Failed";
      }
      const timerHost = root?.defaultView || globalThis;
      timerHost.setTimeout(() => {
        copyLabel.textContent = "Copy";
      }, 1200);
    });

    const downloadButton = root.createElement("button");
    downloadButton.type = "button";
    downloadButton.className = "ariadex-header-button";
    downloadButton.textContent = "Download";
    setAccessibleLabel(downloadButton, String(options?.downloadLabel || "Download Markdown"));
    downloadButton.addEventListener("click", () => {
      const panel = root.getElementById(PANEL_ID);
      const state = panel?.__ariadexV2State && typeof panel.__ariadexV2State === "object"
        ? panel.__ariadexV2State
        : null;
      const filename = typeof options?.filenameBuilder === "function"
        ? options.filenameBuilder(state?.latestClickedId || "")
        : "ariadex.md";
      triggerTextDownload(String(entry?.text || ""), filename, root);
    });

    actions.appendChild(copyButton);
    actions.appendChild(downloadButton);
    topRow.appendChild(header);
    topRow.appendChild(actions);
    item.appendChild(topRow);
    if (reportMeta) {
      item.appendChild(meta);
    }
    item.appendChild(body);
    container.appendChild(item);
    return container;
  }

  function renderReportTab(report, root = document) {
    return renderGeneratedTextTab(report, {
      emptyText: "No report has been generated yet.",
      headerText: "Generated Report",
      copyLabel: "Copy Markdown",
      downloadLabel: "Download Report",
      filenameBuilder: buildReportFilename
    }, root);
  }

  function renderGistTab(gist, root = document) {
    return renderGeneratedTextTab(gist, {
      emptyText: "No gist has been generated yet.",
      headerText: "Portable Gist",
      copyLabel: "Copy Gist",
      downloadLabel: "Download Gist",
      filenameBuilder: buildGistFilename
    }, root);
  }

  function renderTakeCard(take, root = document) {
    const item = root.createElement("article");
    item.className = "ariadex-item ariadex-top-take-item";
    const raw = take?.raw || {};

    const pills = root.createElement("div");
    pills.className = "ariadex-take-pills";

    function addPill(label, kind = "") {
      const text = normalizeText(label || "");
      if (!text) {
        return;
      }
      const pill = root.createElement("span");
      pill.className = `ariadex-take-pill${kind ? ` ariadex-take-pill-${kind}` : ""}`;
      pill.textContent = text;
      pills.appendChild(pill);
    }

    const domainGroup = String(take?.domainGroup || "").trim();
    const domainLabel = String(take?.domainGroupLabel || "").trim();
    if (domainGroup === "expert") {
      addPill(domainLabel || "Expert", "expert");
    } else if (domainGroup === "adjacent") {
      addPill(domainLabel || "Adjacent", "adjacent");
    }

    const author = root.createElement("div");
    author.className = "ariadex-item-author";
    author.textContent = `@${String(raw.author || "unknown").replace(/^@/, "")}`;

    const text = root.createElement("div");
    text.className = "ariadex-item-text";
    text.textContent = String(raw.text || "(no text)");

    const explanation = root.createElement("div");
    explanation.className = "ariadex-take-explanation";
    explanation.textContent = String(take?.selectedBecause || take?.explanation || "Selected as a high-signal perspective.");

    const topComments = Array.isArray(raw.topComments) ? raw.topComments : [];
    const comments = root.createElement("div");
    comments.className = "ariadex-top-comments";
    for (const comment of topComments.slice(0, 3)) {
      const commentItem = root.createElement("div");
      commentItem.className = "ariadex-top-comment";
      const author = String(comment?.author || "unknown").replace(/^@/, "");
      commentItem.textContent = `@${author}: ${String(comment?.text || "(no text)")}`;
      comments.appendChild(commentItem);
    }

    const expertise = root.createElement("div");
    expertise.className = "ariadex-domain-signal";
    const domainParts = [
      take?.domainGroupLabel ? String(take.domainGroupLabel) : "",
      Number(take?.authorDomainRelevance || 0) ? `domain ${Number(take.authorDomainRelevance).toFixed(2)}` : "",
      Number(take?.authorExpertiseSignal || 0) ? `expertise ${Number(take.authorExpertiseSignal).toFixed(2)}` : ""
    ].filter(Boolean);
    const expertiseEvidence = normalizeText(take?.expertiseEvidence || "");
    expertise.textContent = [
      domainParts.length > 0 ? `Domain signal: ${domainParts.join(" · ")}` : "",
      expertiseEvidence
    ].filter(Boolean).join(" — ");

    const scorecard = take?.scorecard || {};
    const scores = root.createElement("div");
    scores.className = "ariadex-score-row";
    for (const [label, value] of [
      ["Substance", scorecard.substance],
      ["Novelty", scorecard.novelty],
      ["Credibility", scorecard.credibility]
    ]) {
      const pill = root.createElement("span");
      pill.className = "ariadex-score-pill";
      const numeric = Number(value || 0);
      pill.textContent = `${label} ${Number.isFinite(numeric) ? numeric.toFixed(2) : "0.00"}`;
      scores.appendChild(pill);
    }

    const meta = root.createElement("div");
    meta.className = "ariadex-item-id";
    const metrics = raw.metrics || {};
    meta.textContent = [
      raw.createdAt ? `created ${raw.createdAt}` : "",
      Number(raw.authorFollowers || 0) ? `${Number(raw.authorFollowers)} followers` : "",
      Number(metrics.likes || 0) ? `${Number(metrics.likes)} likes` : "",
      raw.id ? `tweet ${raw.id}` : ""
    ].filter(Boolean).join(" · ");

    item.appendChild(pills);
    item.appendChild(author);
    item.appendChild(text);
    item.appendChild(explanation);
    if (comments.children.length > 0) {
      item.appendChild(comments);
    }
    if (expertise.textContent) {
      item.appendChild(expertise);
    }
    item.appendChild(scores);
    if (meta.textContent) {
      item.appendChild(meta);
    }
    item.addEventListener("click", () => {
      if (raw.url) {
        root.defaultView.open(raw.url, "_blank", "noopener,noreferrer");
      }
    });
    return item;
  }

  function getSortedTopTakes(artifact) {
    const cachedTakes = Array.isArray(artifact?.takes) ? artifact.takes : [];
    const representativeTakes = Array.isArray(artifact?.representativeTakes) ? artifact.representativeTakes : [];
    const fallbackTakes = Array.isArray(artifact?.groupedRoles)
      ? artifact.groupedRoles.flatMap((group) => Array.isArray(group?.takes) ? group.takes : [])
      : [];

    return (cachedTakes.length > 0 ? cachedTakes : (representativeTakes.length > 0 ? representativeTakes : fallbackTakes))
      .filter((take) => take && typeof take === "object")
      .sort((left, right) => Number(right?.takeScore ?? right?.combinedScore ?? 0) - Number(left?.takeScore ?? left?.combinedScore ?? 0));
  }

  function renderTopTakesTab(artifact, root = document) {
    const takes = getSortedTopTakes(artifact);

    if (takes.length === 0) {
      const empty = root.createElement("div");
      empty.className = "ariadex-empty";
      empty.textContent = "No high-signal quote-tweet perspectives were selected.";
      return empty;
    }

    const container = root.createElement("div");
    container.className = "ariadex-list ariadex-top-takes-list";

    let renderedCount = 0;
    const renderBatch = (count) => {
      const nextCount = Math.min(takes.length, renderedCount + count);
      for (let index = renderedCount; index < nextCount; index += 1) {
        container.appendChild(renderTakeCard(takes[index], root));
      }
      renderedCount = nextCount;
      if (renderedCount >= takes.length) {
        sentinel.textContent = `Showing all ${takes.length} cached take${takes.length === 1 ? "" : "s"}.`;
      } else {
        sentinel.textContent = `Showing ${renderedCount} of ${takes.length} cached takes. Scroll for more.`;
      }
    };

    const sentinel = root.createElement("div");
    sentinel.className = "ariadex-top-takes-sentinel";

    renderBatch(TOP_TAKES_INITIAL_RENDER_COUNT);
    if (takes.length > TOP_TAKES_INITIAL_RENDER_COUNT) {
      container.appendChild(sentinel);

      const scrollTarget = root.getElementById?.(PANEL_ID) || root.defaultView || null;
      const loadMoreIfNearBottom = () => {
        if (renderedCount >= takes.length) {
          return;
        }
        const target = root.getElementById?.(PANEL_ID) || scrollTarget;
        const scrollTop = Number(target?.scrollTop ?? root.defaultView?.scrollY ?? 0);
        const clientHeight = Number(target?.clientHeight ?? root.defaultView?.innerHeight ?? 0);
        const scrollHeight = Number(target?.scrollHeight ?? root?.documentElement?.scrollHeight ?? 0);
        if (!scrollHeight || scrollTop + clientHeight >= scrollHeight - 160) {
          if (sentinel.parentNode) {
            container.removeChild(sentinel);
          }
          renderBatch(TOP_TAKES_RENDER_BATCH_SIZE);
          if (renderedCount < takes.length) {
            container.appendChild(sentinel);
          }
        }
      };

      if (scrollTarget?.addEventListener) {
        scrollTarget.addEventListener("scroll", loadMoreIfNearBottom, { passive: true });
      }
      setTimeout(loadMoreIfNearBottom, 0);
    }
    return container;
  }

  function renderTopTakesSourceTab(sourceTweet, stats, root = document, artifact = {}) {
    const container = root.createElement("div");
    container.className = "ariadex-list";
    const item = root.createElement("article");
    item.className = "ariadex-item";

    const role = root.createElement("div");
    role.className = "ariadex-item-role";
    role.textContent = "Source Tweet";

    const author = root.createElement("div");
    author.className = "ariadex-item-author";
    author.textContent = `@${String(sourceTweet?.author || "unknown").replace(/^@/, "")}`;

    const text = root.createElement("div");
    text.className = "ariadex-item-text";
    text.textContent = String(sourceTweet?.text || "(no text)");

    const meta = root.createElement("div");
    meta.className = "ariadex-item-id";
    meta.textContent = [
      artifact?.sourceDomain ? `domain ${artifact.sourceDomain}` : "",
      `${Number(stats?.retrievedQuoteCount || 0)} quotes collected`,
      `${Number(stats?.candidateQuoteCount || 0)} candidates after dedupe`,
      `${Number(stats?.representativeTakeCount || 0)} representative takes`
    ].join(" · ");

    item.appendChild(role);
    item.appendChild(author);
    item.appendChild(text);
    item.appendChild(meta);
    container.appendChild(item);
    return container;
  }

  function renderTopTakesArtifact(artifact, clickedId, root = document) {
    const panel = ensurePanel(root);
    panel.innerHTML = "";
    const stats = artifact?.stats || {};
    const groupedRoles = Array.isArray(artifact?.groupedRoles) ? artifact.groupedRoles : [];
    const representatives = Array.isArray(artifact?.representativeTakes) ? artifact.representativeTakes : [];
    const allTopTakes = getSortedTopTakes(artifact);
    renderHeader(
      panel,
      root,
      `${Number(stats.candidateQuoteCount || 0)} candidates · ${allTopTakes.length} cached takes · ${representatives.length} selected`,
      "AriadeX · Top Takes"
    );

    const state = panel.__ariadexV2State && typeof panel.__ariadexV2State === "object"
      ? panel.__ariadexV2State
      : { activeTab: "topTakes", position: null };
    panel.__ariadexV2State = state;
    state.activeTab = state.activeTab === "sourceTweet" || state.activeTab === "people" ? state.activeTab : "topTakes";
    state.latestTopTakesArtifact = artifact;
    state.latestArtifact = artifact;
    state.latestClickedId = clickedId || "";

    const tabBar = root.createElement("div");
    tabBar.className = "ariadex-tab-bar";
    const content = root.createElement("div");
    content.className = "ariadex-tab-content";
    const tabs = [
      { id: "topTakes", label: "Top Takes" },
      { id: "sourceTweet", label: "Source" },
      { id: "people", label: "People" }
    ];

    function paintTab(tabId) {
      content.innerHTML = "";
      if (tabId === "sourceTweet") {
        content.appendChild(renderTopTakesSourceTab(artifact?.sourceTweet || {}, stats, root, artifact));
        return;
      }
      if (tabId === "people") {
        content.appendChild(renderPeopleTab(Array.isArray(artifact?.people) ? artifact.people : [], root));
        return;
      }
      content.appendChild(renderTopTakesTab(artifact, root));
    }

    for (const tab of tabs) {
      const button = root.createElement("button");
      button.type = "button";
      button.className = `ariadex-tab-button${state.activeTab === tab.id ? " ariadex-tab-button-active" : ""}`;
      button.textContent = tab.label;
      button.addEventListener("click", () => {
        state.activeTab = tab.id;
        for (const candidate of tabBar.querySelectorAll(".ariadex-tab-button")) {
          candidate.classList.remove("ariadex-tab-button-active");
        }
        button.classList.add("ariadex-tab-button-active");
        paintTab(tab.id);
      });
      tabBar.appendChild(button);
    }

    panel.appendChild(tabBar);
    panel.appendChild(content);
    paintTab(state.activeTab);
    return panel;
  }

  // Render the full artifact and keep the active tab sticky across rerenders.
  function renderArtifact(artifact, clickedId, root = document) {
    const panel = ensurePanel(root);
    panel.innerHTML = "";
    const path = Array.isArray(artifact?.path) ? artifact.path : [];
    const references = Array.isArray(artifact?.references) ? artifact.references : [];
    const people = Array.isArray(artifact?.people) ? artifact.people : [];
    const replyChains = Array.isArray(artifact?.replyChains) ? artifact.replyChains : [];
    renderHeader(panel, root, `${path.length} path tweets · ${references.length} refs · ${people.length} people · ${replyChains.length} reply chains`);

    if (path.length === 0) {
      const empty = root.createElement("div");
      empty.className = "ariadex-empty";
      empty.textContent = "No path could be resolved.";
      panel.appendChild(empty);
      return panel;
    }

    const state = panel.__ariadexV2State && typeof panel.__ariadexV2State === "object"
      ? panel.__ariadexV2State
      : { activeTab: DEFAULT_TAB, position: null, latestArtifact: null, latestClickedId: "", latestReport: null, latestGist: null };
    panel.__ariadexV2State = state;
    state.latestArtifact = {
      path,
      references,
      people,
      replyChains
    };
    state.latestClickedId = clickedId || "";

    const tabBar = root.createElement("div");
    tabBar.className = "ariadex-tab-bar";
    const content = root.createElement("div");
    content.className = "ariadex-tab-content";

    const tabs = [
      { id: "path", label: "Root Path" },
      { id: "references", label: "References" },
      { id: "people", label: "People" },
      { id: "replyChains", label: "Replies" }
    ];
    if (state.latestGist?.text) {
      tabs.push({ id: "gist", label: "Gist" });
    }
    if (state.latestReport?.text) {
      tabs.push({ id: "report", label: "Report" });
    }

    function paintTab(tabId) {
      content.innerHTML = "";
      if (tabId === "gist") {
        content.appendChild(renderGistTab(state.latestGist || {}, root));
        return;
      }
      if (tabId === "report") {
        content.appendChild(renderReportTab(state.latestReport || {}, root));
        return;
      }
      if (tabId === "replyChains") {
        content.appendChild(renderReplyChainsTab(replyChains, path, clickedId, root));
        return;
      }
      if (tabId === "people") {
        content.appendChild(renderPeopleTab(people, root));
        return;
      }
      if (tabId === "references") {
        content.appendChild(renderReferencesTab(references, root));
        return;
      }
      content.appendChild(renderPathTab(path, clickedId, root));
    }

    for (const tab of tabs) {
      const button = root.createElement("button");
      button.type = "button";
      button.className = `ariadex-tab-button${state.activeTab === tab.id ? " ariadex-tab-button-active" : ""}`;
      button.textContent = tab.label;
      button.addEventListener("click", () => {
        state.activeTab = tab.id;
        for (const candidate of tabBar.querySelectorAll(".ariadex-tab-button")) {
          candidate.classList.remove("ariadex-tab-button-active");
        }
        button.classList.add("ariadex-tab-button-active");
        paintTab(tab.id);
      });
      tabBar.appendChild(button);
    }

    panel.appendChild(tabBar);
    panel.appendChild(content);
    paintTab(state.activeTab);
    return panel;
  }

  // Ask the background worker for the root-path artifact; the content script never fetches directly.
  function resolveRootArtifact(clickedTweetId, chromeApi = chrome, onProgress = null) {
    if (!clickedTweetId) {
      return Promise.resolve({ path: [], references: [], people: [], replyChains: [] });
    }

    if (!chromeApi?.runtime?.sendMessage) {
      return Promise.reject(new Error("extension_runtime_unavailable"));
    }

    return awaitDevEnvHydration(globalThis).then(() => Promise.all([
      readXApiBearerTokenWithFallbacks(chromeApi, globalThis.window),
      Promise.resolve(readConfiguredApiBaseUrl(globalThis.window))
    ])).then(([bearerToken, apiBaseUrl]) => {
      return new Promise((resolve, reject) => {
      if (chromeApi?.runtime?.connect) {
        const port = chromeApi.runtime.connect({ name: RESOLVE_ROOT_PATH_PORT_NAME });
        let settled = false;
        const finishResolve = (value) => {
          if (settled) {
            return;
          }
          settled = true;
          resolve(value);
        };
        const finishReject = (error) => {
          if (settled) {
            return;
          }
          settled = true;
          reject(error);
        };
        port.onMessage.addListener((message) => {
          if (message?.type === "progress") {
            if (typeof onProgress === "function") {
              onProgress(message.progress || {});
            }
            return;
          }

          if (message?.type === "result") {
            port.disconnect();
            const artifact = message?.artifact && typeof message.artifact === "object"
              ? message.artifact
              : {};
            finishResolve({
              path: Array.isArray(artifact.path) ? artifact.path : [],
              references: Array.isArray(artifact.references) ? artifact.references : [],
              people: Array.isArray(artifact.people) ? artifact.people : [],
              replyChains: Array.isArray(artifact.replyChains) ? artifact.replyChains : []
            });
            return;
          }

          if (message?.type === "error") {
            port.disconnect();
            finishReject(new Error(message?.error || "root_path_resolution_failed"));
          }
        });
        if (port.onDisconnect?.addListener) {
          port.onDisconnect.addListener(() => {
            const runtimeMessage = chromeApi?.runtime?.lastError?.message || "";
            finishReject(new Error(runtimeMessage || "root_path_port_disconnected"));
          });
        }
        port.postMessage({
          type: MESSAGE_TYPE,
          tweetId: clickedTweetId,
          bearerToken,
          apiBaseUrl
        });
        return;
      }

      chromeApi.runtime.sendMessage(
        {
          type: MESSAGE_TYPE,
          tweetId: clickedTweetId,
          bearerToken,
          apiBaseUrl
        },
        (response) => {
          const runtimeError = chromeApi.runtime?.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message || "extension_message_failed"));
            return;
          }

          if (!response?.ok) {
            reject(new Error(response?.error || "root_path_resolution_failed"));
            return;
          }

          const artifact = response?.artifact && typeof response.artifact === "object"
            ? response.artifact
            : {};
          resolve({
            path: Array.isArray(artifact.path) ? artifact.path : [],
            references: Array.isArray(artifact.references) ? artifact.references : [],
            people: Array.isArray(artifact.people) ? artifact.people : [],
            replyChains: Array.isArray(artifact.replyChains) ? artifact.replyChains : []
          });
        }
        );
      });
    });
  }

  function generateReportArtifact(artifact, chromeApi = chrome) {
    if (!chromeApi?.runtime?.sendMessage) {
      return Promise.reject(new Error("extension_runtime_unavailable"));
    }

    const onProgress = typeof arguments[2] === "function" ? arguments[2] : null;

    return new Promise((resolve, reject) => {
      if (chromeApi?.runtime?.connect) {
        const port = chromeApi.runtime.connect({ name: GENERATE_REPORT_PORT_NAME });
        let settled = false;
        const finishResolve = (value) => {
          if (settled) {
            return;
          }
          settled = true;
          resolve(value);
        };
        const finishReject = (error) => {
          if (settled) {
            return;
          }
          settled = true;
          reject(error);
        };

        port.onMessage.addListener((message) => {
          if (message?.type === "progress") {
            if (onProgress) {
              onProgress(message.progress || {});
            }
            return;
          }
          if (message?.type === "result") {
            finishResolve(message?.report && typeof message.report === "object" ? message.report : {});
            port.disconnect();
            return;
          }
          if (message?.type === "error") {
            finishReject(new Error(message?.error || "report_generation_failed"));
            port.disconnect();
          }
        });
        if (port.onDisconnect?.addListener) {
          port.onDisconnect.addListener(() => {
            const runtimeMessage = chromeApi?.runtime?.lastError?.message || "";
            finishReject(new Error(runtimeMessage || "report_generation_port_disconnected"));
          });
        }
        port.postMessage({
          type: GENERATE_REPORT_MESSAGE_TYPE,
          artifact
        });
        return;
      }

      chromeApi.runtime.sendMessage(
        {
          type: GENERATE_REPORT_MESSAGE_TYPE,
          artifact
        },
        (response) => {
          const runtimeError = chromeApi.runtime?.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message || "extension_message_failed"));
            return;
          }

          if (!response?.ok) {
            reject(new Error(response?.error || "report_generation_failed"));
            return;
          }

          resolve(response?.report && typeof response.report === "object" ? response.report : {});
        }
      );
    });
  }

  function generateGistArtifact(artifact, chromeApi = chrome) {
    if (!chromeApi?.runtime?.sendMessage) {
      return Promise.reject(new Error("extension_runtime_unavailable"));
    }

    const onProgress = typeof arguments[2] === "function" ? arguments[2] : null;

    return new Promise((resolve, reject) => {
      if (chromeApi?.runtime?.connect) {
        const port = chromeApi.runtime.connect({ name: GENERATE_GIST_PORT_NAME });
        let settled = false;
        const finishResolve = (value) => {
          if (settled) {
            return;
          }
          settled = true;
          resolve(value);
        };
        const finishReject = (error) => {
          if (settled) {
            return;
          }
          settled = true;
          reject(error);
        };

        port.onMessage.addListener((message) => {
          if (message?.type === "progress") {
            if (onProgress) {
              onProgress(message.progress || {});
            }
            return;
          }
          if (message?.type === "result") {
            finishResolve(message?.report && typeof message.report === "object" ? message.report : {});
            port.disconnect();
            return;
          }
          if (message?.type === "error") {
            finishReject(new Error(message?.error || "gist_generation_failed"));
            port.disconnect();
          }
        });
        if (port.onDisconnect?.addListener) {
          port.onDisconnect.addListener(() => {
            const runtimeMessage = chromeApi?.runtime?.lastError?.message || "";
            finishReject(new Error(runtimeMessage || "gist_generation_port_disconnected"));
          });
        }
        port.postMessage({
          type: GENERATE_GIST_MESSAGE_TYPE,
          artifact
        });
        return;
      }

      chromeApi.runtime.sendMessage(
        {
          type: GENERATE_GIST_MESSAGE_TYPE,
          artifact
        },
        (response) => {
          const runtimeError = chromeApi.runtime?.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message || "extension_message_failed"));
            return;
          }

          if (!response?.ok) {
            reject(new Error(response?.error || "gist_generation_failed"));
            return;
          }

          resolve(response?.report && typeof response.report === "object" ? response.report : {});
        }
      );
    });
  }

  function resolveTopTakesArtifact(clickedTweetId, chromeApi = chrome, onProgress = null) {
    if (!clickedTweetId) {
      return Promise.resolve({
        sourceTweet: null,
        takes: [],
        groupedRoles: [],
        representativeTakes: [],
        people: [],
        stats: {},
        modelMetadata: {}
      });
    }

    if (!chromeApi?.runtime?.sendMessage) {
      return Promise.reject(new Error("extension_runtime_unavailable"));
    }

    function normalizeArtifact(artifact) {
      return {
        sourceTweet: artifact?.sourceTweet || null,
        takes: Array.isArray(artifact?.takes) ? artifact.takes : [],
        groupedRoles: Array.isArray(artifact?.groupedRoles) ? artifact.groupedRoles : [],
        representativeTakes: Array.isArray(artifact?.representativeTakes) ? artifact.representativeTakes : [],
        people: Array.isArray(artifact?.people) ? artifact.people : [],
        stats: artifact?.stats && typeof artifact.stats === "object" ? artifact.stats : {},
        modelMetadata: artifact?.modelMetadata && typeof artifact.modelMetadata === "object" ? artifact.modelMetadata : {}
      };
    }

    return awaitDevEnvHydration(globalThis).then(() => Promise.all([
      readXApiBearerTokenWithFallbacks(chromeApi, globalThis.window),
      Promise.resolve(readConfiguredApiBaseUrl(globalThis.window))
    ])).then(([bearerToken, apiBaseUrl]) => {
      return new Promise((resolve, reject) => {
        if (chromeApi?.runtime?.connect) {
          const port = chromeApi.runtime.connect({ name: RESOLVE_TOP_TAKES_PORT_NAME });
          let settled = false;
          const finishResolve = (value) => {
            if (settled) {
              return;
            }
            settled = true;
            resolve(value);
          };
          const finishReject = (error) => {
            if (settled) {
              return;
            }
            settled = true;
            reject(error);
          };

          port.onMessage.addListener((message) => {
            if (message?.type === "progress") {
              if (typeof onProgress === "function") {
                onProgress(message.progress || {});
              }
              return;
            }
            if (message?.type === "result") {
              finishResolve(normalizeArtifact(message?.artifact || {}));
              port.disconnect();
              return;
            }
            if (message?.type === "error") {
              finishReject(new Error(message?.error || "top_takes_failed"));
              port.disconnect();
            }
          });
          if (port.onDisconnect?.addListener) {
            port.onDisconnect.addListener(() => {
              const runtimeMessage = chromeApi?.runtime?.lastError?.message || "";
              finishReject(new Error(runtimeMessage || "top_takes_port_disconnected"));
            });
          }
          port.postMessage({
            type: RESOLVE_TOP_TAKES_MESSAGE_TYPE,
            tweetId: clickedTweetId,
            bearerToken,
            apiBaseUrl
          });
          return;
        }

        chromeApi.runtime.sendMessage({
          type: RESOLVE_TOP_TAKES_MESSAGE_TYPE,
          tweetId: clickedTweetId,
          bearerToken,
          apiBaseUrl
        }, (response) => {
          const runtimeError = chromeApi.runtime?.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message || "extension_message_failed"));
            return;
          }
          if (!response?.ok) {
            reject(new Error(response?.error || "top_takes_failed"));
            return;
          }
          resolve(normalizeArtifact(response?.artifact || {}));
        });
      });
    });
  }

  // Ask the background worker to clear the tweet cache used during recursive resolution.
  function clearTweetCache(chromeApi = chrome) {
    if (!chromeApi?.runtime?.sendMessage) {
      return Promise.reject(new Error("extension_runtime_unavailable"));
    }

    return new Promise((resolve, reject) => {
      chromeApi.runtime.sendMessage(
        { type: CLEAR_CACHE_MESSAGE_TYPE },
        (response) => {
          const runtimeError = chromeApi.runtime?.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message || "extension_message_failed"));
            return;
          }

          if (!response?.ok) {
            reject(new Error(response?.error || "cache_clear_failed"));
            return;
          }

          resolve();
        }
      );
    });
  }

  // Inject the user-facing button and wire it to background resolution plus panel rendering.
  function createExploreButton(article, root = document, chromeApi = chrome) {
    const button = root.createElement("button");
    button.type = "button";
    button.className = "ariadex-button";
    button.setAttribute(BUTTON_ATTR, "true");
    button.textContent = "Explore Path";

    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const tweetArticle = findClosestTweetArticle(button) || article;
      const clickedId = extractTweetId(tweetArticle);
      if (!clickedId) {
        renderStatus("Could not resolve clicked tweet id.", root);
        return;
      }

      renderStatus(`Tracing root path from ${clickedId}...`, root);

      try {
        const artifact = await resolveRootArtifact(clickedId, chromeApi, (progress) => {
          renderStatus(formatProgressMessage(progress), root);
        });
        renderArtifact(artifact, clickedId, root);
      } catch (error) {
        renderStatus(formatLookupErrorMessage(error), root);
      }
    });

    return button;
  }

  function createTopTakesButton(article, root = document, chromeApi = chrome) {
    const button = root.createElement("button");
    button.type = "button";
    button.className = "ariadex-button ariadex-top-takes-button";
    button.setAttribute(TOP_TAKES_BUTTON_ATTR, "true");
    button.textContent = "Top Takes";

    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const tweetArticle = findClosestTweetArticle(button) || article;
      const clickedId = extractTweetId(tweetArticle);
      if (!clickedId) {
        renderTopTakesStatus("Could not resolve clicked tweet id.", root);
        return;
      }

      renderTopTakesStatus(`Collecting quote-tweet discourse for ${clickedId}...`, root);
      try {
        const artifact = await resolveTopTakesArtifact(clickedId, chromeApi, (progress) => {
          renderTopTakesStatus(formatTopTakesProgressMessage(progress), root);
        });
        renderTopTakesArtifact(artifact, clickedId, root);
      } catch (error) {
        renderTopTakesStatus(formatTopTakesErrorMessage(error), root);
      }
    });

    return button;
  }

  // Add the button only once per tweet card.
  function injectButton(article, root = document, chromeApi = chrome) {
    if (!article) {
      return;
    }

    const toolbar = article.querySelector('[role="group"]');
    if (!toolbar) {
      return;
    }

    if (!article.querySelector(`[${BUTTON_ATTR}="true"]`)) {
      toolbar.appendChild(createExploreButton(article, root, chromeApi));
    }
    if (!article.querySelector(`[${TOP_TAKES_BUTTON_ATTR}="true"]`)) {
      toolbar.appendChild(createTopTakesButton(article, root, chromeApi));
    }
  }

  // Re-scan the current DOM slice and attach buttons to newly rendered tweets.
  function scan(root = document, chromeApi = chrome) {
    findTweetArticles(root).forEach((article) => injectButton(article, root, chromeApi));
  }

  // Boot the content script and keep it alive as X mutates the timeline DOM.
  function start(root = document, chromeApi = chrome) {
    const observer = new MutationObserver(() => {
      scan(root, chromeApi);
    });

    scan(root, chromeApi);
    observer.observe(root.documentElement, {
      childList: true,
      subtree: true
    });
    return observer;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      BUTTON_ATTR,
      TOP_TAKES_BUTTON_ATTR,
      PANEL_ID,
      ARTICLE_SELECTOR,
      MESSAGE_TYPE,
      CLEAR_CACHE_MESSAGE_TYPE,
      GENERATE_REPORT_MESSAGE_TYPE,
      GENERATE_GIST_MESSAGE_TYPE,
      RESOLVE_TOP_TAKES_MESSAGE_TYPE,
      GENERATE_REPORT_PORT_NAME,
      GENERATE_GIST_PORT_NAME,
      RESOLVE_TOP_TAKES_PORT_NAME,
      normalizeText,
      readLocalStorageValue,
      readXApiBearerToken,
      readChromeStorageLocalValue,
      readXApiBearerTokenWithFallbacks,
      awaitDevEnvHydration,
      formatProgressMessage,
      formatLookupErrorMessage,
      formatReportErrorMessage,
      formatReportProgressMessage,
      formatGistProgressMessage,
      formatTopTakesProgressMessage,
      formatTopTakesErrorMessage,
      baseLabelForIndex,
      relationLabel,
      buildPathEntries,
      findTweetArticles,
      findClosestTweetArticle,
      extractTweetId,
      ensurePanel,
      getViewportBounds,
      getPanelSize,
      clampPanelPosition,
      applyPanelPosition,
      makePanelMovable,
      renderStatus,
      renderTopTakesStatus,
      buildReferenceBadgeText,
      buildExportFilename,
      buildReportFilename,
      buildGistFilename,
      triggerJsonDownload,
      triggerTextDownload,
      copyTextToClipboard,
      setAccessibleLabel,
      createCopyIcon,
      renderPathTab,
      renderReferencesTab,
      renderPeopleTab,
      renderReplyChainsTab,
      renderGeneratedTextTab,
      renderGistTab,
      renderReportTab,
      renderTakeCard,
      renderTopTakesTab,
      renderTopTakesSourceTab,
      renderTopTakesArtifact,
      renderArtifact,
      resolveRootArtifact,
      resolveTopTakesArtifact,
      generateReportArtifact,
      generateGistArtifact,
      clearTweetCache,
      createExploreButton,
      createTopTakesButton,
      injectButton,
      scan,
      start
    };
  } else {
    start(document, chrome);
  }
})();
