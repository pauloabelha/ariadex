(() => {
  "use strict";

  const globalScope = typeof globalThis !== "undefined" ? globalThis : {};

  const highlightApi = typeof module !== "undefined" && module.exports
    ? require("./tweet_highlight.js")
    : (globalScope.AriadexUITweetHighlight || {});

  const scrollToTweet = typeof highlightApi.scrollToTweet === "function"
    ? highlightApi.scrollToTweet
    : () => false;

  const PANEL_SELECTOR = ".ariadex-panel";
  const PANEL_CLASS = "ariadex-panel";
  const PANEL_BODY_CLASS = "ariadex-panel-body";
  const HEADER_CLASS = "ariadex-header";
  const SECTION_CLASS = "ariadex-section";
  const SECTION_TITLE_CLASS = "ariadex-section-title";
  const LIST_CLASS = "ariadex-thread-list";
  const THREAD_CLASS = "ariadex-thread";
  const EMPTY_CLASS = "ariadex-empty";
  const STATUS_CLASS = "ariadex-status";

  function applyFloatingPanelStyles(panel) {
    panel.style.position = "fixed";
    panel.style.top = "120px";
    panel.style.right = "24px";
    panel.style.width = "360px";
    panel.style.maxHeight = "68vh";
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

  function createPanelContainer(root = globalScope.document) {
    let panel = root?.querySelector?.(PANEL_SELECTOR);
    if (panel) {
      return panel;
    }

    panel = root.createElement("aside");
    panel.className = PANEL_CLASS;
    applyFloatingPanelStyles(panel);

    const header = root.createElement("div");
    header.className = HEADER_CLASS;
    header.textContent = "Ariadex Panel";

    const body = root.createElement("div");
    body.className = PANEL_BODY_CLASS;

    panel.appendChild(header);
    panel.appendChild(body);

    if (root.body) {
      root.body.appendChild(panel);
    }

    return panel;
  }

  function ensurePanelExists(root = globalScope.document) {
    const panel = createPanelContainer(root);
    if (panel && panel.parentElement !== root.body && root.body) {
      root.body.appendChild(panel);
    }
    return panel;
  }

  function truncateText(text, maxLen = 160) {
    if (!text) {
      return "";
    }

    const normalized = String(text).replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLen) {
      return normalized;
    }

    return `${normalized.slice(0, maxLen - 1)}…`;
  }

  function normalizeFollowingSet(input) {
    if (!input) {
      return new Set();
    }

    if (input instanceof Set) {
      const next = new Set();
      for (const value of input) {
        if (value == null) {
          continue;
        }

        const normalized = String(value).trim();
        if (normalized) {
          next.add(normalized);
        }
      }
      return next;
    }

    if (Array.isArray(input)) {
      return new Set(input.map((value) => String(value).trim()).filter(Boolean));
    }

    return new Set();
  }

  function normalizeExcludedTweetIds(input) {
    if (!input) {
      return new Set();
    }

    if (input instanceof Set) {
      const out = new Set();
      for (const value of input) {
        if (value == null) {
          continue;
        }
        const normalized = String(value).trim();
        if (normalized) {
          out.add(normalized);
        }
      }
      return out;
    }

    if (Array.isArray(input)) {
      return new Set(input.map((value) => String(value || "").trim()).filter(Boolean));
    }

    return new Set();
  }

  function normalizeHandle(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) {
      return "";
    }
    return raw.startsWith("@") ? raw : `@${raw}`;
  }

  function isAuthorFollowed(tweet, followingSet) {
    const authorId = tweet?.author_id != null ? String(tweet.author_id).trim() : "";
    if (authorId && (followingSet.has(authorId) || followingSet.has(authorId.toLowerCase()))) {
      return true;
    }

    const authorHandle = normalizeHandle(tweet?.author);
    if (!authorHandle) {
      return false;
    }

    return (
      followingSet.has(authorHandle)
      || followingSet.has(authorHandle.slice(1))
    );
  }

  function readScore(scoreById, tweetId) {
    if (!tweetId) {
      return 0;
    }

    if (scoreById instanceof Map) {
      const mapped = Number(scoreById.get(tweetId));
      return Number.isFinite(mapped) ? mapped : 0;
    }

    if (scoreById && typeof scoreById === "object") {
      const value = Number(scoreById[tweetId]);
      return Number.isFinite(value) ? value : 0;
    }

    return 0;
  }

  function buildPanelSections({ nodes, scoreById, followingSet, excludedTweetIds, networkLimit = 5, topLimit = 10 } = {}) {
    const safeNodes = Array.isArray(nodes) ? nodes : [];
    const normalizedFollowingSet = normalizeFollowingSet(followingSet);
    const excludedIds = normalizeExcludedTweetIds(excludedTweetIds);
    const rankedEntries = [];

    for (let i = 0; i < safeNodes.length; i += 1) {
      const tweet = safeNodes[i];
      if (!tweet || !tweet.id || tweet.type === "repost_event" || excludedIds.has(String(tweet.id))) {
        continue;
      }

      rankedEntries.push({
        id: tweet.id,
        tweet,
        score: readScore(scoreById, tweet.id),
        inputIndex: i
      });
    }

    rankedEntries.sort((a, b) => {
      const scoreDiff = b.score - a.score;
      if (Math.abs(scoreDiff) > 1e-12) {
        return scoreDiff;
      }

      if (a.inputIndex !== b.inputIndex) {
        return a.inputIndex - b.inputIndex;
      }

      return String(a.id).localeCompare(String(b.id));
    });

    const fromNetwork = [];
    const topThinkers = [];
    const usedIds = new Set();

    for (const entry of rankedEntries) {
      const isFollowed = isAuthorFollowed(entry.tweet, normalizedFollowingSet);

      if (isFollowed && fromNetwork.length < networkLimit) {
        fromNetwork.push(entry);
        usedIds.add(entry.id);
      } else if (!usedIds.has(entry.id) && topThinkers.length < topLimit) {
        topThinkers.push(entry);
        usedIds.add(entry.id);
      }

      if (fromNetwork.length >= networkLimit && topThinkers.length >= topLimit) {
        break;
      }
    }

    return {
      fromNetwork,
      topThinkers,
      rankedEntries
    };
  }

  function createSection(root, title, entries, emptyText) {
    const section = root.createElement("section");
    section.className = SECTION_CLASS;

    const header = root.createElement("h3");
    header.className = SECTION_TITLE_CLASS;
    header.textContent = title;

    const list = root.createElement("ul");
    list.className = LIST_CLASS;

    if (!Array.isArray(entries) || entries.length === 0) {
      const empty = root.createElement("li");
      empty.className = `${THREAD_CLASS} ${EMPTY_CLASS}`;
      empty.textContent = emptyText;
      list.appendChild(empty);
    } else {
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        const tweet = entry.tweet || {};

        const isAuthorThread = tweet.type === "author_thread";
        const firstAuthorTweet = isAuthorThread && Array.isArray(tweet.tweets) && tweet.tweets.length > 0
          ? tweet.tweets[0]
          : null;

        const targetTweetId = isAuthorThread
          ? (firstAuthorTweet?.id || null)
          : (tweet.id || entry.id || null);

        const item = root.createElement("li");
        item.className = THREAD_CLASS;
        item.setAttribute("data-tweet-id", targetTweetId || "");

        const author = tweet.author || "@unknown";
        const text = truncateText(
          isAuthorThread
            ? (tweet.text || firstAuthorTweet?.text || "")
            : (tweet.text || "")
        );
        const score = Number.isFinite(entry.score) ? entry.score : 0;

        const titleNode = root.createElement("div");
        const strong = root.createElement("strong");
        strong.textContent = `${i + 1}. ${author}`;
        titleNode.appendChild(strong);

        const snippet = root.createElement("div");
        snippet.className = "ariadex-snippet";
        snippet.textContent = text;

        const scoreLine = root.createElement("div");
        scoreLine.className = "ariadex-score";
        scoreLine.textContent = isAuthorThread
          ? `ThinkerRank: ${score.toFixed(4)} · Author thread`
          : `ThinkerRank: ${score.toFixed(4)}`;

        item.appendChild(titleNode);
        item.appendChild(snippet);
        item.appendChild(scoreLine);

        item.addEventListener("click", () => {
          if (targetTweetId) {
            scrollToTweet(targetTweetId, { root });
          }
        });

        list.appendChild(item);
      }
    }

    section.appendChild(header);
    section.appendChild(list);
    return section;
  }

  function renderConversationPanel({ nodes, scoreById, followingSet, excludedTweetIds, networkLimit = 5, topLimit = 10, statusMessage = "", root = globalScope.document } = {}) {
    const panel = ensurePanelExists(root);
    const body = panel.querySelector(`.${PANEL_BODY_CLASS}`);
    if (!body) {
      return {
        fromNetwork: [],
        topThinkers: [],
        rankedEntries: []
      };
    }

    const sections = buildPanelSections({
      nodes,
      scoreById,
      followingSet,
      excludedTweetIds,
      networkLimit,
      topLimit
    });

    body.innerHTML = "";
    const fragment = root.createDocumentFragment();
    if (statusMessage) {
      const statusNode = root.createElement("div");
      statusNode.className = STATUS_CLASS;
      statusNode.textContent = statusMessage;
      fragment.appendChild(statusNode);
    }
    fragment.appendChild(
      createSection(root, "⭐ From Your Network", sections.fromNetwork, "No ranked tweets from followed accounts.")
    );
    fragment.appendChild(
      createSection(root, "🔥 Top Thinkers", sections.topThinkers, "No ranked tweets available.")
    );

    body.appendChild(fragment);
    return sections;
  }

  function renderTopThreads(rankedTweets, root = globalScope.document) {
    const entries = Array.isArray(rankedTweets) ? rankedTweets : [];
    const nodes = [];
    const scoreById = new Map();

    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i] || {};
      const tweet = entry.tweet || entry;
      const id = tweet?.id || entry.id;
      if (!id) {
        continue;
      }

      const normalizedTweet = tweet.id ? tweet : { ...tweet, id };
      nodes.push(normalizedTweet);
      scoreById.set(id, Number.isFinite(entry.score) ? entry.score : 0);
    }

    return renderConversationPanel({
      nodes,
      scoreById,
      followingSet: new Set(),
      networkLimit: 0,
      topLimit: 5,
      root
    });
  }

  const api = {
    createPanelContainer,
    ensurePanelExists,
    buildPanelSections,
    renderConversationPanel,
    renderTopThreads
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globalScope.AriadexUIPanelRenderer = api;
  }
})();
