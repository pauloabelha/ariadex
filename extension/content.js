(() => {
  "use strict";

  const globalScope = typeof globalThis !== "undefined" ? globalThis : {};

  const domCollectorApi = typeof module !== "undefined" && module.exports
    ? require("./dom_collector.js")
    : (globalScope.AriadexDataDomCollector || {});
  const xApiClientApi = typeof module !== "undefined" && module.exports
    ? require("./x_api_client.js")
    : (globalScope.AriadexDataXApiClient || {});
  const conversationEngineApi = typeof module !== "undefined" && module.exports
    ? require("./conversation_engine.js")
    : (globalScope.AriadexConversationEngine || {});
  const panelRendererApi = typeof module !== "undefined" && module.exports
    ? require("./panel_renderer.js")
    : (globalScope.AriadexUIPanelRenderer || {});
  const rootResolutionApi = typeof module !== "undefined" && module.exports
    ? require("./root_resolution.js")
    : (globalScope.AriadexRootResolution || {});

  // Compatibility exports for legacy tests/integration points.
  const replyInferenceApi = typeof module !== "undefined" && module.exports
    ? require("./reply_inference.js")
    : (globalScope.AriadexReplyInference || {});
  const conversationGraphApi = typeof module !== "undefined" && module.exports
    ? require("./conversation_graph.js")
    : (globalScope.AriadexConversationGraph || {});
  const threadCollapseApi = typeof module !== "undefined" && module.exports
    ? require("./thread_collapse.js")
    : (globalScope.AriadexThreadCollapse || {});
  const conversationRankApi = typeof module !== "undefined" && module.exports
    ? require("./conversation_rank.js")
    : (globalScope.AriadexConversationRank || {});

  const EXTENSION_ROOT_ATTR = "data-ariadex-initialized";
  const BUTTON_CLASS = "ariadex-explore-button";
  const BUTTON_ATTR = "data-ariadex-explore-button";
  const BUTTON_TWEET_ID_ATTR = "data-ariadex-tweet-id";
  const INJECTED_ATTR = "data-ariadex-injected";
  const EXPLORE_MODE = "deep";
  const buttonTweetElementByButton = new WeakMap();

  const extractTweetData = typeof domCollectorApi.extractTweetData === "function"
    ? domCollectorApi.extractTweetData
    : () => ({ id: null, author: null, text: null, url: null, replies: null, reposts: null, likes: null, reply_to: null, quote_of: null, repost_of: null });
  const collectConversationBundle = typeof domCollectorApi.collectConversationBundle === "function"
    ? domCollectorApi.collectConversationBundle
    : () => ({ tweetElements: [], tweets: [] });
  const collectConversationTweets = typeof domCollectorApi.collectConversationTweets === "function"
    ? domCollectorApi.collectConversationTweets
    : () => [];
  const findClosestTweetContainer = typeof domCollectorApi.findClosestTweetContainer === "function"
    ? domCollectorApi.findClosestTweetContainer
    : () => null;
  const getTweetCandidates = typeof domCollectorApi.getTweetCandidates === "function"
    ? domCollectorApi.getTweetCandidates
    : () => [];
  const locateActionBar = typeof domCollectorApi.locateActionBar === "function"
    ? domCollectorApi.locateActionBar
    : () => null;
  const collectFollowedAuthorHints = typeof domCollectorApi.collectFollowedAuthorHints === "function"
    ? domCollectorApi.collectFollowedAuthorHints
    : () => new Set();
  const collectViewerHandleHints = typeof domCollectorApi.collectViewerHandleHints === "function"
    ? domCollectorApi.collectViewerHandleHints
    : () => new Set();

  const resolveConversationRoot = typeof rootResolutionApi.resolveConversationRoot === "function"
    ? rootResolutionApi.resolveConversationRoot
    : (tweetElement) => tweetElement;

  const buildConversationDataset = typeof xApiClientApi.buildConversationDataset === "function"
    ? xApiClientApi.buildConversationDataset
    : null;
  const runConversationEngine = typeof conversationEngineApi.runConversationEngine === "function"
    ? conversationEngineApi.runConversationEngine
    : () => ({ rootId: null, root: null, nodes: [], edges: [], ranking: [], rankingMeta: { scoreById: new Map() } });

  const renderConversationPanel = typeof panelRendererApi.renderConversationPanel === "function"
    ? panelRendererApi.renderConversationPanel
    : null;
  const renderTopThreads = typeof panelRendererApi.renderTopThreads === "function"
    ? panelRendererApi.renderTopThreads
    : () => {};

  const inferReplyStructure = typeof replyInferenceApi.inferReplyStructure === "function"
    ? replyInferenceApi.inferReplyStructure
    : (_elements, tweets) => tweets;
  const indexTweetsById = typeof conversationGraphApi.indexTweetsById === "function"
    ? conversationGraphApi.indexTweetsById
    : () => ({});
  const attachReplies = typeof conversationGraphApi.attachReplies === "function"
    ? conversationGraphApi.attachReplies
    : () => ({ tweets: [], index: {}, roots: [] });
  const buildTypedEdges = typeof conversationGraphApi.buildTypedEdges === "function"
    ? conversationGraphApi.buildTypedEdges
    : () => [];
  const buildConversationGraph = typeof conversationGraphApi.buildConversationGraph === "function"
    ? conversationGraphApi.buildConversationGraph
    : () => ({ rootId: null, nodes: [], edges: [], root: null, children: [] });
  const collapseAuthorThread = typeof threadCollapseApi.collapseAuthorThread === "function"
    ? threadCollapseApi.collapseAuthorThread
    : (graph) => graph;
  const rankConversationGraph = typeof conversationRankApi.rankConversationGraph === "function"
    ? conversationRankApi.rankConversationGraph
    : () => ({ scores: [], scoreById: new Map(), topTweetIds: [], iterations: 0, converged: true });

  function readLocalStorageValue(key) {
    if (!key || typeof globalScope.window === "undefined" || !globalScope.window.localStorage) {
      return null;
    }

    try {
      return globalScope.window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function normalizeExploreMode(value) {
    return EXPLORE_MODE;
  }

  function readExploreMode() {
    return EXPLORE_MODE;
  }

  function writeExploreMode(mode) {
    return EXPLORE_MODE;
  }

  function parseFollowingSet(rawValue) {
    if (!rawValue) {
      return new Set();
    }

    if (rawValue instanceof Set) {
      const normalized = new Set();
      for (const value of rawValue) {
        if (value == null) {
          continue;
        }
        const parsed = String(value).trim();
        if (parsed) {
          normalized.add(parsed);
        }
      }
      return normalized;
    }

    if (Array.isArray(rawValue)) {
      const normalized = new Set();
      for (const value of rawValue) {
        if (value == null) {
          continue;
        }
        const parsed = String(value).trim();
        if (parsed) {
          normalized.add(parsed);
        }
      }
      return normalized;
    }

    if (typeof rawValue === "string") {
      const trimmed = rawValue.trim();
      if (!trimmed) {
        return new Set();
      }

      try {
        return parseFollowingSet(JSON.parse(trimmed));
      } catch {
        const normalized = new Set();
        for (const part of trimmed.split(",")) {
          const token = part.trim();
          if (token) {
            normalized.add(token);
          }
        }
        return normalized;
      }
    }

    return new Set();
  }

  function mergeFollowingSets(...sets) {
    const merged = new Set();
    for (const input of sets) {
      const parsed = parseFollowingSet(input);
      for (const value of parsed) {
        merged.add(value);
      }
    }
    return merged;
  }

  function buildExcludedTweetIds(...ids) {
    const excluded = new Set();
    for (const id of ids) {
      if (id == null) {
        continue;
      }
      const normalized = String(id).trim();
      if (normalized) {
        excluded.add(normalized);
      }
    }
    return excluded;
  }

  function buildRelationshipByIdFromTweets({ tweets, clickedTweetId, canonicalRootId, rootId }) {
    const map = new Map();
    const safeTweets = Array.isArray(tweets) ? tweets : [];
    const clicked = clickedTweetId ? String(clickedTweetId) : "";
    const canonicalRoot = canonicalRootId ? String(canonicalRootId) : "";
    const resolvedRoot = rootId ? String(rootId) : "";

    for (const tweet of safeTweets) {
      if (!tweet?.id) {
        continue;
      }

      const id = String(tweet.id);
      const replyTo = tweet.reply_to ? String(tweet.reply_to) : "";
      const quoteOf = tweet.quote_of ? String(tweet.quote_of) : "";

      if (quoteOf) {
        map.set(id, "quote");
        continue;
      }

      if (replyTo && (replyTo === clicked || replyTo === canonicalRoot || replyTo === resolvedRoot)) {
        map.set(id, "reply");
        continue;
      }

      map.set(id, "cousin");
    }

    return map;
  }

  function buildRelationshipByIdFromGraph({ nodes, edges, clickedTweetId, canonicalRootId, rootId }) {
    const map = new Map();
    const safeNodes = Array.isArray(nodes) ? nodes : [];
    const safeEdges = Array.isArray(edges) ? edges : [];
    const clicked = clickedTweetId ? String(clickedTweetId) : "";
    const canonicalRoot = canonicalRootId ? String(canonicalRootId) : "";
    const resolvedRoot = rootId ? String(rootId) : "";

    const replyChildrenByParent = new Map();
    const quoteParentByChild = new Map();

    for (const edge of safeEdges) {
      if (!edge?.source || !edge?.target) {
        continue;
      }
      const source = String(edge.source);
      const target = String(edge.target);
      const type = String(edge.type || "").toLowerCase();

      if (type === "reply") {
        if (!replyChildrenByParent.has(target)) {
          replyChildrenByParent.set(target, []);
        }
        replyChildrenByParent.get(target).push(source);
      } else if (type === "quote") {
        quoteParentByChild.set(source, target);
      }
    }

    const replyBranchFromClicked = new Set();
    if (clicked) {
      const queue = [clicked];
      let head = 0;
      while (head < queue.length) {
        const current = queue[head];
        head += 1;
        const children = replyChildrenByParent.get(current) || [];
        for (const child of children) {
          if (replyBranchFromClicked.has(child)) {
            continue;
          }
          replyBranchFromClicked.add(child);
          queue.push(child);
        }
      }
    }

    for (const tweet of safeNodes) {
      if (!tweet?.id) {
        continue;
      }
      const id = String(tweet.id);

      const quoteParent = quoteParentByChild.get(id) || (tweet.quote_of ? String(tweet.quote_of) : "");
      if (quoteParent) {
        map.set(id, "quote");
        continue;
      }

      const replyParent = tweet.reply_to ? String(tweet.reply_to) : "";
      if (
        replyBranchFromClicked.has(id)
        || (replyParent && (replyParent === clicked || replyParent === canonicalRoot || replyParent === resolvedRoot))
      ) {
        map.set(id, "reply");
        continue;
      }

      map.set(id, "cousin");
    }

    return map;
  }

  function readXApiRuntimeConfig() {
    const isTestRuntime = typeof module !== "undefined" && module.exports;
    const settings = typeof globalScope.window !== "undefined" && globalScope.window.AriadexXApiSettings && typeof globalScope.window.AriadexXApiSettings === "object"
      ? globalScope.window.AriadexXApiSettings
      : {};

    const tokenCandidates = [
      { source: "settings.bearerToken", value: settings.bearerToken },
      { source: "window.AriadexXApiBearerToken", value: typeof globalScope.window !== "undefined" ? globalScope.window.AriadexXApiBearerToken : null },
      { source: "localStorage.ariadex.x_api_bearer_token", value: readLocalStorageValue("ariadex.x_api_bearer_token") },
      { source: "localStorage.ariadex.xApiBearerToken", value: readLocalStorageValue("ariadex.xApiBearerToken") }
    ];

    const selectedToken = tokenCandidates.find((candidate) => typeof candidate.value === "string" && candidate.value.trim().length > 0) || null;
    const bearerToken = selectedToken ? selectedToken.value : null;
    const tokenSource = selectedToken ? selectedToken.source : null;
    const apiBaseUrl = typeof settings.apiBaseUrl === "string" && settings.apiBaseUrl.trim().length > 0
      ? settings.apiBaseUrl.trim()
      : null;
    const runtimeEnv = typeof settings.environment === "string" && settings.environment.trim().length > 0
      ? settings.environment.trim().toLowerCase()
      : (readLocalStorageValue("ariadex.runtime_env") || "").trim().toLowerCase() || "dev";
    const graphApiByEnv = settings.graphApiByEnv && typeof settings.graphApiByEnv === "object"
      ? settings.graphApiByEnv
      : (() => {
        const raw = readLocalStorageValue("ariadex.graph_api_by_env");
        if (!raw) {
          return null;
        }
        try {
          const parsed = JSON.parse(raw);
          return parsed && typeof parsed === "object" ? parsed : null;
        } catch {
          return null;
        }
      })();
    const graphApiFromEnvMap = graphApiByEnv && typeof graphApiByEnv[runtimeEnv] === "string"
      ? graphApiByEnv[runtimeEnv].trim()
      : "";
    const graphApiFromLocalStorage = (readLocalStorageValue("ariadex.graph_api_url") || "").trim();
    const graphApiUrl = typeof settings.graphApiUrl === "string" && settings.graphApiUrl.trim().length > 0
      ? settings.graphApiUrl.trim()
      : (graphApiFromEnvMap || graphApiFromLocalStorage || null);

    const followingSource = settings.followingSet
      || settings.followingIds
      || (typeof globalScope.window !== "undefined" ? globalScope.window.AriadexFollowingSet : null)
      || readLocalStorageValue("ariadex.following_ids")
      || readLocalStorageValue("ariadex.x_api_following_ids");
    const allowClientDirectApi = typeof settings.allowClientDirectApi === "boolean"
      ? settings.allowClientDirectApi
      : ((readLocalStorageValue("ariadex.allow_client_direct_api") || "").trim().toLowerCase() === "true");

    return {
      bearerToken: bearerToken ? bearerToken.trim() : null,
      tokenSource,
      apiBaseUrl,
      graphApiUrl,
      runtimeEnv,
      graphApiByEnv,
      allowClientDirectApi: isTestRuntime ? true : allowClientDirectApi,
      followingSet: parseFollowingSet(followingSource),
      tokenDiagnostics: tokenCandidates.map((candidate) => ({
        source: candidate.source,
        present: typeof candidate.value === "string" && candidate.value.trim().length > 0
      }))
    };
  }

  async function hydrateRuntimeConfigFromGeneratedConfig(runtimeConfig) {
    // Do not fetch extension resources during click handling.
    // This avoids noisy chrome-extension://invalid fetch failures in stale contexts.
    return runtimeConfig;
  }

  function normalizeApiBaseUrl(url) {
    if (!url || typeof url !== "string") {
      return null;
    }

    const trimmed = url.trim();
    if (!trimmed) {
      return null;
    }

    return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
  }

  function resolveScoreByIdFromSnapshot(snapshot) {
    const meta = snapshot?.rankingMeta && typeof snapshot.rankingMeta === "object"
      ? snapshot.rankingMeta
      : {};

    if (meta.scoreById instanceof Map) {
      return meta.scoreById;
    }

    if (meta.scoreByIdObject && typeof meta.scoreByIdObject === "object") {
      const keys = Object.keys(meta.scoreByIdObject);
      if (keys.length > 0) {
        return meta.scoreByIdObject;
      }
    }

    if (meta.scoreById && typeof meta.scoreById === "object") {
      const keys = Object.keys(meta.scoreById);
      if (keys.length > 0) {
        return meta.scoreById;
      }
    }

    const fromRanking = {};
    const ranking = Array.isArray(snapshot?.ranking) ? snapshot.ranking : [];
    for (const entry of ranking) {
      const id = entry?.id;
      const score = Number(entry?.score);
      if (!id || !Number.isFinite(score)) {
        continue;
      }
      fromRanking[id] = score;
    }

    return fromRanking;
  }

  function canUseExtensionMessageBridge() {
    return Boolean(
      typeof chrome !== "undefined"
      && chrome.runtime
      && chrome.runtime.id
      && chrome.runtime.id !== "invalid"
      && typeof chrome.runtime.sendMessage === "function"
    );
  }

  function sendGraphApiRequestViaExtension(request) {
    if (!canUseExtensionMessageBridge()) {
      return Promise.resolve(null);
    }

    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(request, (response) => {
          const runtimeError = chrome.runtime?.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message || "extension_message_failed"));
            return;
          }
          resolve(response || null);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async function sendGraphApiJsonRequest({ url, method = "GET", body = null }) {
    const bridgeResponse = await sendGraphApiRequestViaExtension({
      type: "ariadex_graph_api_request",
      url,
      method,
      headers: {
        "content-type": "application/json"
      },
      body: body == null ? undefined : JSON.stringify(body)
    });

    if (bridgeResponse) {
      if (!bridgeResponse.ok) {
        const reason = bridgeResponse.error
          ? String(bridgeResponse.error)
          : `${bridgeResponse.status || 500} ${bridgeResponse.statusText || "Graph API request failed"}`;
        throw new Error(`Graph API request failed (${reason})`);
      }
      return bridgeResponse.body;
    }

    if (typeof globalScope.window === "undefined" || typeof globalScope.window.fetch !== "function") {
      return null;
    }

    const response = await globalScope.window.fetch(url, {
      method,
      headers: {
        "content-type": "application/json"
      },
      ...(body == null ? {} : { body: JSON.stringify(body) })
    });
    if (!response.ok) {
      throw new Error(`Graph API request failed (${response.status} ${response.statusText})`);
    }
    return response.json();
  }

  async function fetchSnapshotFromGraphApi(options = {}) {
    const baseUrl = normalizeApiBaseUrl(options.graphApiUrl);
    if (!baseUrl) {
      return null;
    }

    const followingSet = options?.rankOptions?.followingSet instanceof Set
      ? options.rankOptions.followingSet
      : new Set();
    const followingIds = [...followingSet];

    const requestPayload = {
      clickedTweetId: options.clickedTweetId,
      rootHintTweetId: options.rootHintTweetId || null,
      mode: options.mode || "fast",
      force: Boolean(options.forceRefresh),
      incremental: options.incremental !== false,
      followingIds,
      viewerHandles: Array.isArray(options.viewerHandles) ? options.viewerHandles : []
    };
    const payloadBody = JSON.stringify(requestPayload);
    const snapshotUrl = `${baseUrl}/v1/conversation-snapshot`;
    const jobsUrl = `${snapshotUrl}/jobs`;

    let payload = null;

    try {
      const started = await sendGraphApiJsonRequest({
        url: jobsUrl,
        method: "POST",
        body: requestPayload
      });
      const jobId = started && started.jobId ? String(started.jobId) : "";
      if (jobId) {
        const deadline = Date.now() + 120000;
        let lastMessage = "";
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 600));
          const polled = await sendGraphApiJsonRequest({
            url: `${jobsUrl}/${jobId}`,
            method: "GET"
          });
          const progress = Array.isArray(polled?.progress) ? polled.progress : [];
          const lastProgress = progress.length > 0 ? progress[progress.length - 1] : null;
          const message = lastProgress && typeof lastProgress.message === "string"
            ? lastProgress.message.trim()
            : "";
          if (message && message !== lastMessage && typeof options.onProgress === "function") {
            lastMessage = message;
            options.onProgress({
              phase: "server_progress",
              statusMessage: message
            });
          }

          if (polled?.status === "completed" && polled?.snapshot) {
            payload = polled.snapshot;
            break;
          }
          if (polled?.status === "failed") {
            throw new Error(polled?.error?.message || "Graph API async job failed");
          }
        }
      }
    } catch {}

    if (!payload) {
      payload = await sendGraphApiJsonRequest({
        url: snapshotUrl,
        method: "POST",
        body: requestPayload
      });
    }

    if (!payload || typeof payload !== "object") {
      throw new Error("Graph API returned invalid payload");
    }

    return {
      canonicalRootId: payload.canonicalRootId || null,
      rootId: payload.rootId || null,
      root: payload.root || null,
      nodes: Array.isArray(payload.nodes) ? payload.nodes : [],
      edges: Array.isArray(payload.edges) ? payload.edges : [],
      ranking: Array.isArray(payload.ranking) ? payload.ranking : [],
      rankingMeta: payload.rankingMeta || { scoreById: new Map() },
      warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
      diagnostics: payload.diagnostics && typeof payload.diagnostics === "object"
        ? payload.diagnostics
        : null
    };
  }

  async function buildConversationArticle(options = {}) {
    const baseUrl = normalizeApiBaseUrl(options.graphApiUrl);
    if (!baseUrl) {
      throw new Error("Graph API is required for article generation");
    }

    const followingSet = options?.rankOptions?.followingSet instanceof Set
      ? options.rankOptions.followingSet
      : new Set();
    const requestPayload = {
      clickedTweetId: options.clickedTweetId,
      rootHintTweetId: options.rootHintTweetId || null,
      mode: options.mode || "fast",
      force: Boolean(options.forceRefresh),
      incremental: options.incremental === true,
      followingIds: [...followingSet],
      viewerHandles: Array.isArray(options.viewerHandles) ? options.viewerHandles : []
    };

    const payload = await sendGraphApiJsonRequest({
      url: `${baseUrl}/v1/conversation-article`,
      method: "POST",
      body: requestPayload
    });
    if (!payload || typeof payload !== "object") {
      throw new Error("Graph API returned invalid article payload");
    }
    return payload;
  }

  function downloadPdfFromBase64(pdf) {
    const base64 = String(pdf?.base64 || "").trim();
    if (!base64 || !globalScope.window || !globalScope.document || typeof globalScope.window.atob !== "function") {
      return false;
    }

    const binary = globalScope.window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }

    const blob = new Blob([bytes], { type: pdf?.mimeType || "application/pdf" });
    const objectUrl = globalScope.window.URL?.createObjectURL?.(blob);
    if (!objectUrl) {
      return false;
    }

    const anchor = globalScope.document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = String(pdf?.filename || "ariadex-digest.pdf");
    anchor.style.display = "none";
    globalScope.document.body?.appendChild(anchor);
    anchor.click();
    anchor.remove();
    globalScope.window.setTimeout(() => {
      globalScope.window.URL?.revokeObjectURL?.(objectUrl);
    }, 1000);
    return true;
  }

  function formatExploreProgressMessage(progress = {}) {
    const phase = String(progress?.phase || "").trim();
    const tweetCount = Number(progress?.tweetCount || 0);
    const replies = Number(progress?.replies || 0);
    const quotes = Number(progress?.quotes || 0);
    const processedRoots = Number(progress?.processedRoots || 0);
    const queuedRoots = Number(progress?.queuedRoots || 0);
    const selectedTweetCount = Number(progress?.selectedTweetCount || 0);
    const referenceCount = Number(progress?.referenceCount || 0);
    const mandatoryPathLength = Number(progress?.mandatoryPathLength || 0);

    if (phase === "request_received") {
      return "Preparing the conversation workspace…";
    }
    if (phase === "root_resolution_started") {
      return "Resolving the clicked tweet and its context…";
    }
    if (phase === "root_resolved") {
      return "Context resolved. Building the reading path…";
    }
    if (phase === "incremental_refresh") {
      return "Refreshing cached conversation data…";
    }
    if (phase === "cache_hit") {
      return "Loaded a cached conversation map.";
    }
    if (phase === "waiting_inflight") {
      return "Another snapshot is already being built. Reusing it when ready…";
    }
    if (phase === "cache_hit_after_wait") {
      return "Loaded the shared cached conversation map.";
    }
    if (phase === "collecting") {
      return "Collecting conversation branches and evidence…";
    }
    if (phase === "collection_started") {
      return "Scanning the conversation graph…";
    }
    if (phase === "collecting_root") {
      return processedRoots > 1 || queuedRoots > 0
        ? `Tracing relevant branches. ${processedRoots} scanned, ${queuedRoots} pending.`
        : "Tracing the core conversation path…";
    }
    if (phase === "replies_fetched") {
      return replies > 0
        ? `Collected direct replies. ${replies} candidate replies found.`
        : "Collected direct replies for this branch.";
    }
    if (phase === "quotes_fetched") {
      return quotes > 0
        ? `Collected quote branches. ${quotes} quote tweets found.`
        : "Collected quote branches for this tweet.";
    }
    if (phase === "quote_reply_expanded") {
      return queuedRoots > 0
        ? `Expanding quote branches. ${queuedRoots} still worth checking.`
        : "Finished expanding quote branches.";
    }
    if (phase === "network_discovery_batch") {
      return "Checking relevant voices from your network…";
    }
    if (phase === "references_hydrated") {
      return "Linking referenced tweets and citations…";
    }
    if (phase === "authors_hydrated") {
      return "Hydrating author context…";
    }
    if (phase === "collection_complete") {
      return tweetCount > 0
        ? `Conversation collection complete. ${tweetCount} tweets available for selection.`
        : "Conversation collection complete.";
    }
    if (phase === "path_selection_started") {
      return "Building the mandatory path and selecting important branches…";
    }
    if (phase === "path_selection_complete") {
      return selectedTweetCount > 0 || mandatoryPathLength > 0
        ? `Structured the conversation. ${mandatoryPathLength} path tweets and ${selectedTweetCount} selected tweets kept.`
        : "Structured the conversation around the clicked tweet.";
    }
    if (phase === "evidence_compiled") {
      return referenceCount > 0
        ? `Compiled evidence. ${referenceCount} canonical references linked.`
        : "Compiled evidence from the selected branches.";
    }
    if (phase === "ranking_complete") {
      return selectedTweetCount > 0
        ? `Ranked the selected branches. ${selectedTweetCount} tweets are ready to read.`
        : "Ranked the selected branches.";
    }
    if (phase === "cache_populated") {
      return "Saved the conversation map to cache.";
    }
    if (phase === "completed") {
      return "Conversation ready.";
    }
    return "Building the conversation view…";
  }

  function toMilestoneProgressMessage(progress = {}) {
    const phase = String(progress?.phase || "").trim();
    const rawStatus = String(progress?.statusMessage || "").trim().toLowerCase();

    if (
      phase === "request_received"
      || phase === "root_resolution_started"
      || rawStatus.includes("preparing")
      || rawStatus.includes("resolving")
    ) {
      return "Resolving context…";
    }

    if (
      phase === "cache_hit"
      || phase === "cache_hit_after_wait"
      || rawStatus.includes("cached conversation map")
      || rawStatus.includes("shared cached")
    ) {
      return "Using cached conversation map…";
    }

    if (
      phase === "collecting"
      || phase === "collection_started"
      || phase === "collecting_root"
      || phase === "replies_fetched"
      || phase === "quotes_fetched"
      || phase === "quote_reply_expanded"
      || phase === "network_discovery_batch"
      || rawStatus.includes("collecting")
      || rawStatus.includes("scanning")
      || rawStatus.includes("tracing")
      || rawStatus.includes("expanding")
    ) {
      return "Mapping the conversation…";
    }

    if (
      phase === "path_selection_started"
      || phase === "path_selection_complete"
      || rawStatus.includes("mandatory path")
      || rawStatus.includes("structured the conversation")
      || rawStatus.includes("important branches")
    ) {
      return "Selecting the important path and branches…";
    }

    if (
      phase === "references_hydrated"
      || phase === "authors_hydrated"
      || phase === "evidence_compiled"
      || rawStatus.includes("evidence")
      || rawStatus.includes("citations")
      || rawStatus.includes("author context")
    ) {
      return "Linking evidence and context…";
    }

    if (
      phase === "ranking_complete"
      || rawStatus.includes("ranked")
      || rawStatus.includes("ready to read")
    ) {
      return "Ranking what matters…";
    }

    if (
      phase === "cache_populated"
      || phase === "completed"
      || rawStatus.includes("conversation ready")
      || rawStatus.includes("saved the conversation map")
    ) {
      return "Conversation ready.";
    }

    return "Exploring conversation…";
  }

  async function buildConversationSnapshot(options = {}) {
    if (options.graphApiUrl) {
      try {
        const remoteSnapshot = await fetchSnapshotFromGraphApi(options);
        if (remoteSnapshot) {
          return remoteSnapshot;
        }
      } catch {
        if (!options.allowClientDirectApi) {
          throw new Error("Graph API request failed and direct client API mode is disabled");
        }
        // Fall through to direct X API collection only when explicitly enabled.
      }
    }

    if (!options.allowClientDirectApi) {
      throw new Error("Graph API is required; direct client API mode is disabled");
    }

    if (typeof buildConversationDataset !== "function") {
      throw new Error("X API data client is not available");
    }

    const dataset = await buildConversationDataset(options);
    if (typeof options.onProgress === "function") {
      options.onProgress({
        phase: "data_retrieved",
        dataset
      });
    }
    if (!dataset?.canonicalRootId) {
      return {
        canonicalRootId: null,
        rootId: null,
        root: null,
        nodes: [],
        edges: [],
        ranking: [],
        rankingMeta: { scoreById: new Map() },
        warnings: Array.isArray(dataset?.warnings) ? dataset.warnings : []
      };
    }

    const engineResult = runConversationEngine({
      tweets: dataset.tweets || [],
      rankOptions: options.rankOptions || {}
    });
    if (typeof options.onProgress === "function") {
      options.onProgress({
        phase: "ranking_complete",
        dataset,
        engineResult
      });
    }

    return {
      canonicalRootId: dataset.canonicalRootId,
      rootId: engineResult.rootId,
      root: engineResult.root || dataset.rootTweet || null,
      nodes: engineResult.nodes || [],
      edges: engineResult.edges || [],
      ranking: engineResult.ranking || [],
      rankingMeta: engineResult.rankingMeta || { scoreById: new Map() },
      warnings: Array.isArray(dataset.warnings) ? dataset.warnings : [],
      diagnostics: {
        filter: {
          inputTweetCount: Array.isArray(dataset.tweets) ? dataset.tweets.length : 0
        }
      }
    };
  }

  function createExploreButton(tweetElement = null) {
    const button = globalScope.document.createElement("button");
    button.type = "button";
    button.className = BUTTON_CLASS;
    button.setAttribute(BUTTON_ATTR, "true");
    button.setAttribute("aria-label", "Explore conversation");
    button.textContent = "◇ Explore";

    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const mappedTweet = buttonTweetElementByButton.get(event.currentTarget) || null;
      const clickedTweet = mappedTweet || findClosestTweetContainer(event.currentTarget);
      const clickedTweetData = extractTweetData(clickedTweet);
      const rootTweetElement = resolveConversationRoot(clickedTweet) || clickedTweet;
      const rootTweetData = extractTweetData(rootTweetElement);
      const buttonTweetId = String(event.currentTarget?.getAttribute?.(BUTTON_TWEET_ID_ATTR) || "").trim();

      const clickedTweetId = buttonTweetId || clickedTweetData.id || rootTweetData.id;
      if (!clickedTweetId) {
        console.error("[Ariadex] Unable to resolve clicked tweet id");
        return;
      }

      const debugEnabled = typeof globalScope.window !== "undefined"
        && Boolean(globalScope.window.AriadexDebug);
      if (debugEnabled) {
        console.debug("[Ariadex] Explore click ids", {
          buttonTweetId,
          clickedTweetId,
          clickedTweetDataId: clickedTweetData.id || null,
          rootHintTweetId: rootTweetData.id || null
        });
      }

      if (renderConversationPanel) {
        const exploreMode = readExploreMode();
        const seedNodes = [];
        const seedScoreById = new Map();
        const initialExcludedIds = buildExcludedTweetIds(
          clickedTweetId,
          rootTweetData?.id,
          clickedTweetData?.quote_of
        );
        renderConversationPanel({
          nodes: seedNodes,
          scoreById: seedScoreById,
          relationshipById: new Map(),
          followingSet: new Set(),
          excludedTweetIds: initialExcludedIds,
          humanOnly: true,
          networkLimit: 0,
          topLimit: 0,
          loadingOnly: true,
          statusMessage: "Exploring conversation…",
          exploreMode,
          root: globalScope.document
        });
      }

      let runtimeConfig = readXApiRuntimeConfig();
      const domFollowingHints = collectFollowedAuthorHints(globalScope.document);
      const viewerHandleHints = collectViewerHandleHints(globalScope.document);
      runtimeConfig = {
        ...runtimeConfig,
        followingSet: mergeFollowingSets(runtimeConfig.followingSet, domFollowingHints)
      };
      const exploreMode = readExploreMode();
      if (!runtimeConfig.bearerToken && runtimeConfig.allowClientDirectApi) {
        runtimeConfig = await hydrateRuntimeConfigFromGeneratedConfig(runtimeConfig);
        runtimeConfig = {
          ...runtimeConfig,
          followingSet: mergeFollowingSets(runtimeConfig.followingSet, domFollowingHints)
        };
      }

      const hasGraphApiUrl = Boolean(runtimeConfig.graphApiUrl);
      if (!hasGraphApiUrl && !(runtimeConfig.allowClientDirectApi && runtimeConfig.bearerToken)) {
        if (renderConversationPanel) {
          renderConversationPanel({
            nodes: [],
            scoreById: new Map(),
            relationshipById: new Map(),
            followingSet: runtimeConfig.followingSet,
            excludedTweetIds: new Set(),
            humanOnly: true,
            networkLimit: 5,
            topLimit: 10,
            statusMessage: "Graph API endpoint is missing. Configure graphApiUrl to explore conversations.",
            exploreMode,
            root: globalScope.document
          });
        }
        return;
      }

      button.disabled = true;
      button.setAttribute("aria-busy", "true");

      try {
        let lastMilestoneMessage = "Exploring conversation…";
        const snapshot = await buildConversationSnapshot({
          clickedTweetId,
          rootHintTweetId: rootTweetData.id || null,
          bearerToken: runtimeConfig.bearerToken,
          apiBaseUrl: runtimeConfig.apiBaseUrl || undefined,
          graphApiUrl: runtimeConfig.graphApiUrl || undefined,
          allowClientDirectApi: runtimeConfig.allowClientDirectApi,
          mode: exploreMode,
          includeQuoteTweets: exploreMode === "deep",
          includeQuoteReplies: exploreMode === "deep",
          includeRetweets: false,
          viewerHandles: [...viewerHandleHints],
          rankOptions: {
            followingSet: runtimeConfig.followingSet
          },
          fetchImpl: typeof globalScope.window !== "undefined" && typeof globalScope.window.fetch === "function"
            ? globalScope.window.fetch.bind(globalScope.window)
            : undefined,
          onProgress: (progress) => {
            if (!renderConversationPanel) {
              return;
            }
            const milestoneMessage = toMilestoneProgressMessage(progress);
            if (milestoneMessage === lastMilestoneMessage && progress?.phase !== "data_retrieved") {
              return;
            }
            lastMilestoneMessage = milestoneMessage;

            const phase = progress?.phase;
            if (phase === "server_progress") {
              const interimExcludedIds = buildExcludedTweetIds(
                clickedTweetId,
                rootTweetData?.id,
                clickedTweetData?.quote_of
              );
              renderConversationPanel({
                nodes: [],
                scoreById: new Map(),
                relationshipById: new Map(),
                followingSet: runtimeConfig.followingSet,
                excludedTweetIds: interimExcludedIds,
              humanOnly: true,
              networkLimit: 0,
              topLimit: 0,
              loadingOnly: true,
              statusMessage: milestoneMessage,
              exploreMode,
              root: globalScope.document
            });
              return;
            }

            if (phase && phase !== "data_retrieved") {
              const interimExcludedIds = buildExcludedTweetIds(
                clickedTweetId,
                rootTweetData?.id,
                clickedTweetData?.quote_of,
                progress?.canonicalRootId
              );
              renderConversationPanel({
                nodes: [],
                scoreById: new Map(),
                relationshipById: new Map(),
                followingSet: runtimeConfig.followingSet,
                excludedTweetIds: interimExcludedIds,
                humanOnly: true,
                networkLimit: 0,
                topLimit: 0,
                loadingOnly: true,
                statusMessage: milestoneMessage,
                exploreMode,
                root: globalScope.document
              });
              return;
            }

            if (phase === "data_retrieved") {
              const tweets = Array.isArray(progress?.dataset?.tweets) ? progress.dataset.tweets : [];
              const limitedTweets = tweets.slice(0, 25);
              const provisionalScores = new Map(limitedTweets.map((tweet, index) => [tweet.id, limitedTweets.length - index]));
              const relationshipById = buildRelationshipByIdFromTweets({
                tweets: limitedTweets,
                clickedTweetId,
                canonicalRootId: progress?.dataset?.canonicalRootId,
                rootId: progress?.dataset?.canonicalRootId
              });
              const excludedTweetIds = buildExcludedTweetIds(
                clickedTweetId,
                rootTweetData?.id,
                clickedTweetData?.quote_of,
                progress?.dataset?.canonicalRootId
              );
              renderConversationPanel({
                nodes: limitedTweets,
                scoreById: provisionalScores,
                relationshipById,
                followingSet: runtimeConfig.followingSet,
                excludedTweetIds,
                humanOnly: true,
                networkLimit: 5,
                topLimit: 10,
                statusMessage: `Fetched ${tweets.length} tweets. Running ThinkerRank…`,
                exploreMode,
                root: globalScope.document
              });
            }
          }
        });

        const ranking = {
          scores: Array.isArray(snapshot.ranking) ? snapshot.ranking : []
        };
        const scoreById = resolveScoreByIdFromSnapshot(snapshot);
        const relationshipById = buildRelationshipByIdFromGraph({
          nodes: snapshot.nodes || [],
          edges: snapshot.edges || [],
          clickedTweetId,
          canonicalRootId: snapshot?.canonicalRootId,
          rootId: snapshot?.rootId || snapshot?.root?.id || null
        });
        let articleResult = null;
        let articleLoading = false;
        const excludedTweetIds = buildExcludedTweetIds(
          clickedTweetId,
          rootTweetData?.id,
          clickedTweetData?.quote_of,
          snapshot?.canonicalRootId,
          snapshot?.rootId,
          snapshot?.root?.id
        );
        const doneStatusMessage = (() => {
          const traversedCount = Number(snapshot?.diagnostics?.filter?.inputTweetCount);
          const safeTraversed = Number.isFinite(traversedCount)
            ? traversedCount
            : (Array.isArray(snapshot.ranking) ? snapshot.ranking.length : 0);
          const rankedCount = Array.isArray(snapshot.nodes) ? snapshot.nodes.length : 0;
          return `Done. Traversed ${safeTraversed} tweets. Ranked ${rankedCount} nodes.`;
        })();

        const rerenderPanel = () => {
          if (!renderConversationPanel) {
            return renderTopThreads((ranking.scores || []).slice(0, 5), globalScope.document);
          }
          return renderConversationPanel({
            nodes: snapshot.nodes || [],
            scoreById,
            relationshipById,
            followingSet: runtimeConfig.followingSet,
            excludedTweetIds,
            humanOnly: true,
            networkLimit: 5,
            topLimit: 10,
            statusMessage: doneStatusMessage,
            article: articleResult?.article || null,
            articleLoading,
            onGenerateArticle: async () => {
              if (articleLoading) {
                return;
              }
              articleLoading = true;
              rerenderPanel();
              try {
                articleResult = await buildConversationArticle({
                  clickedTweetId,
                  rootHintTweetId: rootTweetData.id || null,
                  graphApiUrl: runtimeConfig.graphApiUrl || undefined,
                  mode: exploreMode,
                  viewerHandles: [...viewerHandleHints],
                  rankOptions: {
                    followingSet: runtimeConfig.followingSet
                  }
                });
              } catch (articleError) {
                console.error("[Ariadex] Failed to build article", articleError);
              } finally {
                articleLoading = false;
                rerenderPanel();
              }
            },
            onDownloadPdf: () => {
              if (articleResult?.pdf) {
                downloadPdfFromBase64(articleResult.pdf);
              }
            },
            snapshotMeta: {
              clickedTweetId,
              canonicalRootId: snapshot?.canonicalRootId || null,
              diagnostics: snapshot?.diagnostics || null,
              pathAnchored: snapshot?.pathAnchored || null,
              cache: snapshot?.cache || null,
              warnings: snapshot?.warnings || []
            },
            exploreMode,
            root: globalScope.document
          });
        };

        const panelSections = rerenderPanel();

        const debugEnabled = typeof globalScope.window !== "undefined"
          && Boolean(globalScope.window.AriadexDebug);
        const isTestRuntime = typeof module !== "undefined" && module.exports;
        if (debugEnabled || isTestRuntime) {
          console.log({
            rootTweet: snapshot.root || rootTweetData,
            graph: {
              rootId: snapshot.rootId,
              nodes: snapshot.nodes || [],
              edges: snapshot.edges || []
            },
            ranking,
            panelSections,
            canonicalRootId: snapshot.canonicalRootId,
            warnings: snapshot.warnings || [],
            viewerHandleHints: [...viewerHandleHints],
            followingCount: runtimeConfig.followingSet.size
          });
        }
      } catch (error) {
        console.error("[Ariadex] Failed to build conversation via layered engine", error);
        if (renderConversationPanel) {
          renderConversationPanel({
            nodes: [],
            scoreById: new Map(),
            relationshipById: new Map(),
            followingSet: runtimeConfig.followingSet,
            excludedTweetIds: new Set(),
            humanOnly: true,
            networkLimit: 5,
            topLimit: 10,
            statusMessage: "Request failed or rate-limited. Showing no data.",
            exploreMode,
            root: globalScope.document
          });
        }
      } finally {
        button.disabled = false;
        button.removeAttribute("aria-busy");
      }
    });

    return button;
  }

  function injectExploreButton(tweet) {
    if (!tweet || typeof tweet.querySelector !== "function") {
      return false;
    }

    const actionBar = locateActionBar(tweet);
    if (!actionBar) {
      return false;
    }

    if (actionBar.querySelector(`.${BUTTON_CLASS}`) || actionBar.querySelector(`[${BUTTON_ATTR}]`)) {
      return false;
    }

    const button = createExploreButton(tweet);
    const tweetData = extractTweetData(tweet);
    if (tweetData?.id) {
      button.setAttribute(BUTTON_TWEET_ID_ATTR, String(tweetData.id));
    }
    buttonTweetElementByButton.set(button, tweet);
    actionBar.appendChild(button);
    actionBar.setAttribute(INJECTED_ATTR, "true");
    return true;
  }

  function processRoot(root = globalScope.document) {
    const tweets = getTweetCandidates(root);
    for (const tweet of tweets) {
      injectExploreButton(tweet);
    }
  }

  function createObserver() {
    const pendingRoots = new Set();
    let scheduled = false;

    const flush = () => {
      scheduled = false;
      const roots = [...pendingRoots];
      pendingRoots.clear();

      for (const root of roots) {
        processRoot(root);
      }
    };

    const scheduleFlush = () => {
      if (scheduled) {
        return;
      }
      scheduled = true;

      const raf = typeof globalScope.requestAnimationFrame === "function"
        ? globalScope.requestAnimationFrame
        : (cb) => setTimeout(cb, 16);

      raf(flush);
    };

    return new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== "childList" || mutation.addedNodes.length === 0) {
          continue;
        }

        for (const node of mutation.addedNodes) {
          if (node && typeof node.closest === "function") {
            pendingRoots.add(node);
          }
        }
      }

      scheduleFlush();
    });
  }

  function init() {
    if (!globalScope.document || !globalScope.document.documentElement) {
      return;
    }

    if (globalScope.document.documentElement.hasAttribute(EXTENSION_ROOT_ATTR)) {
      return;
    }

    globalScope.document.documentElement.setAttribute(EXTENSION_ROOT_ATTR, "true");

    processRoot(globalScope.document);

    const observer = createObserver();
    if (globalScope.document.body) {
      observer.observe(globalScope.document.body, {
        childList: true,
        subtree: true
      });
    }
  }

  const api = {
    TWEET_SELECTORS: domCollectorApi.TWEET_SELECTORS || [],
    ACTION_HINTS: domCollectorApi.ACTION_HINTS || [],
    extractTweetData,
    resolveConversationRoot,
    inferReplyStructure,
    collectConversationBundle,
    collectConversationTweets,
    indexTweetsById,
    attachReplies,
    buildTypedEdges,
    buildConversationGraph,
    collapseAuthorThread,
    rankConversationGraph,
    buildConversationSnapshot,
    buildConversationArticle,
    resolveScoreByIdFromSnapshot,
    parseFollowingSet,
    mergeFollowingSets,
    buildExcludedTweetIds,
    buildRelationshipByIdFromTweets,
    buildRelationshipByIdFromGraph,
    readXApiRuntimeConfig,
    findClosestTweetContainer,
    getTweetCandidates,
    locateActionBar,
    injectExploreButton,
    processRoot,
    createObserver,
    init
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (!(typeof module !== "undefined" && module.exports)) {
    if (globalScope.document.readyState === "loading") {
      globalScope.document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
      init();
    }
  }
})();
