(() => {
  "use strict";

  const globalScope = typeof globalThis !== "undefined" ? globalThis : {};
  const HIGHLIGHT_CLASS = "ariadex-highlight";
  const TWEET_SELECTOR_QUERY = 'article[data-testid="tweet"], article[role="article"], div[data-testid="tweet"], article';

  function findTweetElementById(tweetId, root = globalScope.document) {
    if (!tweetId || !root || typeof root.querySelectorAll !== "function") {
      return null;
    }

    const links = root.querySelectorAll(`a[href*="/status/${tweetId}"]`);
    for (const link of links) {
      const tweet = link.closest(TWEET_SELECTOR_QUERY);
      if (tweet) {
        return tweet;
      }
    }

    const tweetCandidates = root.querySelectorAll(TWEET_SELECTOR_QUERY);
    for (const candidate of tweetCandidates) {
      if (candidate.getAttribute("data-tweet-id") === String(tweetId)) {
        return candidate;
      }
    }

    return null;
  }

  function scrollToTweet(tweetId, options = {}) {
    const root = options.root || globalScope.document;
    const tweet = findTweetElementById(tweetId, root);
    if (!tweet) {
      return false;
    }

    if (typeof tweet.scrollIntoView === "function") {
      tweet.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    tweet.classList.add(HIGHLIGHT_CLASS);
    setTimeout(() => {
      tweet.classList.remove(HIGHLIGHT_CLASS);
    }, 1500);

    return true;
  }

  const api = {
    HIGHLIGHT_CLASS,
    findTweetElementById,
    scrollToTweet
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globalScope.AriadexUITweetHighlight = api;
  }
})();
