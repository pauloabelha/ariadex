(() => {
  "use strict";

  const TWEET_SELECTORS = [
    'article[data-testid="tweet"]',
    'div[data-testid="tweet"]',
    "article[role='article']",
    "article"
  ];
  const TWEET_SELECTOR_QUERY = TWEET_SELECTORS.join(", ");

  function isElement(node) {
    return typeof Element !== "undefined" && node instanceof Element;
  }

  function uniqueElements(elements) {
    return [...new Set(elements.filter(isElement))];
  }

  function findTweetCandidates(root) {
    if (!root || typeof root.querySelectorAll !== "function") {
      return [];
    }

    const matches = [];
    for (const selector of TWEET_SELECTORS) {
      matches.push(...root.querySelectorAll(selector));
    }

    return uniqueElements(matches);
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
      return typeof document !== "undefined" ? document : null;
    }

    return tweetElement.closest("section, main, [aria-label]") || document;
  }

  function resolveConversationRoot(tweetElement) {
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

  const api = {
    resolveConversationRoot,
    findNestedQuotedTweet,
    findAncestorTweet
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    window.AriadexRootResolution = api;
  }
})();
