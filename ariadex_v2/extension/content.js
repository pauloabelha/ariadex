(() => {
  "use strict";

  const BUTTON_ATTR = "data-ariadex-v2-button";
  const PANEL_ID = "ariadex-v2-panel";
  const ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
  const MESSAGE_TYPE = "ARIADEx_V2_RESOLVE_ROOT_PATH";

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function baseLabelForIndex(tweet, index, clickedId) {
    if (index === 0) {
      return "Root";
    }
    if (tweet?.id === clickedId) {
      return "Explored";
    }
    return `Ancestor ${index}`;
  }

  function relationLabel(tweet, parentTweet, parentIndex, clickedId) {
    if (!tweet || !parentTweet || !tweet.outboundRelation) {
      return "";
    }

    const parentLabel = baseLabelForIndex(parentTweet, parentIndex, clickedId);
    if (tweet.outboundRelation === "quote") {
      return `quoted ${parentLabel}`;
    }
    if (tweet.outboundRelation === "reply") {
      return `replied to ${parentLabel}`;
    }
    return `${tweet.outboundRelation} ${parentLabel}`;
  }

  function buildPathEntries(path, clickedId) {
    return (Array.isArray(path) ? path : []).map((tweet, index, list) => {
      const parentTweet = index > 0 ? list[index - 1] : null;
      const label = baseLabelForIndex(tweet, index, clickedId);
      const relation = relationLabel(tweet, parentTweet, index - 1, clickedId);
      return {
        ...tweet,
        label,
        relation,
        title: relation ? `${label} (${relation})` : label
      };
    });
  }

  function findTweetArticles(root = document) {
    return [...root.querySelectorAll(ARTICLE_SELECTOR)];
  }

  function findClosestTweetArticle(node) {
    return node?.closest?.(ARTICLE_SELECTOR) || null;
  }

  function extractTweetId(article) {
    const statusLink = article?.querySelector?.('a[href*="/status/"]');
    if (!statusLink) {
      return "";
    }
    const href = statusLink.getAttribute("href") || "";
    const match = href.match(/\/status\/(\d+)/);
    return match ? match[1] : "";
  }

  function ensurePanel(root = document) {
    let panel = root.getElementById(PANEL_ID);
    if (panel) {
      return panel;
    }

    panel = root.createElement("aside");
    panel.id = PANEL_ID;
    panel.className = "ariadex-v2-panel";
    root.body.appendChild(panel);
    return panel;
  }

  function renderHeader(panel, root, metaText) {
    const header = root.createElement("div");
    header.className = "ariadex-v2-panel-header";

    const title = root.createElement("div");
    title.className = "ariadex-v2-title";
    title.textContent = "AriadeX v2 · Root Path";

    const meta = root.createElement("div");
    meta.className = "ariadex-v2-meta";
    meta.textContent = normalizeText(metaText || "Tracing root path...");

    header.appendChild(title);
    header.appendChild(meta);
    panel.appendChild(header);
  }

  function renderStatus(message, root = document) {
    const panel = ensurePanel(root);
    panel.innerHTML = "";
    renderHeader(panel, root, message);
  }

  function renderPath(path, clickedId, root = document) {
    const panel = ensurePanel(root);
    panel.innerHTML = "";
    renderHeader(panel, root, `${Array.isArray(path) ? path.length : 0} path tweets`);

    if (!Array.isArray(path) || path.length === 0) {
      const empty = root.createElement("div");
      empty.className = "ariadex-v2-empty";
      empty.textContent = "No path could be resolved.";
      panel.appendChild(empty);
      return panel;
    }

    const list = root.createElement("ol");
    list.className = "ariadex-v2-list";

    for (const entry of buildPathEntries(path, clickedId)) {
      const item = root.createElement("li");
      item.className = "ariadex-v2-item";

      const role = root.createElement("div");
      role.className = "ariadex-v2-item-role";
      role.textContent = entry.title;

      const author = root.createElement("div");
      author.className = "ariadex-v2-item-author";
      author.textContent = `@${String(entry.author || "unknown").replace(/^@/, "")}`;

      const text = root.createElement("div");
      text.className = "ariadex-v2-item-text";
      text.textContent = entry.text || "(no text)";

      const id = root.createElement("div");
      id.className = "ariadex-v2-item-id";
      id.textContent = entry.id;

      item.appendChild(role);
      item.appendChild(author);
      item.appendChild(text);
      item.appendChild(id);

      item.addEventListener("click", () => {
        if (entry.url) {
          root.defaultView.location.href = entry.url;
        }
      });

      list.appendChild(item);
    }

    panel.appendChild(list);
    return panel;
  }

  function resolveRootPath(clickedTweetId, chromeApi = chrome) {
    if (!clickedTweetId) {
      return Promise.resolve([]);
    }

    if (!chromeApi?.runtime?.sendMessage) {
      return Promise.reject(new Error("extension_runtime_unavailable"));
    }

    return new Promise((resolve, reject) => {
      chromeApi.runtime.sendMessage(
        { type: MESSAGE_TYPE, tweetId: clickedTweetId },
        (response) => {
          const runtimeError = chromeApi.runtime?.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message || "extension_message_failed"));
            return;
          }

          if (!response?.ok) {
            reject(new Error(response?.error || "root_path_resolution_failed"));
            return;
          }

          resolve(Array.isArray(response.path) ? response.path : []);
        }
      );
    });
  }

  function createExploreButton(article, root = document, chromeApi = chrome) {
    const button = root.createElement("button");
    button.type = "button";
    button.className = "ariadex-v2-button";
    button.setAttribute(BUTTON_ATTR, "true");
    button.textContent = "Explore Path";

    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const tweetArticle = findClosestTweetArticle(button) || article;
      const clickedId = extractTweetId(tweetArticle);
      if (!clickedId) {
        renderStatus("Could not resolve clicked tweet id.", root);
        return;
      }

      renderStatus(`Tracing root path from ${clickedId}...`, root);

      try {
        const path = await resolveRootPath(clickedId, chromeApi);
        renderPath(path, clickedId, root);
      } catch (error) {
        renderStatus(`Path lookup failed: ${error.message}`, root);
      }
    });

    return button;
  }

  function injectButton(article, root = document, chromeApi = chrome) {
    if (!article || article.querySelector(`[${BUTTON_ATTR}="true"]`)) {
      return;
    }

    const toolbar = article.querySelector('[role="group"]');
    if (!toolbar) {
      return;
    }

    toolbar.appendChild(createExploreButton(article, root, chromeApi));
  }

  function scan(root = document, chromeApi = chrome) {
    findTweetArticles(root).forEach((article) => injectButton(article, root, chromeApi));
  }

  function start(root = document, chromeApi = chrome) {
    const observer = new MutationObserver(() => {
      scan(root, chromeApi);
    });

    scan(root, chromeApi);
    observer.observe(root.documentElement, {
      childList: true,
      subtree: true
    });
    return observer;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      BUTTON_ATTR,
      PANEL_ID,
      ARTICLE_SELECTOR,
      MESSAGE_TYPE,
      normalizeText,
      baseLabelForIndex,
      relationLabel,
      buildPathEntries,
      findTweetArticles,
      findClosestTweetArticle,
      extractTweetId,
      ensurePanel,
      renderStatus,
      renderPath,
      resolveRootPath,
      createExploreButton,
      injectButton,
      scan,
      start
    };
  } else {
    start(document, chrome);
  }
})();
