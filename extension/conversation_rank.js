(() => {
  "use strict";

  const adjacencyApi = typeof module !== "undefined" && module.exports
    ? require("./conversation_adjacency.js")
    : (window.AriadexConversationAdjacency || {});

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
    followingSet: null
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

    if (!Array.isArray(merged.allowedEdgeTypes) || merged.allowedEdgeTypes.length === 0) {
      merged.allowedEdgeTypes = [...DEFAULT_OPTIONS.allowedEdgeTypes];
    }

    return merged;
  }

  function normalizeFollowingSet(input) {
    if (!input) {
      return new Set();
    }

    if (input instanceof Set) {
      const normalized = new Set();
      for (const value of input) {
        if (value == null) {
          continue;
        }
        const normalizedValue = String(value).trim();
        if (normalizedValue) {
          normalized.add(normalizedValue);
        }
      }
      return normalized;
    }

    if (Array.isArray(input)) {
      const normalized = new Set();
      for (const value of input) {
        if (value == null) {
          continue;
        }
        const normalizedValue = String(value).trim();
        if (normalizedValue) {
          normalized.add(normalizedValue);
        }
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

  function buildBaseScores(index, followingSet, config) {
    const n = index.nodeOrder.length;
    const baseScores = new Float64Array(n);
    let total = 0;

    for (let i = 0; i < n; i += 1) {
      const id = index.nodeOrder[i];
      const node = index.nodes.get(id);
      const rawNode = node?.raw || {};
      const base = isFollowedAuthor(followingSet, rawNode)
        ? config.followedAuthorWeight
        : config.defaultAuthorWeight;

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

  function prepareIterationData(index) {
    const nodeOrder = index.nodeOrder;
    const idToIndex = new Map();
    const incomingByTarget = new Array(nodeOrder.length);
    const outgoingWeightSums = new Float64Array(nodeOrder.length);

    for (let i = 0; i < nodeOrder.length; i += 1) {
      const id = nodeOrder[i];
      idToIndex.set(id, i);
      incomingByTarget[i] = [];
      outgoingWeightSums[i] = Number(index.outgoingWeightSums.get(id) || 0);
    }

    for (const edge of index.edges) {
      const sourceIndex = idToIndex.get(edge.source);
      const targetIndex = idToIndex.get(edge.target);

      if (sourceIndex == null || targetIndex == null) {
        continue;
      }

      incomingByTarget[targetIndex].push({
        sourceIndex,
        weight: edge.weight
      });
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
    const baseScores = buildBaseScores(index, followingSet, config);
    const { incomingByTarget, outgoingWeightSums } = prepareIterationData(index);

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
    window.AriadexConversationRank = api;
  }
})();
