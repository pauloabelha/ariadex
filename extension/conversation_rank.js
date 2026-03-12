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
    }
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

        const value = ((1 - config.damping) / n)
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
        tweet: node
      }))
      .sort((a, b) => b.score - a.score);

    const scoreById = {};
    for (const scoreEntry of scores) {
      scoreById[scoreEntry.id] = scoreEntry.score;
    }

    return {
      scores,
      scoreById,
      topTweetIds: scores.map((entry) => entry.id),
      iterations: iterationsUsed,
      converged
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
