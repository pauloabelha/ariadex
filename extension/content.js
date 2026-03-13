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
  const INJECTED_ATTR = "data-ariadex-injected";
  const EXPLORE_MODE_STORAGE_KEY = "ariadex.explore_mode";

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
    return String(value || "").toLowerCase() === "deep" ? "deep" : "fast";
  }

  function readExploreMode() {
    const fromSettings = typeof globalScope.window !== "undefined"
      ? globalScope.window.AriadexExploreMode
      : null;
    const fromStorage = readLocalStorageValue(EXPLORE_MODE_STORAGE_KEY);
    return normalizeExploreMode(fromSettings || fromStorage || "fast");
  }

  function writeExploreMode(mode) {
    const normalized = normalizeExploreMode(mode);
    if (typeof globalScope.window !== "undefined") {
      globalScope.window.AriadexExploreMode = normalized;
      try {
        globalScope.window.localStorage.setItem(EXPLORE_MODE_STORAGE_KEY, normalized);
      } catch {}
    }
    return normalized;
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

  function readXApiRuntimeConfig() {
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

    const followingSource = settings.followingSet
      || settings.followingIds
      || (typeof globalScope.window !== "undefined" ? globalScope.window.AriadexFollowingSet : null)
      || readLocalStorageValue("ariadex.following_ids")
      || readLocalStorageValue("ariadex.x_api_following_ids");

    return {
      bearerToken: bearerToken ? bearerToken.trim() : null,
      tokenSource,
      apiBaseUrl,
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

  async function buildConversationSnapshot(options = {}) {
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
      warnings: Array.isArray(dataset.warnings) ? dataset.warnings : []
    };
  }

  function createExploreButton() {
    const button = globalScope.document.createElement("button");
    button.type = "button";
    button.className = BUTTON_CLASS;
    button.setAttribute(BUTTON_ATTR, "true");
    button.setAttribute("aria-label", "Explore conversation");
    button.textContent = "◇ Explore";

    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const clickedTweet = findClosestTweetContainer(event.currentTarget);
      const clickedTweetData = extractTweetData(clickedTweet);
      const rootTweetElement = resolveConversationRoot(clickedTweet) || clickedTweet;
      const rootTweetData = extractTweetData(rootTweetElement);

      const clickedTweetId = clickedTweetData.id || rootTweetData.id;
      if (!clickedTweetId) {
        console.error("[Ariadex] Unable to resolve clicked tweet id");
        return;
      }

      if (renderConversationPanel) {
        const exploreMode = readExploreMode();
        const seedTweet = clickedTweetData?.id
          ? clickedTweetData
          : (rootTweetData?.id ? rootTweetData : null);
        const seedNodes = seedTweet ? [seedTweet] : [];
        const seedScoreById = new Map(seedNodes.map((tweet) => [tweet.id, 1]));
        renderConversationPanel({
          nodes: seedNodes,
          scoreById: seedScoreById,
          followingSet: new Set(),
          excludedTweetIds: new Set(),
          networkLimit: 0,
          topLimit: 3,
          statusMessage: "Exploring conversation…",
          exploreMode,
          onExploreModeChange: (nextMode) => {
            const savedMode = writeExploreMode(nextMode);
            renderConversationPanel({
              nodes: seedNodes,
              scoreById: seedScoreById,
              followingSet: new Set(),
              excludedTweetIds: new Set(),
              networkLimit: 0,
              topLimit: 3,
              statusMessage: `Mode set to ${savedMode === "deep" ? "Deep" : "Fast"}. Click ◇ Explore again to refresh.`,
              exploreMode: savedMode,
              onExploreModeChange: null,
              root: globalScope.document
            });
          },
          root: globalScope.document
        });
      }

      let runtimeConfig = readXApiRuntimeConfig();
      const exploreMode = readExploreMode();
      if (!runtimeConfig.bearerToken) {
        runtimeConfig = await hydrateRuntimeConfigFromGeneratedConfig(runtimeConfig);
      }

      if (!runtimeConfig.bearerToken) {
        if (renderConversationPanel) {
          renderConversationPanel({
            nodes: [],
            scoreById: new Map(),
            followingSet: runtimeConfig.followingSet,
            excludedTweetIds: new Set(),
            networkLimit: 5,
            topLimit: 10,
            statusMessage: "Missing X API token. Configure token to fetch conversation data.",
            exploreMode,
            root: globalScope.document
          });
        }
        return;
      }

      button.disabled = true;
      button.setAttribute("aria-busy", "true");

      try {
        const snapshot = await buildConversationSnapshot({
          clickedTweetId,
          rootHintTweetId: rootTweetData.id || null,
          bearerToken: runtimeConfig.bearerToken,
          apiBaseUrl: runtimeConfig.apiBaseUrl || undefined,
          includeQuoteTweets: exploreMode === "deep",
          includeQuoteReplies: exploreMode === "deep",
          includeRetweets: false,
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

            if (progress?.phase === "data_retrieved") {
              const tweets = Array.isArray(progress?.dataset?.tweets) ? progress.dataset.tweets : [];
              const limitedTweets = tweets.slice(0, 25);
              const provisionalScores = new Map(limitedTweets.map((tweet, index) => [tweet.id, limitedTweets.length - index]));
              const excludedTweetIds = new Set([
                progress?.dataset?.canonicalRootId
              ].filter(Boolean));
              renderConversationPanel({
                nodes: limitedTweets,
                scoreById: provisionalScores,
                followingSet: runtimeConfig.followingSet,
                excludedTweetIds,
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
        const scoreById = snapshot?.rankingMeta?.scoreById || new Map();

        const panelSections = renderConversationPanel
          ? (() => {
            const excludedTweetIds = new Set([
              snapshot?.canonicalRootId
            ].filter(Boolean));
            return renderConversationPanel({
              nodes: snapshot.nodes || [],
              scoreById,
              followingSet: runtimeConfig.followingSet,
              excludedTweetIds,
              networkLimit: 5,
              topLimit: 10,
              statusMessage: `Done. Ranked ${Array.isArray(snapshot.nodes) ? snapshot.nodes.length : 0} nodes.`,
              exploreMode,
              onExploreModeChange: (nextMode) => {
                const savedMode = writeExploreMode(nextMode);
                renderConversationPanel({
                  nodes: snapshot.nodes || [],
                  scoreById,
                  followingSet: runtimeConfig.followingSet,
                  excludedTweetIds,
                  networkLimit: 5,
                  topLimit: 10,
                  statusMessage: `Mode set to ${savedMode === "deep" ? "Deep" : "Fast"}. Click ◇ Explore again to refresh.`,
                  exploreMode: savedMode,
                  onExploreModeChange: null,
                  root: globalScope.document
                });
              },
              root: globalScope.document
            });
          })()
          : renderTopThreads((ranking.scores || []).slice(0, 5), globalScope.document);

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
            warnings: snapshot.warnings || []
          });
        }
      } catch (error) {
        console.error("[Ariadex] Failed to build conversation via layered engine", error);
        if (renderConversationPanel) {
          renderConversationPanel({
            nodes: [],
            scoreById: new Map(),
            followingSet: runtimeConfig.followingSet,
            excludedTweetIds: new Set(),
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

    const button = createExploreButton();
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
    parseFollowingSet,
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
