(() => {
  "use strict";

  const DEFAULT_OPTIONS = {
    damping: 0.85,
    maxIterations: 30,
    tolerance: 1e-6,
    edgeWeights: {
      reply: 1.0,
      quote: 1.25,
      repost: 0.75
    },
    engagementWeights: {
      replies: 2.0,
      reposts: 1.5,
      likes: 1.0
    },
    engagementPriorStrength: 0.2
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

    merged.damping = Math.min(Math.max(merged.damping, 0), 1);
    merged.maxIterations = Math.max(1, Math.floor(merged.maxIterations));
    merged.tolerance = Math.max(0, merged.tolerance);

    return merged;
  }

  function prepareGraph(graph) {
    const nodes = Array.isArray(graph?.nodes) ? graph.nodes.filter((node) => node && node.id) : [];
    const nodeById = new Map(nodes.map((node) => [node.id, node]));

    const edges = Array.isArray(graph?.edges)
      ? graph.edges.filter((edge) => edge && nodeById.has(edge.source) && nodeById.has(edge.target) && edge.source !== edge.target)
      : [];

    return {
      nodes,
      nodeById,
      edges
    };
  }

  function safeNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  }

  function computeEngagementScore(node, engagementWeights) {
    const replies = Math.max(0, safeNumber(node?.replies));
    const reposts = Math.max(0, safeNumber(node?.reposts));
    const likes = Math.max(0, safeNumber(node?.likes));
    const typeBoost = node?.type === "author_thread" ? 1.15 : 1.0;

    const weighted = (
      replies * (engagementWeights.replies ?? 0)
      + reposts * (engagementWeights.reposts ?? 0)
      + likes * (engagementWeights.likes ?? 0)
    ) * typeBoost;

    // log1p softens heavy-tail engagement counts.
    return Math.log1p(Math.max(0, weighted));
  }

  function computeNodePriors(nodes, config) {
    const base = 1;
    const priors = new Map();
    let total = 0;

    for (const node of nodes) {
      const engagement = computeEngagementScore(node, config.engagementWeights);
      const prior = base + (config.engagementPriorStrength * engagement);
      priors.set(node.id, prior);
      total += prior;
    }

    if (total <= 0) {
      const uniform = 1 / Math.max(1, nodes.length);
      for (const node of nodes) {
        priors.set(node.id, uniform);
      }
      return priors;
    }

    for (const node of nodes) {
      priors.set(node.id, priors.get(node.id) / total);
    }

    return priors;
  }

  function buildEdgeMaps(nodes, edges, edgeWeights) {
    const incoming = new Map();
    const outgoingWeightedSums = new Map();

    for (const node of nodes) {
      incoming.set(node.id, []);
      outgoingWeightedSums.set(node.id, 0);
    }

    for (const edge of edges) {
      const weight = edgeWeights[edge.type] ?? 1;
      incoming.get(edge.target).push({ source: edge.source, weight });
      outgoingWeightedSums.set(edge.source, outgoingWeightedSums.get(edge.source) + weight);
    }

    return {
      incoming,
      outgoingWeightedSums
    };
  }

  function rankConversationGraph(graph, options = {}) {
    const config = normalizeOptions(options);
    const { nodes, edges } = prepareGraph(graph);

    if (nodes.length === 0) {
      return {
        scores: [],
        scoreById: {},
        topTweetIds: [],
        iterations: 0,
        converged: true
      };
    }

    const n = nodes.length;
    const baseScore = 1 / n;
    const { incoming, outgoingWeightedSums } = buildEdgeMaps(nodes, edges, config.edgeWeights);
    const nodePriors = computeNodePriors(nodes, config);
    const inputOrder = new Map(nodes.map((node, index) => [node.id, index]));

    let current = new Map(nodes.map((node) => [node.id, baseScore]));
    let converged = false;
    let iterationsUsed = 0;

    for (let iter = 0; iter < config.maxIterations; iter += 1) {
      iterationsUsed = iter + 1;

      let danglingMass = 0;
      for (const node of nodes) {
        if ((outgoingWeightedSums.get(node.id) || 0) === 0) {
          danglingMass += current.get(node.id) || 0;
        }
      }

      const next = new Map();
      let delta = 0;

      for (const node of nodes) {
        const incomingEdges = incoming.get(node.id) || [];
        let incomingMass = 0;

        for (const edge of incomingEdges) {
          const sourceScore = current.get(edge.source) || 0;
          const sourceOut = outgoingWeightedSums.get(edge.source) || 0;
          if (sourceOut > 0) {
            incomingMass += sourceScore * (edge.weight / sourceOut);
          }
        }

        const value = (1 - config.damping) * (nodePriors.get(node.id) || 0)
          + (config.damping * incomingMass)
          + (config.damping * danglingMass / n);

        next.set(node.id, value);
        delta += Math.abs(value - (current.get(node.id) || 0));
      }

      current = next;

      if (delta <= config.tolerance) {
        converged = true;
        break;
      }
    }

    if (!converged && iterationsUsed === config.maxIterations) {
      converged = false;
    }

    const scores = nodes
      .map((node) => ({
        id: node.id,
        score: current.get(node.id) || 0,
        prior: nodePriors.get(node.id) || 0,
        engagement: computeEngagementScore(node, config.engagementWeights),
        tweet: node
      }))
      .sort((a, b) => {
        const scoreDiff = b.score - a.score;
        if (Math.abs(scoreDiff) > 1e-9) {
          return scoreDiff;
        }

        const priorDiff = b.prior - a.prior;
        if (Math.abs(priorDiff) > 1e-9) {
          return priorDiff;
        }

        const engagementDiff = b.engagement - a.engagement;
        if (Math.abs(engagementDiff) > 1e-9) {
          return engagementDiff;
        }

        return (inputOrder.get(a.id) || 0) - (inputOrder.get(b.id) || 0);
      });

    const scoreById = {};
    for (const scoreEntry of scores) {
      scoreById[scoreEntry.id] = scoreEntry.score;
    }

    return {
      scores,
      scoreById,
      topTweetIds: scores.map((entry) => entry.id),
      iterations: iterationsUsed,
      converged,
      scoreSpread: scores.length > 1 ? scores[0].score - scores[scores.length - 1].score : 0
    };
  }

  const api = {
    rankConversationGraph
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    window.AriadexConversationRank = api;
  }
})();
