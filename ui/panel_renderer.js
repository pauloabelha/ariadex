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
  const SVG_NS = "http://www.w3.org/2000/svg";

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

    parsed.username = "";
    parsed.password = "";
    parsed.hash = "";
    if ((parsed.protocol === "https:" && parsed.port === "443") || (parsed.protocol === "http:" && parsed.port === "80")) {
      parsed.port = "";
    }
    const blockedParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "utm_id",
      "utm_name",
      "fbclid",
      "gclid",
      "igshid",
      "mc_cid",
      "mc_eid",
      "ref",
      "ref_src",
      "s",
      "si"
    ];
    for (const param of blockedParams) {
      parsed.searchParams.delete(param);
    }

    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    if (host === "x.com" || host === "twitter.com") {
      const statusMatch = pathname.match(/^\/([^/]+)\/status\/(\d+)/);
      if (statusMatch) {
        return `https://x.com/${statusMatch[1]}/status/${statusMatch[2]}`;
      }
    }
    if (host === "youtu.be") {
      const videoId = pathname.replace(/^\//, "");
      return videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;
    }
    if (host === "www.youtube.com" || host === "youtube.com") {
      if (pathname === "/watch") {
        const videoId = parsed.searchParams.get("v");
        return videoId ? `https://www.youtube.com/watch?v=${videoId}` : "https://www.youtube.com/watch";
      }
    }
    if (host === "arxiv.org") {
      const pdfMatch = pathname.match(/^\/pdf\/([^/]+?)(?:\.pdf)?$/);
      if (pdfMatch) {
        return `https://arxiv.org/abs/${pdfMatch[1]}`;
      }
    }

    const normalizedSearch = parsed.searchParams.toString();
    return `${parsed.protocol}//${host}${pathname}${normalizedSearch ? `?${normalizedSearch}` : ""}`;
  }

  function isExternalEvidenceUrl(rawUrl) {
    const canonical = canonicalizeUrl(rawUrl);
    if (!canonical) {
      return false;
    }

    try {
      const parsed = new URL(canonical);
      const host = String(parsed.hostname || "").toLowerCase();
      const pathname = String(parsed.pathname || "").toLowerCase();
      if (host === "t.co") {
        return false;
      }
      if ((host === "x.com" || host === "twitter.com") && /^\/i\/article\/\d+/.test(pathname)) {
        return true;
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
      const urls = [
        ...extractUrlsFromText(tweet?.text || ""),
        ...(Array.isArray(tweet?.external_urls) ? tweet.external_urls : [])
      ];
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

  function buildPeopleEntries({ rankedEntries, nodes, scoreById, followingSet, alwaysIncludeTweetIds = [] } = {}) {
    const followed = normalizeFollowingSet(followingSet);
    const ranked = Array.isArray(rankedEntries) ? rankedEntries : [];
    const safeNodes = Array.isArray(nodes) ? nodes : [];
    const byAuthorId = new Map();

    function addPersonEntry(entry) {
      const tweet = entry?.tweet || {};
      const authorId = String(tweet?.author_id || "").trim();
      const author = String(tweet?.author || "@unknown").trim() || "@unknown";
      const key = authorId || author.toLowerCase();
      if (!key) {
        return;
      }
      let person = byAuthorId.get(key);
      if (!person) {
        const profile = extractAuthorProfile(tweet);
        person = {
          id: key,
          author_id: authorId || null,
          author,
          profile,
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
      if (!person.profile) {
        person.profile = extractAuthorProfile(tweet);
      }
      if (entryScore > person.bestScore) {
        person.bestTweetId = entry.id;
        person.bestScore = entryScore;
      }
      person.isFollowed = person.isFollowed || isAuthorFollowed(tweet, followed);
    }

    for (let i = 0; i < ranked.length; i += 1) {
      addPersonEntry(ranked[i]);
    }

    const alwaysIncludeIds = new Set(
      (Array.isArray(alwaysIncludeTweetIds) ? alwaysIncludeTweetIds : [])
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    );
    for (const tweet of safeNodes) {
      const tweetId = String(tweet?.id || "").trim();
      if (!tweetId || !alwaysIncludeIds.has(tweetId)) {
        continue;
      }
      addPersonEntry({
        id: tweetId,
        tweet,
        score: readScore(scoreById, tweetId)
      });
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

  function buildLogSummary({ snapshotMeta, nodes, rankedEntries } = {}) {
    const diagnostics = snapshotMeta?.diagnostics || {};
    const filter = diagnostics?.filter || {};
    const ranking = diagnostics?.ranking || {};
    const pathAnchored = snapshotMeta?.pathAnchored || {};
    const pathDiagnostics = pathAnchored?.diagnostics || diagnostics?.pathAnchored || {};
    const artifact = pathAnchored?.artifact || null;
    const safeNodes = Array.isArray(nodes) ? nodes : [];
    const safeRankedEntries = Array.isArray(rankedEntries) ? rankedEntries : [];
    const cache = snapshotMeta?.cache || null;
    const warnings = Array.isArray(snapshotMeta?.warnings) ? snapshotMeta.warnings : [];

    let replyEdges = 0;
    let quoteEdges = 0;
    for (let i = 0; i < safeNodes.length; i += 1) {
      const tweet = safeNodes[i];
      if (tweet?.reply_to) {
        replyEdges += 1;
      }
      if (tweet?.quote_of) {
        quoteEdges += 1;
      }
    }

    return [
      { label: "Cache", value: cache?.hit ? "hit" : "miss" },
      { label: "Explored tweet", value: artifact?.exploredTweetId || snapshotMeta?.clickedTweetId || "unknown" },
      { label: "Canonical root", value: snapshotMeta?.canonicalRootId || artifact?.canonicalRootId || "unknown" },
      { label: "Collected tweets", value: Number.isFinite(Number(filter?.inputTweetCount)) ? String(filter.inputTweetCount) : String(safeNodes.length) },
      { label: "Selected tweets", value: Number.isFinite(Number(pathDiagnostics?.selectedTweetCount)) ? String(pathDiagnostics.selectedTweetCount) : String(safeNodes.length) },
      { label: "Ranked entries", value: Number.isFinite(Number(ranking?.rankingCount)) ? String(ranking.rankingCount) : String(safeRankedEntries.length) },
      { label: "Ancestor path", value: Number.isFinite(Number(pathDiagnostics?.mandatoryPathLength)) ? String(pathDiagnostics.mandatoryPathLength) : String(Array.isArray(pathAnchored?.mandatoryPathIds) ? pathAnchored.mandatoryPathIds.length : 0) },
      { label: "Expansion levels", value: artifact ? String(Array.isArray(artifact.expansions) ? artifact.expansions.length : 0) : String(Array.isArray(pathAnchored?.expansions) ? pathAnchored.expansions.length : 0) },
      { label: "Reply edges", value: String(replyEdges) },
      { label: "Quote edges", value: String(quoteEdges) },
      { label: "References", value: Number.isFinite(Number(pathDiagnostics?.referenceCount)) ? String(pathDiagnostics.referenceCount) : String(Array.isArray(pathAnchored?.references) ? pathAnchored.references.length : 0) },
      { label: "Warnings", value: String(warnings.length) }
    ];
  }

  function inferParentTweetId(tweet) {
    if (!tweet || typeof tweet !== "object") {
      return null;
    }
    if (tweet.quoteOf || tweet.quote_of) {
      return String(tweet.quoteOf || tweet.quote_of);
    }
    if (tweet.replyTo || tweet.reply_to) {
      return String(tweet.replyTo || tweet.reply_to);
    }
    const refs = Array.isArray(tweet.referenced_tweets) ? tweet.referenced_tweets : [];
    const quoted = refs.find((ref) => ref?.type === "quoted" && ref?.id);
    if (quoted?.id) {
      return String(quoted.id);
    }
    const replied = refs.find((ref) => ref?.type === "replied_to" && ref?.id);
    if (replied?.id) {
      return String(replied.id);
    }
    return null;
  }

  function inferRelationType(tweet, relationshipLabel = "") {
    if (!tweet || typeof tweet !== "object") {
      return "reply";
    }
    if (tweet.quoteOf || tweet.quote_of) {
      return "quote";
    }
    if (tweet.replyTo || tweet.reply_to) {
      return "reply";
    }
    const refs = Array.isArray(tweet.referenced_tweets) ? tweet.referenced_tweets : [];
    if (refs.some((ref) => ref?.type === "quoted")) {
      return "quote";
    }
    if (refs.some((ref) => ref?.type === "replied_to")) {
      return "reply";
    }
    return String(relationshipLabel || "").toLowerCase() === "quote" ? "quote" : "reply";
  }

  function buildBranchGraphModel({ rankedEntries, snapshotMeta } = {}) {
    const artifact = snapshotMeta?.pathAnchored?.artifact || null;
    const mandatoryPath = Array.isArray(artifact?.mandatoryPath) ? artifact.mandatoryPath : [];
    const expansions = Array.isArray(artifact?.expansions) ? artifact.expansions : [];
    const exploredTweetId = String(artifact?.exploredTweetId || snapshotMeta?.clickedTweetId || "").trim();
    const nodeById = new Map();
    const mandatoryPathIds = mandatoryPath.map((tweet) => String(tweet?.id || "")).filter(Boolean);

    const includeTweet = (tweet, metadata = {}) => {
      const tweetId = String(tweet?.id || "").trim();
      if (!tweetId) {
        return;
      }
      const existing = nodeById.get(tweetId) || {};
      const parentId = metadata.parentId || inferParentTweetId(tweet) || existing.parentId || null;
      const relationType = metadata.relationType || inferRelationType(tweet, metadata.relationshipLabel || existing.relationshipLabel || "");
      const pathIndex = Number.isFinite(metadata.pathIndex) ? metadata.pathIndex : existing.pathIndex;
      const depth = Number.isFinite(metadata.depth) ? metadata.depth : existing.depth;
      const kind = metadata.kind
        || existing.kind
        || (tweetId === exploredTweetId
          ? "explored"
          : (Number.isFinite(pathIndex)
            ? (pathIndex === 0 ? "root" : "path")
            : (relationType === "quote" ? "quote" : "reply")));
      nodeById.set(tweetId, {
        ...existing,
        ...tweet,
        id: tweetId,
        parentId,
        relationType,
        relationshipLabel: metadata.relationshipLabel || existing.relationshipLabel || (relationType === "quote" ? "Quote" : "Reply"),
        kind,
        depth: Number.isFinite(depth) ? depth : 1,
        pathIndex
      });
    };

    for (let i = 0; i < mandatoryPath.length; i += 1) {
      includeTweet(mandatoryPath[i], {
        pathIndex: i,
        kind: i === 0 ? "root" : (String(mandatoryPath[i]?.id || "") === exploredTweetId ? "explored" : "path"),
        relationType: inferRelationType(mandatoryPath[i]),
        parentId: i > 0 ? String(mandatoryPath[i - 1]?.id || "") : null,
        depth: 0
      });
    }

    for (let i = 0; i < expansions.length; i += 1) {
      const level = expansions[i] || {};
      const tweets = Array.isArray(level.tweets) ? level.tweets : [];
      for (let j = 0; j < tweets.length; j += 1) {
        includeTweet(tweets[j], {
          depth: Number(level.depth) || 1,
          relationType: String(level.relationType || tweets[j]?.relationType || inferRelationType(tweets[j])).toLowerCase() === "quote" ? "quote" : "reply",
          kind: String(level.relationType || tweets[j]?.relationType || inferRelationType(tweets[j])).toLowerCase() === "quote" ? "quote" : "reply"
        });
      }
    }

    const safeRankedEntries = Array.isArray(rankedEntries) ? rankedEntries : [];
    for (let i = 0; i < safeRankedEntries.length; i += 1) {
      const entry = safeRankedEntries[i] || {};
      includeTweet(entry.tweet || {}, {
        relationshipLabel: entry.relationshipLabel,
        relationType: inferRelationType(entry.tweet || {}, entry.relationshipLabel)
      });
    }

    const nodes = [...nodeById.values()];
    const positionedById = new Map();
    const centerX = 212;
    const topPadding = 44;
    const rowGap = 92;
    const branchGap = 74;
    const branchOffsetBase = 126;
    const branchDepthOffset = 58;

    for (let i = 0; i < mandatoryPathIds.length; i += 1) {
      const tweetId = mandatoryPathIds[i];
      const node = nodeById.get(tweetId);
      if (!node) {
        continue;
      }
      positionedById.set(tweetId, {
        ...node,
        x: centerX,
        y: topPadding + (i * rowGap),
        pathIndex: i,
        depth: 0
      });
    }

    if (mandatoryPathIds.length === 0) {
      const fallbackNodes = nodes.slice(0, 8);
      for (let i = 0; i < fallbackNodes.length; i += 1) {
        const node = fallbackNodes[i];
        positionedById.set(node.id, {
          ...node,
          x: node.relationType === "quote" ? centerX + branchOffsetBase : centerX - branchOffsetBase,
          y: topPadding + (i * branchGap),
          depth: Math.max(1, Number(node.depth) || 1)
        });
      }
      if (fallbackNodes.length > 0) {
        const anchorId = fallbackNodes.find((node) => node.id === exploredTweetId)?.id || fallbackNodes[0].id;
        const anchor = positionedById.get(anchorId);
        if (anchor) {
          positionedById.set(anchorId, {
            ...anchor,
            x: centerX,
            kind: anchor.id === exploredTweetId ? "explored" : "root",
            depth: 0
          });
        }
      }
    }

    const childBuckets = new Map();
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (!node || mandatoryPathIds.includes(node.id)) {
        continue;
      }
      let parentId = String(node.parentId || "").trim();
      if (!parentId || !nodeById.has(parentId)) {
        parentId = mandatoryPathIds[mandatoryPathIds.length - 1] || exploredTweetId || mandatoryPathIds[0] || "";
      }
      if (!childBuckets.has(parentId)) {
        childBuckets.set(parentId, { reply: [], quote: [] });
      }
      const bucket = childBuckets.get(parentId);
      const side = node.relationType === "quote" ? "quote" : "reply";
      bucket[side].push(node);
    }

    const assignBranchSide = (parentId, side, direction) => {
      const bucket = childBuckets.get(parentId);
      const list = Array.isArray(bucket?.[side]) ? bucket[side] : [];
      const parent = positionedById.get(parentId);
      if (!parent) {
        return;
      }
      for (let i = 0; i < list.length; i += 1) {
        const node = list[i];
        const relativeOffset = (i - ((list.length - 1) / 2)) * branchGap;
        const depth = Math.max(1, Number(node.depth) || 1);
        positionedById.set(node.id, {
          ...node,
          x: centerX + (direction * (branchOffsetBase + ((depth - 1) * branchDepthOffset))),
          y: parent.y + relativeOffset,
          parentId,
          depth
        });
      }
    };

    for (const parentId of childBuckets.keys()) {
      assignBranchSide(parentId, "reply", -1);
      assignBranchSide(parentId, "quote", 1);
    }

    const positionedNodes = [...positionedById.values()].sort((a, b) => {
      if (a.y !== b.y) {
        return a.y - b.y;
      }
      return a.x - b.x;
    });

    const edges = [];
    for (let i = 1; i < mandatoryPathIds.length; i += 1) {
      const source = positionedById.get(mandatoryPathIds[i - 1]);
      const target = positionedById.get(mandatoryPathIds[i]);
      if (source && target) {
        edges.push({
          id: `path:${source.id}:${target.id}`,
          sourceId: source.id,
          targetId: target.id,
          kind: "path"
        });
      }
    }
    for (let i = 0; i < positionedNodes.length; i += 1) {
      const node = positionedNodes[i];
      if (!node.parentId || mandatoryPathIds.includes(node.id) || !positionedById.has(node.parentId)) {
        continue;
      }
      edges.push({
        id: `${node.relationType}:${node.parentId}:${node.id}`,
        sourceId: node.parentId,
        targetId: node.id,
        kind: node.relationType === "quote" ? "quote" : "reply"
      });
    }

    const maxY = positionedNodes.reduce((max, node) => Math.max(max, node.y), topPadding);
    const minY = positionedNodes.reduce((min, node) => Math.min(min, node.y), topPadding);

    return {
      nodes: positionedNodes,
      edges,
      exploredTweetId: exploredTweetId || mandatoryPathIds[mandatoryPathIds.length - 1] || "",
      mandatoryPathIds,
      viewBox: {
        width: 424,
        height: Math.max(280, (maxY - minY) + 120)
      }
    };
  }

  function createBranchGraphSection({ root, graphModel, selectedTweetId, onSelectTweet, onOpenTweet }) {
    const wrapper = root.createElement("section");
    wrapper.className = SECTION_CLASS;

    const heading = root.createElement("h3");
    heading.className = SECTION_TITLE_CLASS;
    heading.textContent = "Conversation graph";
    wrapper.appendChild(heading);

    if (!graphModel || !Array.isArray(graphModel.nodes) || graphModel.nodes.length === 0) {
      const empty = root.createElement("div");
      empty.className = `${CARD_CLASS} ${EMPTY_CLASS}`;
      empty.textContent = "No branch graph available.";
      wrapper.appendChild(empty);
      return wrapper;
    }

    const shell = root.createElement("div");
    shell.className = "ariadex-branch-shell";

    const graphCard = root.createElement("div");
    graphCard.className = `${CARD_CLASS} ariadex-branch-graph-card`;

    const legend = root.createElement("div");
    legend.className = "ariadex-branch-legend";
    const legendItems = [
      ["Root", "root"],
      ["Explored", "explored"],
      ["Reply", "reply"],
      ["Quote", "quote"]
    ];
    for (let i = 0; i < legendItems.length; i += 1) {
      const item = root.createElement("div");
      item.className = "ariadex-branch-legend-item";
      const swatch = root.createElement("span");
      swatch.className = `ariadex-branch-legend-swatch ariadex-branch-node-${legendItems[i][1]}`;
      const label = root.createElement("span");
      label.textContent = legendItems[i][0];
      item.appendChild(swatch);
      item.appendChild(label);
      legend.appendChild(item);
    }
    graphCard.appendChild(legend);

    const svg = root.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "ariadex-branch-graph-svg");
    svg.setAttribute("viewBox", `0 0 ${graphModel.viewBox.width} ${graphModel.viewBox.height}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMin meet");

    const defs = root.createElementNS(SVG_NS, "defs");
    const gradient = root.createElementNS(SVG_NS, "linearGradient");
    gradient.setAttribute("id", "ariadex-path-glow");
    gradient.setAttribute("x1", "0%");
    gradient.setAttribute("x2", "0%");
    gradient.setAttribute("y1", "0%");
    gradient.setAttribute("y2", "100%");
    const stopA = root.createElementNS(SVG_NS, "stop");
    stopA.setAttribute("offset", "0%");
    stopA.setAttribute("stop-color", "#4c5bd4");
    const stopB = root.createElementNS(SVG_NS, "stop");
    stopB.setAttribute("offset", "100%");
    stopB.setAttribute("stop-color", "#e06b5f");
    gradient.appendChild(stopA);
    gradient.appendChild(stopB);
    defs.appendChild(gradient);
    svg.appendChild(defs);

    const positionedById = new Map(graphModel.nodes.map((node) => [node.id, node]));
    const selectedNode = positionedById.get(String(selectedTweetId || "")) || positionedById.get(graphModel.exploredTweetId) || graphModel.nodes[0];

    for (let i = 0; i < graphModel.edges.length; i += 1) {
      const edge = graphModel.edges[i];
      const source = positionedById.get(edge.sourceId);
      const target = positionedById.get(edge.targetId);
      if (!source || !target) {
        continue;
      }
      const path = root.createElementNS(SVG_NS, "path");
      const controlX = (source.x + target.x) / 2;
      const curve = edge.kind === "path"
        ? `M ${source.x} ${source.y} C ${source.x} ${source.y + 24}, ${target.x} ${target.y - 24}, ${target.x} ${target.y}`
        : `M ${source.x} ${source.y} C ${controlX} ${source.y}, ${controlX} ${target.y}, ${target.x} ${target.y}`;
      path.setAttribute("d", curve);
      path.setAttribute("class", `ariadex-branch-edge ariadex-branch-edge-${edge.kind}${selectedNode && (selectedNode.id === source.id || selectedNode.id === target.id) ? " ariadex-branch-edge-active" : ""}`);
      svg.appendChild(path);
    }

    for (let i = 0; i < graphModel.nodes.length; i += 1) {
      const node = graphModel.nodes[i];
      const group = root.createElementNS(SVG_NS, "g");
      const isSelected = selectedNode && selectedNode.id === node.id;
      group.setAttribute("class", `ariadex-branch-node-group${isSelected ? " ariadex-branch-node-group-selected" : ""}`);
      group.setAttribute("transform", `translate(${node.x}, ${node.y})`);
      group.setAttribute("role", "button");
      group.setAttribute("tabindex", "0");

      const halo = root.createElementNS(SVG_NS, "circle");
      halo.setAttribute("class", "ariadex-branch-node-halo");
      halo.setAttribute("r", isSelected ? "19" : "0");
      group.appendChild(halo);

      const circle = root.createElementNS(SVG_NS, "circle");
      circle.setAttribute("class", `ariadex-branch-node ariadex-branch-node-${node.kind}`);
      circle.setAttribute("r", node.kind === "explored" ? "10" : "8");
      group.appendChild(circle);

      const label = root.createElementNS(SVG_NS, "text");
      label.setAttribute("class", "ariadex-branch-node-label");
      label.setAttribute("text-anchor", node.x >= 212 ? "start" : "end");
      label.setAttribute("x", node.x >= 212 ? "16" : "-16");
      label.setAttribute("y", "4");
      label.textContent = String(node.author || "@unknown");
      group.appendChild(label);

      const activate = () => {
        if (typeof onSelectTweet === "function") {
          onSelectTweet(node.id);
        }
      };
      group.addEventListener("click", activate);
      group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate();
        }
      });
      svg.appendChild(group);
    }

    graphCard.appendChild(svg);
    shell.appendChild(graphCard);

    const detailCard = root.createElement("div");
    detailCard.className = `${CARD_CLASS} ariadex-branch-detail-card`;
    const relationLabel = selectedNode.kind === "root"
      ? "Root tweet"
      : (selectedNode.kind === "explored"
        ? "Explored tweet"
        : (selectedNode.relationType === "quote" ? "Quote branch" : "Reply branch"));
    const relation = root.createElement("div");
    relation.className = "ariadex-link-domain";
    relation.textContent = relationLabel;
    const authorHeader = root.createElement("div");
    authorHeader.className = "ariadex-card-header";
    const profile = extractAuthorProfile(selectedNode);
    const profileImageUrl = typeof profile?.profile_image_url === "string"
      ? profile.profile_image_url.trim()
      : "";
    if (profileImageUrl) {
      const avatar = root.createElement("img");
      avatar.src = profileImageUrl;
      avatar.alt = `${String(selectedNode.author || "@unknown")} profile image`;
      avatar.loading = "lazy";
      avatar.width = 28;
      avatar.height = 28;
      avatar.className = "ariadex-avatar";
      authorHeader.appendChild(avatar);
    }
    const author = root.createElement("div");
    author.className = "ariadex-card-author";
    author.textContent = String(selectedNode.author || "@unknown");
    authorHeader.appendChild(author);
    const text = root.createElement("div");
    text.className = "ariadex-snippet";
    text.textContent = truncateText(selectedNode.text || "", 280);
    const meta = root.createElement("div");
    meta.className = "ariadex-card-meta";
    meta.textContent = selectedNode.parentId
      ? `${selectedNode.relationType === "quote" ? "Quoted from" : "Replied to"} ${String(positionedById.get(selectedNode.parentId)?.author || "@unknown")}`
      : "Anchor of the current graph";
    detailCard.appendChild(relation);
    detailCard.appendChild(authorHeader);
    detailCard.appendChild(text);
    detailCard.appendChild(meta);

    if (typeof onOpenTweet === "function") {
      const openButton = root.createElement("button");
      openButton.type = "button";
      openButton.className = "ariadex-action-button ariadex-action-button-primary";
      openButton.textContent = "Open tweet";
      openButton.addEventListener("click", () => onOpenTweet(selectedNode));
      detailCard.appendChild(openButton);
    }

    shell.appendChild(detailCard);
    wrapper.appendChild(shell);
    return wrapper;
  }

  function createDigestNarrative(root, text) {
    const body = root.createElement("div");
    body.className = "ariadex-digest-body";
    body.textContent = `Ariadex: ${String(text || "").trim()}`;
    return body;
  }

  function createDigestQuote(root, tweet, label = "") {
    const wrap = root.createElement("div");
    wrap.className = "ariadex-digest-quote";

    if (label) {
      const labelNode = root.createElement("div");
      labelNode.className = "ariadex-digest-quote-label";
      labelNode.textContent = label;
      wrap.appendChild(labelNode);
    }

    const author = root.createElement("div");
    author.className = "ariadex-digest-quote-author";
    author.textContent = String(tweet?.author || "@unknown");
    wrap.appendChild(author);

    const text = root.createElement("div");
    text.className = "ariadex-digest-quote-text";
    text.textContent = String(tweet?.text || "").trim();
    wrap.appendChild(text);

    return wrap;
  }

  function renderStandardDigest(card, article, root) {
    const artifact = article?.input?.artifact || null;
    if (!artifact || !Array.isArray(artifact.mandatoryPath)) {
      return false;
    }

    const exploredTweetId = String(artifact.exploredTweetId || "");
    const mandatoryPath = artifact.mandatoryPath || [];
    const exploredTweet = mandatoryPath.find((tweet) => String(tweet?.id || "") === exploredTweetId)
      || artifact.selectedTweets?.find?.((tweet) => String(tweet?.id || "") === exploredTweetId)
      || null;
    const rootTweet = artifact.rootTweet || (mandatoryPath.length > 0 ? mandatoryPath[0] : null);
    const directParentTweet = mandatoryPath.length >= 2 ? mandatoryPath[mandatoryPath.length - 2] : null;
    const relationNarrative = (childTweet, parentTweet) => {
      if (!childTweet || !parentTweet) {
        return "";
      }
      const childAuthor = String(childTweet.author || "@unknown");
      const parentAuthor = String(parentTweet.author || "@unknown");
      if (childTweet.quoteOf && String(childTweet.quoteOf) === String(parentTweet.id || "")) {
        return `${childAuthor} quoted ${parentAuthor}.`;
      }
      if (childTweet.replyTo && String(childTweet.replyTo) === String(parentTweet.id || "")) {
        return `${childAuthor} replied to ${parentAuthor}.`;
      }
      return `${childAuthor} referenced ${parentAuthor}.`;
    };
    const relationshipText = (() => {
      if (!exploredTweet) {
        return "";
      }
      if (directParentTweet) {
        return relationNarrative(exploredTweet, directParentTweet);
      }
      if (exploredTweet.quoteOf || exploredTweet.replyTo) {
        return "This sits inside a larger chain of tweets that frames the exchange.";
      }
      return "This is where the digest begins.";
    })();

    const appendSection = (headingText) => {
      const heading = root.createElement("h4");
      heading.className = SECTION_TITLE_CLASS;
      heading.textContent = headingText;
      card.appendChild(heading);
    };

    if (exploredTweet) {
      appendSection("Original tweet");
      card.appendChild(createDigestNarrative(root, "Here is the tweet that was explored."));
      card.appendChild(createDigestQuote(root, exploredTweet, "Explored tweet"));
    }

    appendSection("Why this appeared");
    card.appendChild(createDigestNarrative(root, relationshipText || (article.summary || article.dek || "This digest follows the clicked tweet and the path above it.")));
    if (rootTweet && (!exploredTweet || String(rootTweet.id) !== String(exploredTweet.id))) {
      card.appendChild(createDigestQuote(root, rootTweet, "Root tweet"));
    }

    if (mandatoryPath.length > 1) {
      appendSection("Ancestor path");
      card.appendChild(createDigestNarrative(root, "Read this chain in order to hear how the conversation builds toward the explored tweet."));
      for (let i = 0; i < mandatoryPath.length; i += 1) {
        const tweet = mandatoryPath[i];
        const label = i === 0
          ? "Root"
          : (String(tweet?.id || "") === exploredTweetId ? "Explored tweet" : `Ancestor ${i}`);
        if (i > 0) {
          card.appendChild(createDigestNarrative(root, relationNarrative(tweet, mandatoryPath[i - 1])));
        }
        card.appendChild(createDigestQuote(root, tweet, label));
      }
    }

    const expansionTweets = [];
    for (const level of Array.isArray(artifact.expansions) ? artifact.expansions : []) {
      for (const tweet of Array.isArray(level?.tweets) ? level.tweets : []) {
        expansionTweets.push({
          ...tweet,
          depth: level?.depth || 0
        });
      }
    }

    if (expansionTweets.length > 0) {
      appendSection("Important replies and branches");
      card.appendChild(createDigestNarrative(root, "From there, these are the main replies and quote branches that add substance or shift the argument."));
      const topExpansionTweets = expansionTweets.slice(0, 8);
      for (let i = 0; i < topExpansionTweets.length; i += 1) {
        const tweet = topExpansionTweets[i];
        const label = tweet.relationType === "quote"
          ? `Quote branch · depth ${tweet.depth || 1}`
          : `Reply branch · depth ${tweet.depth || 1}`;
        card.appendChild(createDigestQuote(root, tweet, label));
      }
    }

    if (Array.isArray(article.references) && article.references.length > 0) {
      appendSection("Evidence");
      card.appendChild(createDigestNarrative(root, "These links and documents were cited along the path or in the selected branches."));
      for (const ref of article.references) {
        const refCard = root.createElement("div");
        refCard.className = "ariadex-card";
        const title = root.createElement("div");
        title.className = "ariadex-link-title";
        title.textContent = ref.displayUrl || ref.canonicalUrl || "";
        const meta = root.createElement("div");
        meta.className = "ariadex-link-meta";
        meta.textContent = `${ref.domain || "external"} · ${Number(ref.citationCount || 0)} citations`;
        refCard.appendChild(title);
        refCard.appendChild(meta);
        card.appendChild(refCard);
      }
    }

    if (article.summary) {
      appendSection("Digest summary");
      card.appendChild(createDigestNarrative(root, `Taken together, the thread reads like this:\n\n${article.summary}`));
    }

    return true;
  }

  function buildDexViewModel({ nodes, scoreById, relationshipById, followingSet, excludedTweetIds, networkLimit, topLimit, humanOnly, snapshotMeta } = {}) {
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
      nodes,
      scoreById,
      followingSet,
      alwaysIncludeTweetIds: snapshotMeta?.pathAnchored?.mandatoryPathIds || []
    });
    const context = buildContextSummary({
      nodes,
      rankedEntries: sections.rankedEntries
    });
    const log = buildLogSummary({
      snapshotMeta,
      nodes,
      rankedEntries: sections.rankedEntries
    });

    return {
      sections,
      evidence,
      people,
      context,
      log
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
    snapshotMeta = null,
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
      topLimit,
      snapshotMeta
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
        { id: "log", label: "Log" },
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

          const renderedStandardDigest = renderStandardDigest(card, article, root);
          if (!renderedStandardDigest) {
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
              const header = root.createElement("div");
              header.className = "ariadex-card-header";
              const profile = person.profile && typeof person.profile === "object" ? person.profile : null;
              const profileImageUrl = typeof profile?.profile_image_url === "string"
                ? profile.profile_image_url.trim()
                : "";
              if (profileImageUrl) {
                const avatar = root.createElement("img");
                avatar.src = profileImageUrl;
                avatar.alt = `${person.author} profile image`;
                avatar.loading = "lazy";
                avatar.width = 28;
                avatar.height = 28;
                avatar.className = "ariadex-avatar";
                header.appendChild(avatar);
              }

              const authorBlock = root.createElement("div");
              authorBlock.className = "ariadex-card-author-block";
              const authorLine = root.createElement("div");
              authorLine.className = "ariadex-card-author";
              authorLine.textContent = person.author;
              const metaLine = root.createElement("div");
              metaLine.className = "ariadex-card-meta";
              metaLine.textContent = `${person.tweetsCount} selected tweet${person.tweetsCount === 1 ? "" : "s"} considered · aggregate ${person.aggregateScore.toFixed(3)}`;
              authorBlock.appendChild(authorLine);
              authorBlock.appendChild(metaLine);
              header.appendChild(authorBlock);
              card.appendChild(header);
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

        if (tabId === "log") {
          const entries = Array.isArray(viewModel.log) ? viewModel.log : [];
          for (let i = 0; i < entries.length; i += 1) {
            const entry = entries[i] || {};
            const card = root.createElement("div");
            card.className = `${CONTEXT_CARD_CLASS} ${CARD_CLASS}`;
            const label = root.createElement("div");
            label.className = "ariadex-link-domain";
            label.textContent = entry.label || "Metric";
            const value = root.createElement("div");
            value.className = "ariadex-link-title";
            value.textContent = entry.value || "0";
            card.appendChild(label);
            card.appendChild(value);
            tabContent.appendChild(card);
          }
          return;
        }

        const graphModel = buildBranchGraphModel({
          rankedEntries: sections.rankedEntries,
          snapshotMeta
        });
        if (!state.activeGraphTweetId) {
          state.activeGraphTweetId = graphModel.exploredTweetId || graphModel.mandatoryPathIds?.[graphModel.mandatoryPathIds.length - 1] || "";
        }
        tabContent.appendChild(createBranchGraphSection({
          root,
          graphModel,
          selectedTweetId: state.activeGraphTweetId,
          onSelectTweet: (tweetId) => {
            state.activeGraphTweetId = String(tweetId || "");
            renderTabContent("thinkers");
          },
          onOpenTweet: (tweet) => {
            const targetTweetId = String(tweet?.id || "");
            const targetTweetUrl = String(tweet?.url || "").trim() || null;
            const scrolled = targetTweetId
              ? scrollToTweet(targetTweetId, { root })
              : false;
            navigateToTweet(root, targetTweetUrl, scrolled);
          }
        }));
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
