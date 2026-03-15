(() => {
  "use strict";

  const globalScope = typeof globalThis !== "undefined" ? globalThis : {};

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
  const FOLLOWING_TEXT_PATTERN = /\bfollowing\b/i;
  const VIEWER_HANDLE_PATTERNS = [
    /^@?[a-zA-Z0-9_]{1,15}$/,
    /^@?[a-zA-Z0-9_]{1,15}\s*·/
  ];
  const RESERVED_NON_HANDLE_TOKENS = new Set([
    "home",
    "explore",
    "notifications",
    "messages",
    "lists",
    "bookmarks",
    "communities",
    "premium",
    "verified",
    "profile",
    "more",
    "jobs",
    "grok"
  ]);

  function isElement(node) {
    return typeof Element !== "undefined" && node instanceof Element;
  }

  function uniqueElements(elements) {
    return [...new Set((elements || []).filter(isElement))];
  }

  function safeText(value) {
    if (typeof value !== "string") {
      return "";
    }
    return value.replace(/\s+/g, " ").trim();
  }

  function toAbsoluteUrl(href, rootNode) {
    if (!href || typeof href !== "string") {
      return null;
    }

    const origin = rootNode?.ownerDocument?.defaultView?.location?.origin
      || globalScope?.location?.origin
      || "https://x.com";

    try {
      return new URL(href, origin).toString();
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

  function parseAuthorId(authorHandle) {
    if (!authorHandle || typeof authorHandle !== "string") {
      return null;
    }

    const normalized = authorHandle.trim();
    if (!normalized) {
      return null;
    }

    return normalized.startsWith("@") ? normalized.slice(1) : normalized;
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

  function getTweetCandidates(root = globalScope.document) {
    if (!root || typeof root.querySelectorAll !== "function") {
      return [];
    }

    const matches = [];
    for (const selector of TWEET_SELECTORS) {
      matches.push(...root.querySelectorAll(selector));
    }

    return uniqueElements(matches);
  }

  function findClosestTweetContainer(node) {
    if (!isElement(node)) {
      return null;
    }

    return node.closest(TWEET_SELECTOR_QUERY);
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

    return bestGroup && bestScore >= 2 ? bestGroup : null;
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
          const absoluteFromTime = toAbsoluteUrl(candidate.parentElement.getAttribute("href"), tweet);
          if (absoluteFromTime && absoluteFromTime.includes("/status/")) {
            return absoluteFromTime;
          }
          continue;
        }

        if (candidate.tagName === "A") {
          const absolute = toAbsoluteUrl(candidate.getAttribute("href"), tweet);
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
        reply_to: null,
        quote_of: null,
        repost_of: null
      };
    }

    const url = extractTweetUrl(tweetElement);
    const id = parseTweetIdFromUrl(url)
      || tweetElement.getAttribute("data-tweet-id")
      || tweetElement.getAttribute("data-item-id")
      || null;

    const replyTo = extractRelationFromAttrs(tweetElement, REPLY_TO_ATTRS);
    const quoteOf = extractRelationFromAttrs(tweetElement, QUOTE_TO_ATTRS);
    const repostOf = extractRelationFromAttrs(tweetElement, REPOST_TO_ATTRS);

    const author = extractAuthor(tweetElement);
    const replies = extractCount(tweetElement, ["reply"], ["reply"]);
    const reposts = extractCount(tweetElement, ["retweet", "repost"], ["retweet", "repost"]);
    const likes = extractCount(tweetElement, ["like"], ["like"]);

    return {
      id,
      author,
      text: extractFirstText(tweetElement, TWEET_TEXT_SELECTORS),
      url,
      replies,
      reposts,
      likes,
      reply_to: replyTo,
      quote_of: quoteOf,
      repost_of: repostOf
    };
  }

  function hasFollowingIndicator(tweetElement) {
    if (!isElement(tweetElement)) {
      return false;
    }

    const controls = tweetElement.querySelectorAll("button, [role='button'], a[aria-label], div[role='button']");
    for (const control of controls) {
      const label = safeText([
        control.getAttribute("aria-label") || "",
        control.getAttribute("title") || "",
        control.textContent || ""
      ].join(" "));

      if (!label) {
        continue;
      }

      if (FOLLOWING_TEXT_PATTERN.test(label)) {
        return true;
      }
    }

    return false;
  }

  function collectFollowedAuthorHints(root = globalScope.document) {
    const followed = new Set();
    const tweets = getTweetCandidates(root);

    for (const tweetElement of tweets) {
      if (!hasFollowingIndicator(tweetElement)) {
        continue;
      }

      const tweet = extractTweetData(tweetElement);
      const author = typeof tweet.author === "string" ? tweet.author.trim() : "";
      if (!author) {
        continue;
      }

      const handle = author.startsWith("@") ? author.slice(1) : author;
      followed.add(author);
      followed.add(author.toLowerCase());
      followed.add(handle);
      followed.add(handle.toLowerCase());
    }

    return followed;
  }

  function parseHandleToken(rawText) {
    const text = safeText(rawText || "");
    if (!text) {
      return null;
    }

    const direct = text.split(/\s+/)[0];
    if (VIEWER_HANDLE_PATTERNS.some((pattern) => pattern.test(direct))) {
      const normalized = direct.startsWith("@") ? direct : `@${direct}`;
      const bare = normalized.slice(1).toLowerCase();
      if (RESERVED_NON_HANDLE_TOKENS.has(bare)) {
        return null;
      }
      return normalized.toLowerCase();
    }

    const inlineMatch = text.match(/@([a-zA-Z0-9_]{1,15})\b/);
    if (inlineMatch && inlineMatch[1]) {
      return `@${inlineMatch[1].toLowerCase()}`;
    }

    return null;
  }

  function collectViewerHandleHints(root = globalScope.document) {
    const hints = new Set();
    if (!root || typeof root.querySelectorAll !== "function") {
      return hints;
    }

    const selectors = [
      // Account switcher / profile button in X header.
      "[data-testid='SideNav_AccountSwitcher_Button'] span",
      "header [data-testid='SideNav_AccountSwitcher_Button'] span",
      "header button[aria-label*='Account' i] span",
      "header button[aria-haspopup='menu'] span",
      "header button span"
    ];

    for (const selector of selectors) {
      const nodes = root.querySelectorAll(selector);
      for (const node of nodes) {
        const handle = parseHandleToken(node.textContent || "");
        if (!handle) {
          continue;
        }
        hints.add(handle);
        hints.add(handle.slice(1));
      }
    }

    return hints;
  }

  function toUnifiedTweetSchema(tweet) {
    if (!tweet || !tweet.id) {
      return null;
    }

    const refs = [];
    if (tweet.reply_to) {
      refs.push({ type: "replied_to", id: tweet.reply_to });
    }
    if (tweet.quote_of) {
      refs.push({ type: "quoted", id: tweet.quote_of });
    }
    if (tweet.repost_of) {
      refs.push({ type: "retweeted", id: tweet.repost_of });
    }

    return {
      id: tweet.id,
      author_id: parseAuthorId(tweet.author),
      text: tweet.text || "",
      referenced_tweets: refs,
      metrics: {
        reply_count: Number.isFinite(tweet.replies) ? tweet.replies : 0,
        retweet_count: Number.isFinite(tweet.reposts) ? tweet.reposts : 0,
        like_count: Number.isFinite(tweet.likes) ? tweet.likes : 0,
        quote_count: Number.isFinite(tweet.quote_count) ? tweet.quote_count : 0
      }
    };
  }

  function getConversationScope(rootTweetElement) {
    if (!isElement(rootTweetElement)) {
      return globalScope.document;
    }

    const scopedContainer = rootTweetElement.closest("section, main, [aria-label]");
    return scopedContainer || globalScope.document;
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
    const tweets = [];
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
      tweets.push(tweetData);
    };

    addTweet(rootTweetElement);

    for (const tweetElement of tweetElements) {
      if (tweetElement === rootTweetElement) {
        continue;
      }
      addTweet(tweetElement);
    }

    return {
      tweetElements: orderedElements,
      tweets
    };
  }

  function collectConversationTweets(rootTweetElement) {
    return collectConversationBundle(rootTweetElement).tweets;
  }

  function collectConversationTweetSchemas(rootTweetElement) {
    return collectConversationTweets(rootTweetElement)
      .map((tweet) => toUnifiedTweetSchema(tweet))
      .filter(Boolean);
  }

  function findTweetCandidates(root) {
    return getTweetCandidates(root);
  }

  function findNestedQuotedTweet(tweetElement) {
    if (!isElement(tweetElement)) {
      return null;
    }

    const nested = findTweetCandidates(tweetElement).filter((candidate) => candidate !== tweetElement);
    return nested[0] || null;
  }

  function findAncestorTweet(tweetElement) {
    if (!isElement(tweetElement)) {
      return null;
    }

    let cursor = tweetElement.parentElement;
    while (cursor) {
      const ancestorTweet = cursor.closest(TWEET_SELECTOR_QUERY);
      if (!ancestorTweet) {
        break;
      }

      if (ancestorTweet !== tweetElement && ancestorTweet.contains(tweetElement)) {
        return ancestorTweet;
      }

      cursor = ancestorTweet.parentElement;
    }

    return null;
  }

  function findLocalScope(tweetElement) {
    if (!isElement(tweetElement)) {
      return globalScope.document || null;
    }

    return tweetElement.closest("section, main, [aria-label]") || globalScope.document;
  }

  function resolveDomConversationRoot(tweetElement) {
    if (!isElement(tweetElement)) {
      return null;
    }

    const nestedQuotedTweet = findNestedQuotedTweet(tweetElement);
    if (nestedQuotedTweet) {
      return nestedQuotedTweet;
    }

    const ancestorTweet = findAncestorTweet(tweetElement);
    if (ancestorTweet) {
      return ancestorTweet;
    }

    const scope = findLocalScope(tweetElement);
    const tweetCandidates = findTweetCandidates(scope);
    const currentIndex = tweetCandidates.indexOf(tweetElement);

    if (currentIndex > 0) {
      return tweetCandidates[0];
    }

    return tweetElement;
  }

  function buildInferenceMetadataFromElements(tweetElements) {
    const safeElements = Array.isArray(tweetElements) ? tweetElements : [];

    return safeElements.map((tweetElement) => {
      const view = tweetElement?.ownerDocument?.defaultView;
      const rectLeft = typeof tweetElement?.getBoundingClientRect === "function"
        ? Number(tweetElement.getBoundingClientRect().left) || 0
        : 0;
      const computed = view && typeof view.getComputedStyle === "function"
        ? view.getComputedStyle(tweetElement)
        : null;
      const marginLeft = Number.parseFloat(computed?.marginLeft || "0") || 0;
      const paddingLeft = Number.parseFloat(computed?.paddingLeft || "0") || 0;
      const indent = rectLeft !== 0 ? rectLeft : marginLeft + paddingLeft;

      const text = tweetElement?.textContent || "";
      const match = text.match(/Replying to\s+@([A-Za-z0-9_]+)/i);
      const replyContextHandle = match ? `@${match[1]}` : null;

      return {
        indent,
        replyContextHandle
      };
    });
  }

  const api = {
    TWEET_SELECTORS,
    ACTION_HINTS,
    extractTweetData,
    toUnifiedTweetSchema,
    collectConversationBundle,
    collectConversationTweets,
    collectConversationTweetSchemas,
    getTweetCandidates,
    locateActionBar,
    findClosestTweetContainer,
    collectFollowedAuthorHints,
    collectViewerHandleHints,
    resolveDomConversationRoot,
    buildInferenceMetadataFromElements,
    parseTweetIdFromUrl,
    parseAuthorId
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globalScope.AriadexDataDomCollector = api;
  }
})();
