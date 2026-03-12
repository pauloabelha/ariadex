(() => {
  "use strict";

  const PANEL_SELECTOR = ".ariadex-panel";
  const PANEL_CLASS = "ariadex-panel";
  const HEADER_CLASS = "ariadex-header";
  const LIST_CLASS = "ariadex-thread-list";
  const THREAD_CLASS = "ariadex-thread thread";
  const HIGHLIGHT_CLASS = "ariadex-highlight";
  const TWEET_SELECTOR_QUERY = 'article[data-testid="tweet"], article[role="article"], div[data-testid="tweet"], article';

  function applyFloatingPanelStyles(panel) {
    panel.style.position = "fixed";
    panel.style.top = "120px";
    panel.style.right = "24px";
    panel.style.width = "320px";
    panel.style.maxHeight = "60vh";
    panel.style.overflow = "auto";
    panel.style.background = "#111";
    panel.style.color = "white";
    panel.style.border = "1px solid #444";
    panel.style.borderRadius = "10px";
    panel.style.padding = "12px";
    panel.style.zIndex = "9999999";
    panel.style.fontSize = "13px";
    panel.style.boxShadow = "0 6px 30px rgba(0,0,0,.4)";
  }

  function createPanelContainer() {
    let panel = document.querySelector(PANEL_SELECTOR);
    if (panel) {
      return panel;
    }

    panel = document.createElement("div");
    panel.className = PANEL_CLASS;
    applyFloatingPanelStyles(panel);

    panel.innerHTML = `
      <div class="${HEADER_CLASS}">Ariadex — Top Threads</div>
      <ul class="${LIST_CLASS}"></ul>
    `;

    if (document.body) {
      document.body.appendChild(panel);
      console.log("[Ariadex] Panel attached", panel);
    }

    return panel;
  }

  function ensurePanelExists() {
    const panel = createPanelContainer();
    if (panel && panel.parentElement !== document.body && document.body) {
      document.body.appendChild(panel);
      console.log("[Ariadex] Panel attached", panel);
    }
    return panel;
  }

  function truncateText(text, maxLen = 110) {
    if (!text) {
      return "";
    }

    const normalized = String(text).replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLen) {
      return normalized;
    }

    return `${normalized.slice(0, maxLen - 1)}…`;
  }

  function findTweetElementById(tweetId) {
    if (!tweetId) {
      return null;
    }

    const links = document.querySelectorAll(`a[href*="/status/${tweetId}"]`);
    for (const link of links) {
      const tweet = link.closest(TWEET_SELECTOR_QUERY);
      if (tweet) {
        return tweet;
      }
    }

    return document.querySelector(`[data-tweet-id="${tweetId}"]`) || null;
  }

  function scrollToTweet(tweetId) {
    const tweet = findTweetElementById(tweetId);
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

  function renderTopThreads(rankedTweets) {
    const panel = ensurePanelExists();
    const list = panel.querySelector(`.${LIST_CLASS}`);
    if (!list) {
      return;
    }

    list.innerHTML = "";
    const top = Array.isArray(rankedTweets) ? rankedTweets.slice(0, 5) : [];

    if (top.length === 0) {
      const empty = document.createElement("li");
      empty.className = THREAD_CLASS;
      empty.textContent = "No ranked threads available.";
      list.appendChild(empty);
      return;
    }

    top.forEach((entry, index) => {
      const tweet = entry.tweet || entry;
      const isAuthorThread = tweet.type === "author_thread";
      const tweetId = entry.id || tweet.id;
      const author = tweet.author || "@unknown";
      const primaryTweetForThread = isAuthorThread ? (tweet.tweets?.[0] || null) : null;
      const snippet = truncateText(
        (isAuthorThread ? (tweet.text || primaryTweetForThread?.text || "") : (tweet.text || ""))
      );
      const score = typeof entry.score === "number" ? entry.score : 0;
      const targetTweetId = isAuthorThread
        ? (primaryTweetForThread?.id || null)
        : tweetId;

      const item = document.createElement("li");
      item.className = THREAD_CLASS;
      item.setAttribute("data-tweet-id", tweetId || "");
      if (isAuthorThread) {
        const count = Array.isArray(tweet.tweets) ? tweet.tweets.length : 0;
        item.innerHTML = `
          <div><strong>${index + 1} Author thread (${author})</strong></div>
          <div class="ariadex-snippet">${snippet}</div>
          <div class="ariadex-score">${count} tweets · score: ${score.toFixed(3)}</div>
        `;
      } else {
        item.innerHTML = `
          <div><strong>${index + 1}</strong> <span class="ariadex-author">${author}</span></div>
          <div class="ariadex-snippet">${snippet}</div>
          <div class="ariadex-score">score: ${score.toFixed(3)}</div>
        `;
      }

      item.addEventListener("click", () => {
        if (targetTweetId) {
          scrollToTweet(targetTweetId);
        }
      });

      list.appendChild(item);
    });
  }

  const api = {
    createPanelContainer,
    ensurePanelExists,
    renderTopThreads,
    scrollToTweet,
    findTweetElementById
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    window.AriadexUIPanel = api;
  }
})();
