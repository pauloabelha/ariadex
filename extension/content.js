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

  const ACTION_HINTS = ["reply", "repost", "retweet", "like", "bookmark", "share", "view"];

  function isElement(node) {
    return typeof Element !== "undefined" && node instanceof Element;
  }

  function uniqueElements(elements) {
    return [...new Set(elements.filter(isElement))];
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
      alert("Explore conversation (Ariadex MVP)");
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
