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
  const TAB_BAR_CLASS = "ariadex-tab-bar";
  const TAB_BUTTON_CLASS = "ariadex-tab-button";
  const TAB_BUTTON_ACTIVE_CLASS = "ariadex-tab-button-active";
  const PANEL_TAB_CONTENT_CLASS = "ariadex-tab-content";
  const EVIDENCE_CARD_CLASS = "ariadex-evidence-card";
  const PEOPLE_CARD_CLASS = "ariadex-people-card";
  const CONTEXT_CARD_CLASS = "ariadex-context-card";
  const DEFAULT_TAB = "thinkers";
  const DIGEST_CARD_CLASS = "ariadex-digest-card";
  const PANEL_HEADER_META_CLASS = "ariadex-header-meta";
  const PANEL_SHELL_CLASS = "ariadex-shell";
  const PANEL_NAV_CLASS = "ariadex-nav";
  const PANEL_MAIN_CLASS = "ariadex-main";
  const PANEL_FOOTER_CLASS = "ariadex-footer";
  const CARD_CLASS = "ariadex-card";

  function applyFloatingPanelStyles(panel) {
    panel.style.position = "fixed";
    panel.style.top = "88px";
    panel.style.right = "24px";
    panel.style.width = "min(448px, calc(100vw - 32px))";
    panel.style.maxHeight = "calc(100vh - 120px)";
    panel.style.zIndex = "9999999";
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
    const title = root.createElement("div");
    title.className = "ariadex-header-title";
    title.textContent = "Ariadex";
    const meta = root.createElement("div");
    meta.className = PANEL_HEADER_META_CLASS;
    meta.textContent = "Reading instrument for discourse";
    header.appendChild(title);
    header.appendChild(meta);

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

  function ensurePanelState(panel) {
    if (!panel) {
      return { activeTab: DEFAULT_TAB };
    }

    if (!panel.__ariadexState || typeof panel.__ariadexState !== "object") {
      panel.__ariadexState = {
        activeTab: DEFAULT_TAB
      };
    }
    return panel.__ariadexState;
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

  function deriveConversationTitle(nodes, article) {
    const articleTitle = String(article?.title || "").trim();
    if (articleTitle) {
      return articleTitle;
    }
    const safeNodes = Array.isArray(nodes) ? nodes : [];
    for (const node of safeNodes) {
      const text = String(node?.text || "").trim();
      if (text) {
        return truncateText(text, 88);
      }
    }
    return "Conversation digest";
  }

  function deriveConversationMeta(viewModel, nodes) {
    const nodeCount = Array.isArray(nodes) ? nodes.length : 0;
    const branchCount = Array.isArray(viewModel?.sections?.rankedEntries)
      ? Math.max(1, Math.min(9, viewModel.sections.rankedEntries.length))
      : 0;
    return `${nodeCount} tweets${branchCount ? ` · ${branchCount} live threads` : ""}`;
  }

  function navigateToTweet(root, targetTweetUrl, scrolled) {
    if (!targetTweetUrl) {
      return;
    }

    const view = root?.defaultView || globalScope;
    const currentHref = String(view?.location?.href || "");

    // If tweet is already in DOM, keep the panel intact and just update URL state.
    if (
      scrolled
      && view?.history
      && typeof view.history.pushState === "function"
      && currentHref
      && targetTweetUrl.startsWith("http")
    ) {
      try {
        const currentUrl = new URL(currentHref);
        const nextUrl = new URL(targetTweetUrl);
        if (currentUrl.origin === nextUrl.origin) {
          view.history.pushState({}, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
          return;
        }
      } catch {
        // Fall through to open/assign.
      }
    }

    // If not loaded in current DOM, open in a new tab to preserve panel context.
    if (typeof view?.open === "function") {
      view.open(targetTweetUrl, "_blank", "noopener,noreferrer");
      return;
    }

    if (view?.location && typeof view.location.assign === "function") {
      view.location.assign(targetTweetUrl);
    }
  }

  function normalizeFollowingSet(input) {
    const addNormalized = (target, value) => {
      const normalized = String(value).trim();
      if (!normalized) {
        return;
      }
      target.add(normalized);
      const lowered = normalized.toLowerCase();
      target.add(lowered);
      if (lowered.startsWith("@")) {
        target.add(lowered.slice(1));
      }
    };

    if (!input) {
      return new Set();
    }

    if (input instanceof Set) {
      const next = new Set();
      for (const value of input) {
        if (value == null) {
          continue;
        }
        addNormalized(next, value);
      }
      return next;
    }

    if (Array.isArray(input)) {
      const next = new Set();
      for (const value of input) {
        if (value == null) {
          continue;
        }
        addNormalized(next, value);
      }
      return next;
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

  function extractAuthorProfile(tweet) {
    if (!tweet || typeof tweet !== "object") {
      return null;
    }

    if (tweet.author_profile && typeof tweet.author_profile === "object") {
      return tweet.author_profile;
    }

    if (tweet.type === "author_thread" && Array.isArray(tweet.tweets) && tweet.tweets.length > 0) {
      const first = tweet.tweets[0];
      if (first?.author_profile && typeof first.author_profile === "object") {
        return first.author_profile;
      }
    }

    return null;
  }

  function isLikelyHumanAuthor(tweet) {
    const profile = extractAuthorProfile(tweet);
    if (!profile) {
      return true;
    }

    const username = String(profile.username || "").toLowerCase();
    const name = String(profile.name || "").toLowerCase();
    const description = String(profile.description || "").toLowerCase();
    const verifiedType = String(profile.verified_type || "").toLowerCase();

    if (verifiedType === "business" || verifiedType === "government") {
      return false;
    }

    const botSignalPattern = /\b(bot|automated|autopost|rss bot|ai bot|agent|autonomous)\b/i;
    if (botSignalPattern.test(username) || botSignalPattern.test(name) || botSignalPattern.test(description)) {
      return false;
    }

    const followers = Number(profile?.public_metrics?.followers_count);
    const following = Number(profile?.public_metrics?.following_count);
    const tweetCount = Number(profile?.public_metrics?.tweet_count);
    if (Number.isFinite(followers) && Number.isFinite(tweetCount)) {
      if (followers <= 5 && tweetCount >= 50000) {
        return false;
      }
    }
    if (Number.isFinite(followers) && Number.isFinite(following)) {
      if (followers <= 10 && following >= 500) {
        return false;
      }
    }

    return true;
  }

  function hasReplyOrQuoteRelation(tweet) {
    if (!tweet || typeof tweet !== "object") {
      return false;
    }

    if (tweet.type === "author_thread") {
      const first = Array.isArray(tweet.tweets) && tweet.tweets.length > 0 ? tweet.tweets[0] : null;
      return hasReplyOrQuoteRelation(first);
    }

    if (tweet.reply_to || tweet.quote_of) {
      return true;
    }

    const refs = Array.isArray(tweet.referenced_tweets) ? tweet.referenced_tweets : [];
    return refs.some((ref) => ref && (ref.type === "replied_to" || ref.type === "quoted"));
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

  function readRelationshipLabel(relationshipById, tweetId) {
    if (!tweetId || !relationshipById) {
      return "Cousin";
    }

    let raw = null;
    if (relationshipById instanceof Map) {
      raw = relationshipById.get(tweetId);
    } else if (typeof relationshipById === "object") {
      raw = relationshipById[tweetId];
    }

    const normalized = String(raw || "").trim().toLowerCase();
    if (normalized === "reply") {
      return "Reply";
    }
    if (normalized === "quote") {
      return "Quote";
    }
    if (normalized === "cousin") {
      return "Cousin";
    }

    return "Cousin";
  }

  function canonicalizeUrl(rawUrl) {
    const raw = String(rawUrl || "").trim();
    if (!raw) {
      return null;
    }

    let parsed = null;
    try {
      parsed = new URL(raw);
    } catch {
      return null;
    }

    parsed.hash = "";
    const blockedParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
      "ref",
      "ref_src",
      "s"
    ];
    for (const param of blockedParams) {
      parsed.searchParams.delete(param);
    }

    const host = parsed.hostname.toLowerCase();
    if (host === "x.com" || host === "twitter.com") {
      const statusMatch = parsed.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
      if (statusMatch) {
        return `https://x.com/${statusMatch[1]}/status/${statusMatch[2]}`;
      }
    }

    const normalizedSearch = parsed.searchParams.toString();
    return `${parsed.protocol}//${host}${parsed.pathname}${normalizedSearch ? `?${normalizedSearch}` : ""}`;
  }

  function isExternalEvidenceUrl(rawUrl) {
    const canonical = canonicalizeUrl(rawUrl);
    if (!canonical) {
      return false;
    }

    try {
      const parsed = new URL(canonical);
      const host = String(parsed.hostname || "").toLowerCase();
      if (host === "t.co") {
        return false;
      }
      if (host === "x.com" || host === "twitter.com") {
        return false;
      }
      if (host.endsWith(".x.com") || host.endsWith(".twitter.com")) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  function extractUrlsFromText(text) {
    const content = String(text || "");
    if (!content) {
      return [];
    }
    const matches = content.match(/https?:\/\/[^\s]+/g) || [];
    return matches.map((value) => value.trim()).filter(Boolean);
  }

  function buildEvidenceEntries({ nodes, scoreById, rankedEntries } = {}) {
    const safeNodes = Array.isArray(nodes) ? nodes : [];
    const ranked = Array.isArray(rankedEntries) ? rankedEntries : [];
    const rankByTweetId = new Map();
    for (let i = 0; i < ranked.length; i += 1) {
      rankByTweetId.set(String(ranked[i].id), i);
    }

    const byCanonicalUrl = new Map();
    for (let i = 0; i < safeNodes.length; i += 1) {
      const tweet = safeNodes[i];
      const tweetId = String(tweet?.id || "");
      if (!tweetId) {
        continue;
      }
      const urls = extractUrlsFromText(tweet?.text || "");
      if (urls.length === 0) {
        continue;
      }
      const tweetScore = readScore(scoreById, tweetId);
      for (let j = 0; j < urls.length; j += 1) {
        const canonicalUrl = canonicalizeUrl(urls[j]);
        if (!canonicalUrl || !isExternalEvidenceUrl(canonicalUrl)) {
          continue;
        }
        let entry = byCanonicalUrl.get(canonicalUrl);
        if (!entry) {
          let domain = "";
          try {
            domain = new URL(canonicalUrl).hostname.toLowerCase();
          } catch {}
          entry = {
            id: canonicalUrl,
            canonicalUrl,
            displayUrl: canonicalUrl,
            domain,
            citationCount: 0,
            weightedCitationScore: 0,
            citedByTweetIds: [],
            topCitingTweetIds: []
          };
          byCanonicalUrl.set(canonicalUrl, entry);
        }

        entry.citationCount += 1;
        entry.weightedCitationScore += tweetScore;
        entry.citedByTweetIds.push(tweetId);
      }
    }

    const entries = [...byCanonicalUrl.values()];
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      const deduped = [...new Set(entry.citedByTweetIds)];
      deduped.sort((a, b) => {
        const ai = rankByTweetId.has(String(a)) ? rankByTweetId.get(String(a)) : Number.MAX_SAFE_INTEGER;
        const bi = rankByTweetId.has(String(b)) ? rankByTweetId.get(String(b)) : Number.MAX_SAFE_INTEGER;
        if (ai !== bi) {
          return ai - bi;
        }
        return String(a).localeCompare(String(b));
      });
      entry.citedByTweetIds = deduped;
      entry.topCitingTweetIds = deduped.slice(0, 3);
    }

    entries.sort((a, b) => {
      const scoreDiff = b.weightedCitationScore - a.weightedCitationScore;
      if (Math.abs(scoreDiff) > 1e-12) {
        return scoreDiff;
      }
      const citeDiff = b.citationCount - a.citationCount;
      if (citeDiff !== 0) {
        return citeDiff;
      }
      return String(a.id).localeCompare(String(b.id));
    });
    return entries;
  }

  function buildPeopleEntries({ rankedEntries, followingSet } = {}) {
    const followed = normalizeFollowingSet(followingSet);
    const ranked = Array.isArray(rankedEntries) ? rankedEntries : [];
    const byAuthorId = new Map();

    for (let i = 0; i < ranked.length; i += 1) {
      const entry = ranked[i];
      const tweet = entry?.tweet || {};
      const authorId = String(tweet?.author_id || "").trim();
      const author = String(tweet?.author || "@unknown").trim() || "@unknown";
      const key = authorId || author.toLowerCase();
      if (!key) {
        continue;
      }
      let person = byAuthorId.get(key);
      if (!person) {
        person = {
          id: key,
          author_id: authorId || null,
          author,
          tweetsCount: 0,
          aggregateScore: 0,
          bestTweetId: entry.id,
          bestScore: Number(entry.score) || 0,
          isFollowed: isAuthorFollowed(tweet, followed)
        };
        byAuthorId.set(key, person);
      }
      const entryScore = Number(entry.score) || 0;
      person.tweetsCount += 1;
      person.aggregateScore += entryScore;
      if (entryScore > person.bestScore) {
        person.bestTweetId = entry.id;
        person.bestScore = entryScore;
      }
      person.isFollowed = person.isFollowed || isAuthorFollowed(tweet, followed);
    }

    const people = [...byAuthorId.values()];
    people.sort((a, b) => {
      const diff = b.aggregateScore - a.aggregateScore;
      if (Math.abs(diff) > 1e-12) {
        return diff;
      }
      const countDiff = b.tweetsCount - a.tweetsCount;
      if (countDiff !== 0) {
        return countDiff;
      }
      return String(a.id).localeCompare(String(b.id));
    });
    return {
      followed: people.filter((p) => p.isFollowed),
      others: people.filter((p) => !p.isFollowed)
    };
  }

  function buildContextSummary({ nodes, rankedEntries } = {}) {
    const safeNodes = Array.isArray(nodes) ? nodes : [];
    const ranked = Array.isArray(rankedEntries) ? rankedEntries : [];
    let replies = 0;
    let quotes = 0;
    let cousins = 0;

    for (let i = 0; i < ranked.length; i += 1) {
      const label = String(ranked[i]?.relationshipLabel || "").toLowerCase();
      if (label === "reply") {
        replies += 1;
      } else if (label === "quote") {
        quotes += 1;
      } else {
        cousins += 1;
      }
    }

    return {
      nodeCount: safeNodes.length,
      rankedCount: ranked.length,
      replies,
      quotes,
      cousins
    };
  }

  function buildDexViewModel({ nodes, scoreById, relationshipById, followingSet, excludedTweetIds, networkLimit, topLimit, humanOnly } = {}) {
    const sections = buildPanelSections({
      nodes,
      scoreById,
      relationshipById,
      followingSet,
      excludedTweetIds,
      networkLimit,
      topLimit,
      humanOnly
    });
    const evidence = buildEvidenceEntries({
      nodes,
      scoreById,
      rankedEntries: sections.rankedEntries
    });
    const people = buildPeopleEntries({
      rankedEntries: sections.rankedEntries,
      followingSet
    });
    const context = buildContextSummary({
      nodes,
      rankedEntries: sections.rankedEntries
    });

    return {
      sections,
      evidence,
      people,
      context
    };
  }

  function buildPanelSections({ nodes, scoreById, relationshipById, followingSet, normalizedFollowingSet = null, excludedTweetIds, networkLimit = 5, topLimit = 10, humanOnly = false } = {}) {
    const safeNodes = Array.isArray(nodes) ? nodes : [];
    const followedLookup = normalizedFollowingSet instanceof Set
      ? normalizedFollowingSet
      : normalizeFollowingSet(followingSet);
    const excludedIds = normalizeExcludedTweetIds(excludedTweetIds);
    const rankedEntries = [];

    for (let i = 0; i < safeNodes.length; i += 1) {
      const tweet = safeNodes[i];
      if (!tweet || !tweet.id || tweet.type === "repost_event" || excludedIds.has(String(tweet.id))) {
        continue;
      }
      if (!hasReplyOrQuoteRelation(tweet)) {
        continue;
      }
      if (humanOnly && !isLikelyHumanAuthor(tweet)) {
        continue;
      }

      rankedEntries.push({
        id: tweet.id,
        tweet,
        score: readScore(scoreById, tweet.id),
        relationshipLabel: readRelationshipLabel(relationshipById, tweet.id),
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
      const isFollowed = isAuthorFollowed(entry.tweet, followedLookup);

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

  function createSection(root, title, entries, emptyText, evidenceByTweetId = null) {
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
        const targetTweetUrl = isAuthorThread
          ? (firstAuthorTweet?.url || null)
          : (tweet.url || null);

        const item = root.createElement("li");
        item.className = THREAD_CLASS;
        item.setAttribute("data-tweet-id", targetTweetId || "");

        const author = tweet.author || "@unknown";
        const profile = extractAuthorProfile(tweet);
        const profileImageUrl = typeof profile?.profile_image_url === "string"
          ? profile.profile_image_url.trim()
          : "";
        const text = truncateText(
          isAuthorThread
            ? (tweet.text || firstAuthorTweet?.text || "")
            : (tweet.text || "")
        );
        const score = Number.isFinite(entry.score) ? entry.score : 0;

        const titleNode = root.createElement("div");
        titleNode.className = "ariadex-card-header";

        if (profileImageUrl) {
          const avatar = root.createElement("img");
          avatar.src = profileImageUrl;
          avatar.alt = `${author} profile image`;
          avatar.loading = "lazy";
          avatar.width = 24;
          avatar.height = 24;
          avatar.className = "ariadex-avatar";
          titleNode.appendChild(avatar);
        }

        const authorBlock = root.createElement("div");
        authorBlock.className = "ariadex-card-author-block";
        const strong = root.createElement("strong");
        strong.className = "ariadex-card-author";
        strong.textContent = author;
        authorBlock.appendChild(strong);
        const meta = root.createElement("div");
        meta.className = "ariadex-card-meta";
        meta.textContent = isAuthorThread
          ? `Thread aggregate · score ${score.toFixed(3)}`
          : `${entry.relationshipLabel || "Cousin"} · score ${score.toFixed(3)}`;
        authorBlock.appendChild(meta);
        titleNode.appendChild(authorBlock);

        const snippet = root.createElement("div");
        snippet.className = "ariadex-snippet";
        snippet.textContent = text;

        const scoreLine = root.createElement("div");
        scoreLine.className = "ariadex-score";
        scoreLine.textContent = isAuthorThread
          ? "Collapsed author thread"
          : "Open in conversation";

        item.appendChild(titleNode);
        item.appendChild(snippet);
        item.appendChild(scoreLine);

        const tweetId = String(targetTweetId || "");
        const evidenceRefs = evidenceByTweetId instanceof Map
          ? (evidenceByTweetId.get(tweetId) || [])
          : [];
        if (evidenceRefs.length > 0) {
          const evidenceLine = root.createElement("div");
          evidenceLine.className = "ariadex-evidence-line";
          const topRefs = evidenceRefs.slice(0, 2);
          evidenceLine.textContent = topRefs.join(" · ");
          item.appendChild(evidenceLine);
        }

        item.addEventListener("click", () => {
          const scrolled = targetTweetId
            ? scrollToTweet(targetTweetId, { root })
            : false;

          navigateToTweet(root, targetTweetUrl, scrolled);
        });

        list.appendChild(item);
      }
    }

    section.appendChild(header);
    section.appendChild(list);
    return section;
  }

  function renderConversationPanel({
    nodes,
    scoreById,
    relationshipById,
    followingSet,
    excludedTweetIds,
    networkLimit = 5,
    topLimit = 10,
    humanOnly = false,
    statusMessage = "",
    loadingOnly = false,
    article = null,
    articleLoading = false,
    onGenerateArticle = null,
    onDownloadPdf = null,
    root = globalScope.document
  } = {}) {
    const panel = ensurePanelExists(root);
    const body = panel.querySelector(`.${PANEL_BODY_CLASS}`);
    if (!body) {
      return {
        fromNetwork: [],
        topThinkers: [],
        rankedEntries: []
      };
    }

    const normalizedFollowingSet = normalizeFollowingSet(followingSet);
    const viewModel = buildDexViewModel({
      nodes,
      scoreById,
      relationshipById,
      followingSet,
      excludedTweetIds,
      humanOnly,
      networkLimit,
      topLimit
    });
    const sections = viewModel.sections;
    const evidenceByTweetId = new Map();
    for (let i = 0; i < viewModel.evidence.length; i += 1) {
      const ev = viewModel.evidence[i];
      const domainOrUrl = ev.domain || ev.displayUrl;
      for (let j = 0; j < ev.topCitingTweetIds.length; j += 1) {
        const tweetId = String(ev.topCitingTweetIds[j]);
        if (!evidenceByTweetId.has(tweetId)) {
          evidenceByTweetId.set(tweetId, []);
        }
        evidenceByTweetId.get(tweetId).push(domainOrUrl);
      }
    }

    body.innerHTML = "";
    const fragment = root.createDocumentFragment();
    const header = panel.querySelector(`.${HEADER_CLASS}`);
    if (header) {
      const titleNode = header.querySelector(".ariadex-header-title");
      const metaNode = header.querySelector(`.${PANEL_HEADER_META_CLASS}`);
      if (titleNode) {
        titleNode.textContent = deriveConversationTitle(nodes, article);
      }
      if (metaNode) {
        metaNode.textContent = deriveConversationMeta(viewModel, nodes);
      }
    }
    if (statusMessage) {
      const statusNode = root.createElement("div");
      statusNode.className = STATUS_CLASS;
      statusNode.textContent = statusMessage;
      fragment.appendChild(statusNode);
    }
    if (!loadingOnly) {
      const state = ensurePanelState(panel);
      const shell = root.createElement("div");
      shell.className = PANEL_SHELL_CLASS;
      const tabBar = root.createElement("div");
      tabBar.className = `${TAB_BAR_CLASS} ${PANEL_NAV_CLASS}`;

      const tabContent = root.createElement("div");
      tabContent.className = `${PANEL_TAB_CONTENT_CLASS} ${PANEL_MAIN_CLASS}`;
      const footer = root.createElement("div");
      footer.className = PANEL_FOOTER_CLASS;

      const tabs = [
        { id: "context", label: "Context" },
        { id: "thinkers", label: "Branches" },
        { id: "evidence", label: "References" },
        { id: "people", label: "People" },
        { id: "digest", label: "Digest" }
      ];

      function renderTabContent(tabId) {
        tabContent.innerHTML = "";
        footer.innerHTML = "";
        if (tabId === "digest") {
          const card = root.createElement("div");
          card.className = `${DIGEST_CARD_CLASS} ${CARD_CLASS}`;

          if (articleLoading) {
            card.textContent = "Generating article and PDF…";
            tabContent.appendChild(card);
            return;
          }

          if (!article || typeof article !== "object") {
            const intro = root.createElement("div");
            intro.className = "ariadex-digest-intro";
            intro.textContent = "Generate a structured article digest from this conversation and download it as a PDF.";
            card.appendChild(intro);
            tabContent.appendChild(card);
            if (typeof onGenerateArticle === "function") {
              const button = root.createElement("button");
              button.type = "button";
              button.className = "ariadex-action-button ariadex-action-button-primary";
              button.textContent = "Digest";
              button.addEventListener("click", () => onGenerateArticle());
              footer.appendChild(button);
            }
            return;
          }

          const title = root.createElement("h3");
          title.className = SECTION_TITLE_CLASS;
          title.textContent = article.title || "Ariadex Digest";
          card.appendChild(title);

          if (article.dek) {
            const dek = root.createElement("div");
            dek.className = "ariadex-digest-dek";
            dek.textContent = article.dek;
            card.appendChild(dek);
          }

          if (article.summary) {
            const summary = root.createElement("div");
            summary.className = "ariadex-digest-summary";
            summary.textContent = article.summary;
            card.appendChild(summary);
          }

          const sections = Array.isArray(article.sections) ? article.sections : [];
          for (const section of sections) {
            const heading = root.createElement("h4");
            heading.className = SECTION_TITLE_CLASS;
            heading.textContent = section.heading || "Section";
            card.appendChild(heading);

            const bodyCopy = root.createElement("div");
            bodyCopy.className = "ariadex-digest-body";
            bodyCopy.style.whiteSpace = "pre-wrap";
            bodyCopy.textContent = section.body || "";
            card.appendChild(bodyCopy);
          }

          if (typeof onDownloadPdf === "function") {
            const download = root.createElement("button");
            download.type = "button";
            download.className = "ariadex-action-button";
            download.textContent = "Download PDF";
            download.addEventListener("click", () => onDownloadPdf());
            footer.appendChild(download);
          }
          if (typeof onGenerateArticle === "function") {
            const regenerate = root.createElement("button");
            regenerate.type = "button";
            regenerate.className = "ariadex-action-button ariadex-action-button-primary";
            regenerate.textContent = "Refresh Digest";
            regenerate.addEventListener("click", () => onGenerateArticle());
            footer.appendChild(regenerate);
          }

          tabContent.appendChild(card);
          return;
        }

        if (tabId === "evidence") {
          if (!Array.isArray(viewModel.evidence) || viewModel.evidence.length === 0) {
            const empty = root.createElement("div");
            empty.className = `${EVIDENCE_CARD_CLASS} ${EMPTY_CLASS} ${CARD_CLASS}`;
            empty.textContent = "No referenced documents found.";
            tabContent.appendChild(empty);
            return;
          }
          for (let i = 0; i < viewModel.evidence.length; i += 1) {
            const ev = viewModel.evidence[i];
            const card = root.createElement("div");
            card.className = `${EVIDENCE_CARD_CLASS} ${CARD_CLASS}`;
            const title = root.createElement("div");
            title.className = "ariadex-link-title";
            title.textContent = ev.displayUrl;
            const domain = root.createElement("div");
            domain.className = "ariadex-link-domain";
            domain.textContent = ev.domain || "external";
            const meta = root.createElement("div");
            meta.className = "ariadex-link-meta";
            meta.textContent = `${ev.citationCount} citations · score ${ev.weightedCitationScore.toFixed(3)}`;
            card.appendChild(title);
            card.appendChild(domain);
            card.appendChild(meta);
            card.addEventListener("click", () => {
              navigateToTweet(root, ev.canonicalUrl, false);
            });
            tabContent.appendChild(card);
          }
          return;
        }

        if (tabId === "people") {
          const followed = viewModel.people?.followed || [];
          const others = viewModel.people?.others || [];
          const renderPeopleGroup = (title, entries) => {
            const h = root.createElement("h3");
            h.className = SECTION_TITLE_CLASS;
            h.textContent = title;
            tabContent.appendChild(h);
            if (!entries.length) {
              const empty = root.createElement("div");
              empty.className = `${PEOPLE_CARD_CLASS} ${EMPTY_CLASS} ${CARD_CLASS}`;
              empty.textContent = "No entries.";
              tabContent.appendChild(empty);
              return;
            }
            for (let i = 0; i < entries.length && i < 10; i += 1) {
              const person = entries[i];
              const card = root.createElement("div");
              card.className = `${PEOPLE_CARD_CLASS} ${CARD_CLASS}`;
              card.textContent = `${person.author} · ${person.tweetsCount} tweets · aggregate ${person.aggregateScore.toFixed(3)}`;
              tabContent.appendChild(card);
            }
          };
          renderPeopleGroup("From your network", followed);
          renderPeopleGroup("Others", others);
          return;
        }

        if (tabId === "context") {
          const context = viewModel.context || {};
          const card = root.createElement("div");
          card.className = `${CONTEXT_CARD_CLASS} ${CARD_CLASS}`;
          card.textContent = `Tweets ${context.nodeCount || 0} · Ranked ${context.rankedCount || 0} · Replies ${context.replies || 0} · Quotes ${context.quotes || 0} · Cousins ${context.cousins || 0}`;
          tabContent.appendChild(card);
          return;
        }

        const networkEmptyText = normalizedFollowingSet.size === 0
          ? "Following set is empty. Configure following IDs/handles to populate this section."
          : "No ranked tweets from followed accounts.";
        tabContent.appendChild(
          createSection(root, "From your network", sections.fromNetwork, networkEmptyText, evidenceByTweetId)
        );
        tabContent.appendChild(
          createSection(root, "Reading path", sections.topThinkers, "No ranked tweets available.", evidenceByTweetId)
        );
      }

      for (let i = 0; i < tabs.length; i += 1) {
        const tab = tabs[i];
        const btn = root.createElement("button");
        btn.type = "button";
        btn.className = TAB_BUTTON_CLASS;
        btn.textContent = tab.label;
        if (state.activeTab === tab.id) {
          btn.classList.add(TAB_BUTTON_ACTIVE_CLASS);
        }
        btn.addEventListener("click", () => {
          state.activeTab = tab.id;
          const buttons = tabBar.querySelectorAll(`.${TAB_BUTTON_CLASS}`);
          for (const b of buttons) {
            b.classList.remove(TAB_BUTTON_ACTIVE_CLASS);
          }
          btn.classList.add(TAB_BUTTON_ACTIVE_CLASS);
          renderTabContent(tab.id);
        });
        tabBar.appendChild(btn);
      }

      shell.appendChild(tabBar);
      shell.appendChild(tabContent);
      shell.appendChild(footer);
      fragment.appendChild(shell);
      renderTabContent(state.activeTab || DEFAULT_TAB);
    }

    body.appendChild(fragment);
    return {
      ...sections,
      viewModel
    };
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
    buildDexViewModel,
    canonicalizeUrl,
    extractUrlsFromText,
    navigateToTweet,
    renderConversationPanel,
    renderTopThreads
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globalScope.AriadexUIPanelRenderer = api;
  }
})();
