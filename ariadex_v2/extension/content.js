(() => {
  "use strict";

  const BUTTON_ATTR = "data-ariadex-v2-button";
  const PANEL_ID = "ariadex-v2-panel";
  const ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
  const MESSAGE_TYPE = "ARIADEx_V2_RESOLVE_ROOT_PATH";
  const CLEAR_CACHE_MESSAGE_TYPE = "ARIADEx_V2_CLEAR_CACHE";
  const GENERATE_REPORT_MESSAGE_TYPE = "ARIADEx_V2_GENERATE_REPORT";
  const RESOLVE_ROOT_PATH_PORT_NAME = "ARIADEx_V2_RESOLVE_ROOT_PATH_PORT";
  const GENERATE_REPORT_PORT_NAME = "ARIADEx_V2_GENERATE_REPORT_PORT";
  const DEFAULT_TAB = "path";
  const PANEL_MARGIN = 20;
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
    const pending = globalObj?.AriadexV2DevEnvReady;
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
    return `ariadex-v2-${normalizedId}.json`;
  }

  function buildReportFilename(clickedId) {
    const normalizedId = String(clickedId || "root-path").trim() || "root-path";
    return `ariadex-v2-${normalizedId}-report.md`;
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
    icon.className = "ariadex-v2-copy-icon";

    const backSquare = root.createElement("span");
    backSquare.className = "ariadex-v2-copy-icon-back";

    const frontSquare = root.createElement("span");
    frontSquare.className = "ariadex-v2-copy-icon-front";

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
      return "Report generation failed.";
    }

    const normalized = rawMessage.toLowerCase();
    if (
      normalized.includes("report_generation_failed_401")
      || normalized.includes("report_generation_failed_403")
    ) {
      return "Report generation failed: the configured model API rejected the request. Check the API key, model, and endpoint.";
    }
    if (normalized.includes("report_generation_failed_429")) {
      return "Report generation failed: the configured model API rate-limited the request. Check quota, billing, or retry later.";
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
      return "Report generation failed: the AriadeX report backend is unavailable. Start or reload the backend, then check local network access.";
    }
    if (normalized.includes("missing_openai_api_key")) {
      return "Report generation failed: the backend is missing OPENAI_API_KEY.";
    }
    if (normalized.includes("empty_report_response")) {
      return "Report generation failed: the model returned an empty response.";
    }

    return `Report generation failed: ${rawMessage}`;
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
    panel.className = "ariadex-v2-panel";
    panel.__ariadexV2State = {
      activeTab: DEFAULT_TAB,
      position: null,
      latestArtifact: null,
      latestClickedId: ""
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
        handle.classList.remove("ariadex-v2-panel-header-dragging");
      }

      handle.classList.add("ariadex-v2-panel-header-dragging");
      view.addEventListener("mousemove", onMouseMove);
      view.addEventListener("mouseup", onMouseUp);
      event.preventDefault();
    }

    handle.classList.add("ariadex-v2-panel-header-draggable");
    handle.addEventListener("mousedown", onMouseDown);
    panel.__ariadexV2DragCleanup = () => {
      handle.removeEventListener("mousedown", onMouseDown);
    };
  }

  // Shared header renderer for loading, error, and resolved artifact states.
  function renderHeader(panel, root, metaText) {
    const header = root.createElement("div");
    header.className = "ariadex-v2-panel-header";

    const title = root.createElement("div");
    title.className = "ariadex-v2-title";
    title.textContent = "AriadeX v2 · Root Path";

    const meta = root.createElement("div");
    meta.className = "ariadex-v2-meta";
    meta.textContent = normalizeText(metaText || "Tracing root path...");

    const actions = root.createElement("div");
    actions.className = "ariadex-v2-header-actions";

    const exportButton = root.createElement("button");
    exportButton.type = "button";
    exportButton.className = "ariadex-v2-header-button";
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
    reportButton.className = "ariadex-v2-header-button";
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

    const clearButton = root.createElement("button");
    clearButton.type = "button";
    clearButton.className = "ariadex-v2-header-button";
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

  // Build the path tab with relation labels, tweet text, and inline reference markers.
  function renderPathTab(path, clickedId, root) {
    const list = root.createElement("ol");
    list.className = "ariadex-v2-list";

    for (const entry of buildPathEntries(path, clickedId)) {
      const item = root.createElement("li");
      item.className = "ariadex-v2-item";

      const role = root.createElement("div");
      role.className = "ariadex-v2-item-role";
      role.textContent = entry.title;

      const author = root.createElement("div");
      author.className = "ariadex-v2-item-author";
      author.textContent = `@${String(entry.author || "unknown").replace(/^@/, "")}`;

      const text = root.createElement("div");
      text.className = "ariadex-v2-item-text";
      text.textContent = entry.text || "(no text)";

      const badgeText = buildReferenceBadgeText(entry.referenceNumbers);
      if (badgeText) {
        const refs = root.createElement("div");
        refs.className = "ariadex-v2-item-refs";
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
      id.className = "ariadex-v2-item-id";
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
      empty.className = "ariadex-v2-empty";
      empty.textContent = "No external references found on this path or its reply chains.";
      return empty;
    }

    const list = root.createElement("ol");
    list.className = "ariadex-v2-list";

    for (const reference of references) {
      const item = root.createElement("li");
      item.className = "ariadex-v2-item";

      const role = root.createElement("div");
      role.className = "ariadex-v2-item-role";
      role.textContent = `Reference [${reference.number}]`;

      const url = root.createElement("div");
      url.className = "ariadex-v2-item-text";
      url.textContent = reference.canonicalUrl;

      const meta = root.createElement("div");
      meta.className = "ariadex-v2-item-id";
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
      empty.className = "ariadex-v2-empty";
      empty.textContent = "No people were collected on this root path.";
      return empty;
    }

    const list = root.createElement("ol");
    list.className = "ariadex-v2-list";

    for (const person of people) {
      const item = root.createElement("li");
      item.className = "ariadex-v2-item";

      if (person.avatarUrl) {
        const avatar = root.createElement("img");
        avatar.className = "ariadex-v2-person-avatar";
        avatar.src = person.avatarUrl;
        avatar.alt = person.displayName
          ? `${person.displayName} profile picture`
          : `@${String(person.handle || "").replace(/^@/, "")} profile picture`;
        avatar.loading = "lazy";
        item.appendChild(avatar);
      }

      const role = root.createElement("div");
      role.className = "ariadex-v2-item-role";
      role.textContent = `@${String(person.handle || "").replace(/^@/, "")}`;

      const displayName = root.createElement("div");
      displayName.className = "ariadex-v2-item-author";
      displayName.textContent = person.displayName || "(no display name)";

      const profile = root.createElement("div");
      profile.className = "ariadex-v2-item-text";
      profile.textContent = person.profileUrl || "";

      const sourceTypes = Array.isArray(person.sourceTypes) ? person.sourceTypes : [];
      const citedByTweetIds = Array.isArray(person.citedByTweetIds) ? person.citedByTweetIds : [];
      const meta = root.createElement("div");
      meta.className = "ariadex-v2-item-id";
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
      empty.className = "ariadex-v2-empty";
      empty.textContent = "No replies to the explored tweet were found.";
      return empty;
    }

    const pathEntries = buildPathEntries(path, clickedId);
    const labelById = new Map(pathEntries.map((tweet) => [tweet.id, tweet.label]));
    const list = root.createElement("ol");
    list.className = "ariadex-v2-list";

    for (const chain of replyChains) {
      const item = root.createElement("li");
      item.className = "ariadex-v2-item";

      const header = root.createElement("div");
      header.className = "ariadex-v2-item-role";
      const anchorLabel = labelById.get(String(chain.anchorTweetId || "")) || "Path Tweet";
      header.textContent = `${anchorLabel} Reply Chain · ${Array.isArray(chain.tweets) ? chain.tweets.length : 0} tweet${Array.isArray(chain.tweets) && chain.tweets.length === 1 ? "" : "s"}`;

      const participants = root.createElement("div");
      participants.className = "ariadex-v2-item-author";
      const anchorHandle = String(chain.anchorAuthor || "").replace(/^@/, "");
      const participantText = (Array.isArray(chain.participantHandles) ? chain.participantHandles : [])
        .map((handle) => `@${String(handle || "").replace(/^@/, "")}`)
        .join(" · ");
      participants.textContent = anchorHandle
        ? `Reply to @${anchorHandle} · ${participantText}`
        : participantText;

      const meta = root.createElement("div");
      meta.className = "ariadex-v2-item-id";
      meta.textContent = (Array.isArray(chain.tweets) ? chain.tweets : [])
        .map((tweet) => tweet.id)
        .join(", ");

      const tweetList = root.createElement("ol");
      tweetList.className = "ariadex-v2-list";

      for (const tweet of Array.isArray(chain.tweets) ? chain.tweets : []) {
        const tweetItem = root.createElement("li");
        tweetItem.className = "ariadex-v2-item";

        const tweetRole = root.createElement("div");
        tweetRole.className = "ariadex-v2-item-role";
        tweetRole.textContent = "Reply Tweet";

        const tweetAuthor = root.createElement("div");
        tweetAuthor.className = "ariadex-v2-item-author";
        tweetAuthor.textContent = `@${String(tweet.author || "").replace(/^@/, "")}`;

        const tweetText = root.createElement("div");
        tweetText.className = "ariadex-v2-item-text";
        tweetText.textContent = String(tweet.text || "(no text)");

        const tweetMeta = root.createElement("div");
        tweetMeta.className = "ariadex-v2-item-id";
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

  function renderReportTab(report, root = document) {
    if (!report?.text) {
      const empty = root.createElement("div");
      empty.className = "ariadex-v2-empty";
      empty.textContent = "No report has been generated yet.";
      return empty;
    }

    const container = root.createElement("div");
    container.className = "ariadex-v2-list";

    const item = root.createElement("article");
    item.className = "ariadex-v2-item";

    const topRow = root.createElement("div");
    topRow.className = "ariadex-v2-report-top";

    const header = root.createElement("div");
    header.className = "ariadex-v2-item-role";
    header.textContent = "Generated Report";

    const meta = root.createElement("div");
    meta.className = "ariadex-v2-item-id";
    const generatedAt = normalizeText(report?.generatedAt || "");
    const reportMeta = [
      generatedAt ? `Generated ${generatedAt}` : "",
      report?.model ? `model ${report.model}` : ""
    ].filter(Boolean).join(" · ");
    meta.textContent = reportMeta;

    const body = root.createElement("div");
    body.className = "ariadex-v2-item-text";
    body.style.whiteSpace = "pre-wrap";
    body.textContent = String(report?.text || "");

    const actions = root.createElement("div");
    actions.className = "ariadex-v2-report-actions";

    const copyButton = root.createElement("button");
    copyButton.type = "button";
    copyButton.className = "ariadex-v2-header-button ariadex-v2-report-icon-button";
    setAccessibleLabel(copyButton, "Copy Markdown");

    const copyIcon = createCopyIcon(root);
    const copyLabel = root.createElement("span");
    copyLabel.textContent = "Copy";
    copyButton.appendChild(copyIcon);
    copyButton.appendChild(copyLabel);
    copyButton.addEventListener("click", async () => {
      try {
        await copyTextToClipboard(String(report?.text || ""), root);
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
    downloadButton.className = "ariadex-v2-header-button";
    downloadButton.textContent = "Download";
    setAccessibleLabel(downloadButton, "Download Report");
    downloadButton.addEventListener("click", () => {
      const panel = root.getElementById(PANEL_ID);
      const state = panel?.__ariadexV2State && typeof panel.__ariadexV2State === "object"
        ? panel.__ariadexV2State
        : null;
      triggerTextDownload(String(report?.text || ""), buildReportFilename(state?.latestClickedId || ""), root);
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
      empty.className = "ariadex-v2-empty";
      empty.textContent = "No path could be resolved.";
      panel.appendChild(empty);
      return panel;
    }

    const state = panel.__ariadexV2State && typeof panel.__ariadexV2State === "object"
      ? panel.__ariadexV2State
      : { activeTab: DEFAULT_TAB, position: null, latestArtifact: null, latestClickedId: "", latestReport: null };
    panel.__ariadexV2State = state;
    state.latestArtifact = {
      path,
      references,
      people,
      replyChains
    };
    state.latestClickedId = clickedId || "";

    const tabBar = root.createElement("div");
    tabBar.className = "ariadex-v2-tab-bar";
    const content = root.createElement("div");
    content.className = "ariadex-v2-tab-content";

    const tabs = [
      { id: "path", label: "Root Path" },
      { id: "references", label: "References" },
      { id: "people", label: "People" },
      { id: "replyChains", label: "Replies" }
    ];
    if (state.latestReport?.text) {
      tabs.push({ id: "report", label: "Report" });
    }

    function paintTab(tabId) {
      content.innerHTML = "";
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
      button.className = `ariadex-v2-tab-button${state.activeTab === tab.id ? " ariadex-v2-tab-button-active" : ""}`;
      button.textContent = tab.label;
      button.addEventListener("click", () => {
        state.activeTab = tab.id;
        for (const candidate of tabBar.querySelectorAll(".ariadex-v2-tab-button")) {
          candidate.classList.remove("ariadex-v2-tab-button-active");
        }
        button.classList.add("ariadex-v2-tab-button-active");
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
    button.className = "ariadex-v2-button";
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

  // Add the button only once per tweet card.
  function injectButton(article, root = document, chromeApi = chrome) {
    if (!article || article.querySelector(`[${BUTTON_ATTR}="true"]`)) {
      return;
    }

    const toolbar = article.querySelector('[role="group"]');
    if (!toolbar) {
      return;
    }

    toolbar.appendChild(createExploreButton(article, root, chromeApi));
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
      PANEL_ID,
      ARTICLE_SELECTOR,
      MESSAGE_TYPE,
      CLEAR_CACHE_MESSAGE_TYPE,
      GENERATE_REPORT_MESSAGE_TYPE,
      GENERATE_REPORT_PORT_NAME,
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
      buildReferenceBadgeText,
      buildExportFilename,
      buildReportFilename,
      triggerJsonDownload,
      triggerTextDownload,
      copyTextToClipboard,
      setAccessibleLabel,
      createCopyIcon,
      renderPathTab,
      renderReferencesTab,
      renderPeopleTab,
      renderReplyChainsTab,
      renderReportTab,
      renderArtifact,
      resolveRootArtifact,
      generateReportArtifact,
      clearTweetCache,
      createExploreButton,
      injectButton,
      scan,
      start
    };
  } else {
    start(document, chrome);
  }
})();
