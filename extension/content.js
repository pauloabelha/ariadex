(() => {
  "use strict";

  const replyInferenceApi = typeof module !== "undefined" && module.exports
    ? require("./reply_inference.js")
    : (window.AriadexReplyInference || {});
  const conversationRankApi = typeof module !== "undefined" && module.exports
    ? require("./conversation_rank.js")
    : (window.AriadexConversationRank || {});
  const rootResolutionApi = typeof module !== "undefined" && module.exports
    ? require("./root_resolution.js")
    : (window.AriadexRootResolution || {});
  const inferReplyStructure = typeof replyInferenceApi.inferReplyStructure === "function"
    ? replyInferenceApi.inferReplyStructure
    : (_tweetElements, tweetData) => tweetData;
  const rankConversationGraph = typeof conversationRankApi.rankConversationGraph === "function"
    ? conversationRankApi.rankConversationGraph
    : () => ({ scores: [], scoreById: {}, topTweetIds: [], iterations: 0, converged: true });
  const resolveConversationRoot = typeof rootResolutionApi.resolveConversationRoot === "function"
    ? rootResolutionApi.resolveConversationRoot
    : (tweetElement) => tweetElement;

  const EXTENSION_ROOT_ATTR = "data-ariadex-initialized";
  const BUTTON_CLASS = "ariadex-explore-button";
  const BUTTON_ATTR = "data-ariadex-explore-button";
  const INJECTED_ATTR = "data-ariadex-injected";

  const TWEET_SELECTORS = [
    'article[data-testid="tweet"]',
    'div[data-testid="tweet"]',
    "article[role='article']",
    "article"
  ];
  const TWEET_SELECTOR_QUERY = TWEET_SELECTORS.join(", ");

  const TWEET_TEXT_SELECTORS = ['[data-testid="tweetText"]', "div[lang]"];
  const AUTHOR_SELECTORS = [
    '[data-testid="User-Name"] a[href^="/"]',
    "a[href^='/'][role='link']"
  ];
  const TWEET_URL_SELECTORS = [
    "a[href*='/status/']",
    "time"
  ];
  const REPLY_TO_ATTRS = [
    "data-reply-to",
    "data-parent-tweet-id",
    "data-conversation-parent-id",
    "data-ariadex-reply-to"
  ];
  const QUOTE_TO_ATTRS = [
    "data-quoted-tweet-id",
    "data-quote-tweet-id",
    "data-ariadex-quote-of"
  ];
  const REPOST_TO_ATTRS = [
    "data-repost-of",
    "data-retweet-of",
    "data-ariadex-repost-of"
  ];

  const ACTION_HINTS = ["reply", "repost", "retweet", "like", "bookmark", "share", "view"];

  function isElement(node) {
    return typeof Element !== "undefined" && node instanceof Element;
  }

  function uniqueElements(elements) {
    return [...new Set(elements.filter(isElement))];
  }

  function safeText(value) {
    if (typeof value !== "string") {
      return "";
    }
    return value.replace(/\s+/g, " ").trim();
  }

  function toAbsoluteUrl(href) {
    if (!href || typeof href !== "string") {
      return null;
    }

    try {
      return new URL(href, window.location.origin).toString();
    } catch {
      return null;
    }
  }

  function parseCompactNumber(raw) {
    if (!raw) {
      return null;
    }

    const normalized = safeText(String(raw)).replace(/,/g, "");
    const match = normalized.match(/(\d+(?:\.\d+)?)([KMB])?/i);
    if (!match) {
      return null;
    }

    const base = Number.parseFloat(match[1]);
    if (Number.isNaN(base)) {
      return null;
    }

    const suffix = (match[2] || "").toUpperCase();
    const multipliers = { K: 1_000, M: 1_000_000, B: 1_000_000_000 };
    const multiplier = multipliers[suffix] || 1;
    return Math.round(base * multiplier);
  }

  function parseTweetIdFromUrl(url) {
    if (!url || typeof url !== "string") {
      return null;
    }
    const match = url.match(/\/status\/(\d+)/);
    return match ? match[1] : null;
  }

  function extractRelationFromAttrs(tweetElement, attrs) {
    for (const attr of attrs) {
      const value = tweetElement.getAttribute(attr);
      if (!value) {
        continue;
      }
      return parseTweetIdFromUrl(value) || value;
    }
    return null;
  }

  function findClosestTweetContainer(node) {
    if (!isElement(node)) {
      return null;
    }
    return node.closest(TWEET_SELECTOR_QUERY);
  }

  function getTweetCandidates(root = document) {
    if (!root || typeof root.querySelectorAll !== "function") {
      return [];
    }

    const matches = [];
    for (const selector of TWEET_SELECTORS) {
      matches.push(...root.querySelectorAll(selector));
    }

    return uniqueElements(matches);
  }

  function getActionSignalScore(group) {
    if (!isElement(group)) {
      return 0;
    }

    let score = 0;
    const directLabel = (group.getAttribute("aria-label") || "").toLowerCase();
    for (const hint of ACTION_HINTS) {
      if (directLabel.includes(hint)) {
        score += 2;
      }
    }

    const controls = group.querySelectorAll("button, a, [role='button']");
    for (const control of controls) {
      const label = [
        control.getAttribute("aria-label") || "",
        control.getAttribute("title") || "",
        control.textContent || ""
      ]
        .join(" ")
        .toLowerCase();

      for (const hint of ACTION_HINTS) {
        if (label.includes(hint)) {
          score += 1;
          break;
        }
      }
    }

    if (controls.length >= 4) {
      score += 1;
    }

    return score;
  }

  function locateActionBar(tweet) {
    if (!isElement(tweet)) {
      return null;
    }

    const groups = tweet.querySelectorAll("div[role='group']");
    let bestGroup = null;
    let bestScore = 0;

    for (const group of groups) {
      const score = getActionSignalScore(group);
      if (score > bestScore) {
        bestScore = score;
        bestGroup = group;
      }
    }

    if (bestGroup && bestScore >= 2) {
      return bestGroup;
    }

    return null;
  }

  function extractFirstText(tweet, selectors) {
    for (const selector of selectors) {
      const element = tweet.querySelector(selector);
      if (element) {
        const text = safeText(element.textContent || "");
        if (text) {
          return text;
        }
      }
    }
    return null;
  }

  function extractAuthor(tweet) {
    for (const selector of AUTHOR_SELECTORS) {
      const candidates = tweet.querySelectorAll(selector);
      for (const candidate of candidates) {
        const href = candidate.getAttribute("href") || "";
        if (!href.startsWith("/") || href.includes("/status/")) {
          continue;
        }

        const handle = href.split("/").filter(Boolean)[0];
        if (handle) {
          return `@${handle}`;
        }
      }
    }
    return null;
  }

  function extractTweetUrl(tweet) {
    for (const selector of TWEET_URL_SELECTORS) {
      const candidates = tweet.querySelectorAll(selector);
      for (const candidate of candidates) {
        if (candidate.tagName === "TIME" && candidate.parentElement?.tagName === "A") {
          const absoluteFromTime = toAbsoluteUrl(candidate.parentElement.getAttribute("href"));
          if (absoluteFromTime && absoluteFromTime.includes("/status/")) {
            return absoluteFromTime;
          }
          continue;
        }

        if (candidate.tagName === "A") {
          const absolute = toAbsoluteUrl(candidate.getAttribute("href"));
          if (absolute && absolute.includes("/status/")) {
            return absolute;
          }
        }
      }
    }
    return null;
  }

  function extractCountByDataTestId(tweet, testIds) {
    for (const id of testIds) {
      const base = tweet.querySelector(`[data-testid="${id}"]`);
      if (!base) {
        continue;
      }

      const textFromContainer = extractFirstText(base, [
        '[data-testid="app-text-transition-container"] span',
        "span"
      ]);
      const parsed = parseCompactNumber(textFromContainer);
      if (parsed !== null) {
        return parsed;
      }
    }
    return null;
  }

  function extractCountFromAriaLabel(tweet, hints) {
    const controls = tweet.querySelectorAll("button, a, [role='button']");
    for (const control of controls) {
      const label = safeText(control.getAttribute("aria-label") || "");
      if (!label) {
        continue;
      }

      const lower = label.toLowerCase();
      if (!hints.some((hint) => lower.includes(hint))) {
        continue;
      }

      const parsed = parseCompactNumber(label);
      if (parsed !== null) {
        return parsed;
      }
    }
    return null;
  }

  function extractCount(tweet, dataTestIds, hints) {
    const fromDataTestId = extractCountByDataTestId(tweet, dataTestIds);
    if (fromDataTestId !== null) {
      return fromDataTestId;
    }

    const fromAria = extractCountFromAriaLabel(tweet, hints);
    if (fromAria !== null) {
      return fromAria;
    }

    return null;
  }

  function extractTweetData(tweetElement) {
    if (!isElement(tweetElement)) {
      return {
        id: null,
        author: null,
        text: null,
        url: null,
        replies: null,
        reposts: null,
        likes: null,
        reply_to: null
      };
    }

    const url = extractTweetUrl(tweetElement);
    const id = parseTweetIdFromUrl(url)
      || tweetElement.getAttribute("data-tweet-id")
      || tweetElement.getAttribute("data-item-id")
      || null;

    let replyTo = null;
    replyTo = extractRelationFromAttrs(tweetElement, REPLY_TO_ATTRS);
    const quoteOf = extractRelationFromAttrs(tweetElement, QUOTE_TO_ATTRS);
    const repostOf = extractRelationFromAttrs(tweetElement, REPOST_TO_ATTRS);

    return {
      id,
      author: extractAuthor(tweetElement),
      text: extractFirstText(tweetElement, TWEET_TEXT_SELECTORS),
      url,
      replies: extractCount(tweetElement, ["reply"], ["reply"]),
      reposts: extractCount(tweetElement, ["retweet", "repost"], ["retweet", "repost"]),
      likes: extractCount(tweetElement, ["like"], ["like"]),
      reply_to: replyTo,
      quote_of: quoteOf,
      repost_of: repostOf
    };
  }

  function getConversationScope(rootTweetElement) {
    if (!isElement(rootTweetElement)) {
      return document;
    }

    const scopedContainer = rootTweetElement.closest("section, main, [aria-label]");
    return scopedContainer || document;
  }

  function buildTweetIdentity(tweetElement, tweetData) {
    if (tweetData?.id) {
      return `id:${tweetData.id}`;
    }

    if (tweetData?.url) {
      return `url:${tweetData.url}`;
    }

    const author = tweetData?.author || "unknown";
    const text = tweetData?.text || "";
    const textPrefix = text.slice(0, 120);
    const domHint = tweetElement.getAttribute("id") || tweetElement.getAttribute("data-testid") || "";
    return `fallback:${author}:${textPrefix}:${domHint}`;
  }

  function collectConversationBundle(rootTweetElement) {
    const scope = getConversationScope(rootTweetElement);
    const tweetElements = getTweetCandidates(scope);
    const seen = new Set();
    const conversation = [];
    const orderedElements = [];

    const addTweet = (tweetElement) => {
      if (!isElement(tweetElement)) {
        return;
      }

      const tweetData = extractTweetData(tweetElement);
      const identity = buildTweetIdentity(tweetElement, tweetData);
      if (seen.has(identity)) {
        return;
      }

      seen.add(identity);
      orderedElements.push(tweetElement);
      conversation.push(tweetData);
    };

    // Keep clicked tweet first when available.
    addTweet(rootTweetElement);

    for (const tweetElement of tweetElements) {
      if (tweetElement === rootTweetElement) {
        continue;
      }
      addTweet(tweetElement);
    }

    return {
      tweetElements: orderedElements,
      tweets: conversation
    };
  }

  function collectConversationTweets(rootTweetElement) {
    return collectConversationBundle(rootTweetElement).tweets;
  }

  function indexTweetsById(tweets) {
    const index = {};
    for (const tweet of tweets || []) {
      if (!tweet || !tweet.id || index[tweet.id]) {
        continue;
      }
      index[tweet.id] = tweet;
    }
    return index;
  }

  function attachReplies(tweets) {
    const uniqueTweets = [];
    const seen = new Set();

    for (const tweet of tweets || []) {
      if (!tweet) {
        continue;
      }

      const identity = tweet.id || tweet.url || `${tweet.author || ""}:${tweet.text || ""}`;
      if (!identity || seen.has(identity)) {
        continue;
      }
      seen.add(identity);
      uniqueTweets.push(tweet);
    }

    const nodeById = {};
    const nodeByTweet = new Map();
    const roots = [];

    uniqueTweets.forEach((tweet, index) => {
      const nodeKey = tweet.id || `fallback:${tweet.url || tweet.author || "unknown"}:${index}`;
      const node = { tweet, children: [] };
      nodeByTweet.set(tweet, { key: nodeKey, node });
      nodeById[nodeKey] = node;
    });

    for (const tweet of uniqueTweets) {
      const nodeEntry = nodeByTweet.get(tweet);
      const node = nodeEntry ? nodeEntry.node : null;
      if (!node) {
        continue;
      }

      if (tweet.id) {
        nodeById[tweet.id] = node;
      }
    }

    for (const tweet of uniqueTweets) {
      const nodeEntry = nodeByTweet.get(tweet);
      const node = nodeEntry ? nodeEntry.node : null;
      if (!node) {
        continue;
      }

      const parentId = tweet.reply_to;
      if (!parentId || parentId === tweet.id || !nodeById[parentId]) {
        roots.push(node);
        continue;
      }

      const parentNode = nodeById[parentId];
      if (!parentNode.children.includes(node)) {
        parentNode.children.push(node);
      }
    }

    return {
      tweets: uniqueTweets,
      index: indexTweetsById(uniqueTweets),
      roots
    };
  }

  function buildTypedEdges(tweets, index) {
    const edges = [];
    const seen = new Set();
    const safeIndex = index || {};

    const maybePush = (source, target, type) => {
      if (!source || !target || source === target || !safeIndex[source] || !safeIndex[target]) {
        return;
      }

      const key = `${source}|${target}|${type}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      edges.push({ source, target, type });
    };

    for (const tweet of tweets || []) {
      if (!tweet?.id) {
        continue;
      }

      maybePush(tweet.id, tweet.reply_to, "reply");
      maybePush(tweet.id, tweet.quote_of, "quote");
      maybePush(tweet.id, tweet.repost_of, "repost");
    }

    return edges;
  }

  function buildConversationGraph(tweets) {
    const safeTweets = Array.isArray(tweets) ? tweets : [];
    if (safeTweets.length === 0) {
      return {
        rootId: null,
        nodes: [],
        edges: [],
        root: null,
        children: []
      };
    }

    const { tweets: uniqueTweets, index, roots } = attachReplies(safeTweets);
    const explicitRootTweet = safeTweets.find((tweet) => tweet && tweet.reply_to == null && tweet.id && index[tweet.id]);
    const fallbackRootNode = roots[0] || null;

    const rootNode = explicitRootTweet && explicitRootTweet.id
      ? roots.find((node) => node.tweet.id === explicitRootTweet.id) || fallbackRootNode
      : fallbackRootNode;

    if (!rootNode) {
      return {
        rootId: null,
        nodes: uniqueTweets,
        edges: buildTypedEdges(uniqueTweets, index),
        root: null,
        children: []
      };
    }

    const disconnected = roots.filter((node) => node !== rootNode);
    const edges = buildTypedEdges(uniqueTweets, index);
    return {
      rootId: rootNode.tweet.id || null,
      nodes: uniqueTweets,
      edges,
      root: rootNode.tweet,
      children: [...rootNode.children, ...disconnected]
    };
  }

  function createExploreButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = BUTTON_CLASS;
    button.setAttribute(BUTTON_ATTR, "true");
    button.setAttribute("aria-label", "Explore conversation");
    button.textContent = "◇ Explore";

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const clickedTweet = findClosestTweetContainer(event.currentTarget);
      const rootTweetElement = resolveConversationRoot(clickedTweet) || clickedTweet;
      const { tweetElements, tweets } = collectConversationBundle(rootTweetElement);
      const inferredTweets = inferReplyStructure(tweetElements, tweets);
      const graph = buildConversationGraph(inferredTweets);
      const ranking = rankConversationGraph(graph);
      const rootTweet = extractTweetData(rootTweetElement);
      console.log({ rootTweet, graph, ranking });
    });

    return button;
  }

  function injectExploreButton(tweet) {
    if (!isElement(tweet)) {
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

  function processRoot(root = document) {
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

      const raf = typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (cb) => setTimeout(cb, 16);

      raf(flush);
    };

    return new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== "childList" || mutation.addedNodes.length === 0) {
          continue;
        }

        for (const node of mutation.addedNodes) {
          if (isElement(node)) {
            pendingRoots.add(node);
          }
        }
      }

      scheduleFlush();
    });
  }

  function init() {
    if (!document || !document.documentElement) {
      return;
    }

    if (document.documentElement.hasAttribute(EXTENSION_ROOT_ATTR)) {
      return;
    }

    document.documentElement.setAttribute(EXTENSION_ROOT_ATTR, "true");

    processRoot(document);

    const observer = createObserver();
    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    }
  }

  const api = {
    TWEET_SELECTORS,
    ACTION_HINTS,
    extractTweetData,
    resolveConversationRoot,
    inferReplyStructure,
    collectConversationBundle,
    collectConversationTweets,
    indexTweetsById,
    attachReplies,
    buildTypedEdges,
    buildConversationGraph,
    rankConversationGraph,
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
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
      init();
    }
  }
})();
