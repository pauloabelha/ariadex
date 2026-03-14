(() => {
  "use strict";

  const globalScope = typeof globalThis !== "undefined" ? globalThis : {};

  const adjacencyApi = typeof module !== "undefined" && module.exports
    ? require("./conversation_adjacency.js")
    : (globalScope.AriadexCoreConversationAdjacency || {});

  const createConversationAdjacency = typeof adjacencyApi.createConversationAdjacency === "function"
    ? adjacencyApi.createConversationAdjacency
    : () => ({
      nodes: new Map(),
      incomingEdges: new Map(),
      outgoingEdges: new Map(),
      outgoingWeightSums: new Map(),
      edges: [],
      nodeOrder: [],
      nodeCount: 0,
      edgeCount: 0
    });

  const DEFAULT_OPTIONS = {
    damping: 0.85,
    minIterations: 10,
    maxIterations: 20,
    tolerance: 1e-6,
    edgeWeights: {
      reply: 1.0,
      quote: 1.3
    },
    allowedEdgeTypes: ["reply", "quote"],
    followedAuthorWeight: 2.0,
    defaultAuthorWeight: 1.0,
    followingSet: null,
    reachWeight: 0.6,
    edgeReachBoost: 0.45,
    followerWeight: 0.4
  };

  function normalizeOptions(options = {}) {
    const merged = {
      ...DEFAULT_OPTIONS,
      ...options,
      edgeWeights: {
        ...DEFAULT_OPTIONS.edgeWeights,
        ...(options.edgeWeights || {})
      }
    };

    merged.damping = Math.min(Math.max(Number(merged.damping) || 0, 0), 1);
    merged.minIterations = Math.max(1, Math.floor(Number(merged.minIterations) || 1));
    merged.maxIterations = Math.max(merged.minIterations, Math.floor(Number(merged.maxIterations) || merged.minIterations));
    merged.tolerance = Math.max(0, Number(merged.tolerance) || 0);
    merged.followedAuthorWeight = Math.max(0, Number(merged.followedAuthorWeight) || 0);
    merged.defaultAuthorWeight = Math.max(0, Number(merged.defaultAuthorWeight) || 0);
    merged.reachWeight = Math.max(0, Number(merged.reachWeight) || 0);
    merged.edgeReachBoost = Math.max(0, Number(merged.edgeReachBoost) || 0);
    merged.followerWeight = Math.max(0, Number(merged.followerWeight) || 0);

    if (!Array.isArray(merged.allowedEdgeTypes) || merged.allowedEdgeTypes.length === 0) {
      merged.allowedEdgeTypes = [...DEFAULT_OPTIONS.allowedEdgeTypes];
    }

    return merged;
  }

  function readMetric(rawNode, primaryKey, fallbackKey) {
    const metrics = rawNode?.metrics || {};
    const fromMetrics = Number(metrics?.[primaryKey]);
    if (Number.isFinite(fromMetrics) && fromMetrics >= 0) {
      return fromMetrics;
    }

    const fromFallback = Number(rawNode?.[fallbackKey]);
    if (Number.isFinite(fromFallback) && fromFallback >= 0) {
      return fromFallback;
    }

    return 0;
  }

  function buildReachSignals(index) {
    const n = index.nodeOrder.length;
    const signals = new Float64Array(n);
    let maxSignal = 0;

    for (let i = 0; i < n; i += 1) {
      const id = index.nodeOrder[i];
      const node = index.nodes.get(id);
      const rawNode = node?.raw || {};

      const likes = readMetric(rawNode, "like_count", "likes");
      const reposts = readMetric(rawNode, "retweet_count", "reposts");
      const replies = readMetric(rawNode, "reply_count", "replies");
      const quotes = readMetric(rawNode, "quote_count", "quote_count");

      const weightedReach = (likes * 1.0)
        + (reposts * 2.0)
        + (replies * 2.3)
        + (quotes * 2.7);
      const signal = Math.log1p(Math.max(0, weightedReach));
      signals[i] = signal;
      if (signal > maxSignal) {
        maxSignal = signal;
      }
    }

    if (maxSignal <= 0) {
      return signals;
    }

    for (let i = 0; i < n; i += 1) {
      signals[i] /= maxSignal;
    }
    return signals;
  }

  function readFollowerCount(rawNode) {
    const profileFollowers = Number(rawNode?.author_profile?.public_metrics?.followers_count);
    if (Number.isFinite(profileFollowers) && profileFollowers >= 0) {
      return profileFollowers;
    }

    const fallbackFollowers = Number(rawNode?.followers_count);
    if (Number.isFinite(fallbackFollowers) && fallbackFollowers >= 0) {
      return fallbackFollowers;
    }

    return 0;
  }

  function buildFollowerSignals(index) {
    const n = index.nodeOrder.length;
    const signals = new Float64Array(n);
    let maxSignal = 0;

    for (let i = 0; i < n; i += 1) {
      const id = index.nodeOrder[i];
      const node = index.nodes.get(id);
      const rawNode = node?.raw || {};
      const followers = readFollowerCount(rawNode);
      const signal = Math.log1p(Math.max(0, followers));
      signals[i] = signal;
      if (signal > maxSignal) {
        maxSignal = signal;
      }
    }

    if (maxSignal <= 0) {
      return signals;
    }

    for (let i = 0; i < n; i += 1) {
      signals[i] /= maxSignal;
    }

    return signals;
  }

  function normalizeFollowingSet(input) {
    const addNormalizedValue = (target, value) => {
      const normalizedValue = String(value).trim();
      if (!normalizedValue) {
        return;
      }
      target.add(normalizedValue);
      const lowered = normalizedValue.toLowerCase();
      target.add(lowered);
      if (lowered.startsWith("@")) {
        target.add(lowered.slice(1));
      }
    };

    if (!input) {
      return new Set();
    }

    if (input instanceof Set) {
      const normalized = new Set();
      for (const value of input) {
        if (value == null) {
          continue;
        }
        addNormalizedValue(normalized, value);
      }
      return normalized;
    }

    if (Array.isArray(input)) {
      const normalized = new Set();
      for (const value of input) {
        if (value == null) {
          continue;
        }
        addNormalizedValue(normalized, value);
      }
      return normalized;
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

  function isFollowedAuthor(followingSet, rawNode) {
    const authorId = rawNode?.author_id != null ? String(rawNode.author_id).trim() : "";
    if (authorId && (followingSet.has(authorId) || followingSet.has(authorId.toLowerCase()))) {
      return true;
    }

    const handle = normalizeHandle(rawNode?.author);
    if (!handle) {
      return false;
    }

    return followingSet.has(handle) || followingSet.has(handle.slice(1));
  }

  function buildBaseScores(index, followingSet, config, reachSignals, followerSignals) {
    const n = index.nodeOrder.length;
    const baseScores = new Float64Array(n);
    let total = 0;

    for (let i = 0; i < n; i += 1) {
      const id = index.nodeOrder[i];
      const node = index.nodes.get(id);
      const rawNode = node?.raw || {};
      const authorBase = isFollowedAuthor(followingSet, rawNode)
        ? config.followedAuthorWeight
        : config.defaultAuthorWeight;
      const reachFactor = 1 + (config.reachWeight * (reachSignals[i] || 0));
      const followerFactor = 1 + (config.followerWeight * (followerSignals[i] || 0));
      const base = authorBase * reachFactor * followerFactor;

      baseScores[i] = base;
      total += base;
    }

    if (total <= 0) {
      const uniform = n > 0 ? 1 / n : 0;
      for (let i = 0; i < n; i += 1) {
        baseScores[i] = uniform;
      }
      return baseScores;
    }

    for (let i = 0; i < n; i += 1) {
      baseScores[i] /= total;
    }

    return baseScores;
  }

  function prepareIterationData(index, config, reachSignals) {
    const nodeOrder = index.nodeOrder;
    const idToIndex = new Map();
    const incomingByTarget = new Array(nodeOrder.length);
    const outgoingWeightSums = new Float64Array(nodeOrder.length);

    for (let i = 0; i < nodeOrder.length; i += 1) {
      const id = nodeOrder[i];
      idToIndex.set(id, i);
      incomingByTarget[i] = [];
      outgoingWeightSums[i] = 0;
    }

    for (const edge of index.edges) {
      const sourceIndex = idToIndex.get(edge.source);
      const targetIndex = idToIndex.get(edge.target);

      if (sourceIndex == null || targetIndex == null) {
        continue;
      }

      const sourceReachFactor = 1 + (config.edgeReachBoost * (reachSignals[sourceIndex] || 0));
      const adjustedWeight = edge.weight * sourceReachFactor;

      incomingByTarget[targetIndex].push({
        sourceIndex,
        weight: adjustedWeight
      });
      outgoingWeightSums[sourceIndex] += adjustedWeight;
    }

    return {
      idToIndex,
      incomingByTarget,
      outgoingWeightSums
    };
  }

  function rankConversationGraph(graph, options = {}) {
    const config = normalizeOptions(options);
    const index = createConversationAdjacency(graph, {
      edgeWeights: config.edgeWeights,
      allowedEdgeTypes: config.allowedEdgeTypes
    });

    const n = index.nodeOrder.length;
    if (n === 0) {
      return {
        scores: [],
        scoreById: new Map(),
        scoreByIdObject: {},
        topTweetIds: [],
        iterations: 0,
        converged: true,
        scoreSpread: 0,
        graphIndex: index
      };
    }

    const followingSet = normalizeFollowingSet(config.followingSet);
    const reachSignals = buildReachSignals(index);
    const followerSignals = buildFollowerSignals(index);
    const baseScores = buildBaseScores(index, followingSet, config, reachSignals, followerSignals);
    const { incomingByTarget, outgoingWeightSums } = prepareIterationData(index, config, reachSignals);

    const current = new Float64Array(n);
    const initial = 1 / n;
    for (let i = 0; i < n; i += 1) {
      current[i] = initial;
    }

    let iterationsUsed = 0;
    let converged = false;

    for (let iter = 0; iter < config.maxIterations; iter += 1) {
      iterationsUsed = iter + 1;

      let danglingMass = 0;
      for (let i = 0; i < n; i += 1) {
        if (outgoingWeightSums[i] <= 0) {
          danglingMass += current[i];
        }
      }

      const next = new Float64Array(n);
      let delta = 0;

      for (let i = 0; i < n; i += 1) {
        let incomingMass = 0;
        const incomingEdges = incomingByTarget[i];

        for (let j = 0; j < incomingEdges.length; j += 1) {
          const edge = incomingEdges[j];
          const sourceOut = outgoingWeightSums[edge.sourceIndex];
          if (sourceOut > 0) {
            incomingMass += current[edge.sourceIndex] * (edge.weight / sourceOut);
          }
        }

        const nextValue = (1 - config.damping) * baseScores[i]
          + config.damping * (incomingMass + (danglingMass / n));

        next[i] = nextValue;
        delta += Math.abs(nextValue - current[i]);
      }

      for (let i = 0; i < n; i += 1) {
        current[i] = next[i];
      }

      if (iterationsUsed >= config.minIterations && delta <= config.tolerance) {
        converged = true;
        break;
      }
    }

    const scores = index.nodeOrder.map((id, i) => ({
      id,
      score: current[i],
      baseScore: baseScores[i],
      reachSignal: reachSignals[i],
      followerSignal: followerSignals[i],
      inputIndex: i,
      tweet: index.nodes.get(id)?.raw || { id }
    }));

    scores.sort((a, b) => {
      const scoreDiff = b.score - a.score;
      if (Math.abs(scoreDiff) > 1e-12) {
        return scoreDiff;
      }

      const baseDiff = b.baseScore - a.baseScore;
      if (Math.abs(baseDiff) > 1e-12) {
        return baseDiff;
      }

      if (a.inputIndex !== b.inputIndex) {
        return a.inputIndex - b.inputIndex;
      }

      return String(a.id).localeCompare(String(b.id));
    });

    const scoreById = new Map();
    const scoreByIdObject = {};

    for (const entry of scores) {
      scoreById.set(entry.id, entry.score);
      scoreByIdObject[entry.id] = entry.score;
    }

    return {
      scores,
      scoreById,
      scoreByIdObject,
      topTweetIds: scores.map((entry) => entry.id),
      iterations: iterationsUsed,
      converged,
      scoreSpread: scores.length > 1 ? scores[0].score - scores[scores.length - 1].score : 0,
      graphIndex: index
    };
  }

  const api = {
    rankConversationGraph,
    normalizeFollowingSet
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globalScope.AriadexCoreConversationRank = api;
  }
})();
