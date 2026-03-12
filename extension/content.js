(() => {
  "use strict";

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
        author: null,
        text: null,
        url: null,
        replies: null,
        reposts: null,
        likes: null
      };
    }

    return {
      author: extractAuthor(tweetElement),
      text: extractFirstText(tweetElement, TWEET_TEXT_SELECTORS),
      url: extractTweetUrl(tweetElement),
      replies: extractCount(tweetElement, ["reply"], ["reply"]),
      reposts: extractCount(tweetElement, ["retweet", "repost"], ["retweet", "repost"]),
      likes: extractCount(tweetElement, ["like"], ["like"])
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

      const tweetElement = findClosestTweetContainer(event.currentTarget);
      const tweetData = extractTweetData(tweetElement);
      console.log(tweetData);
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
