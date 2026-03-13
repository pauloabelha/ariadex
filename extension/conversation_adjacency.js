(() => {
  "use strict";

  const DEFAULT_EDGE_WEIGHTS = {
    reply: 1.0,
    quote: 1.3
  };

  const DEFAULT_ALLOWED_EDGE_TYPES = ["reply", "quote"];

  function safeNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }

  function normalizeMetrics(node) {
    return {
      replies: Math.max(0, safeNumber(node?.replies)),
      reposts: Math.max(0, safeNumber(node?.reposts)),
      likes: Math.max(0, safeNumber(node?.likes)),
      quote_count: Math.max(0, safeNumber(node?.quote_count))
    };
  }

  function normalizeOptions(options = {}) {
    const edgeWeights = {
      ...DEFAULT_EDGE_WEIGHTS,
      ...(options.edgeWeights || {})
    };

    const allowedEdgeTypes = Array.isArray(options.allowedEdgeTypes) && options.allowedEdgeTypes.length > 0
      ? options.allowedEdgeTypes
      : DEFAULT_ALLOWED_EDGE_TYPES;

    const allowedTypeSet = new Set(allowedEdgeTypes.map((type) => String(type || "").toLowerCase()).filter(Boolean));

    return {
      edgeWeights,
      allowedTypeSet
    };
  }

  function createConversationAdjacency(graph, options = {}) {
    const config = normalizeOptions(options);
    const nodes = new Map();
    const incomingEdges = new Map();
    const outgoingEdges = new Map();
    const nodeOrder = [];

    const rawNodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
    for (const rawNode of rawNodes) {
      const id = rawNode && rawNode.id != null ? String(rawNode.id) : null;
      if (!id || nodes.has(id)) {
        continue;
      }

      const normalizedNode = {
        id,
        author_id: rawNode?.author_id || null,
        author: rawNode?.author || null,
        text: typeof rawNode?.text === "string" ? rawNode.text : "",
        metrics: normalizeMetrics(rawNode),
        incoming_edges: [],
        outgoing_edges: [],
        raw: rawNode || { id }
      };

      nodes.set(id, normalizedNode);
      incomingEdges.set(id, normalizedNode.incoming_edges);
      outgoingEdges.set(id, normalizedNode.outgoing_edges);
      nodeOrder.push(id);
    }

    const dedupe = new Set();
    const edges = [];
    const rawEdges = Array.isArray(graph?.edges) ? graph.edges : [];

    for (const rawEdge of rawEdges) {
      if (!rawEdge) {
        continue;
      }

      const source = rawEdge.source != null ? String(rawEdge.source) : null;
      const target = rawEdge.target != null ? String(rawEdge.target) : null;
      const type = String(rawEdge.type || "").toLowerCase();

      if (!source || !target || source === target) {
        continue;
      }

      if (!config.allowedTypeSet.has(type)) {
        continue;
      }

      if (!nodes.has(source) || !nodes.has(target)) {
        continue;
      }

      const dedupeKey = `${source}|${target}|${type}`;
      if (dedupe.has(dedupeKey)) {
        continue;
      }
      dedupe.add(dedupeKey);

      const configuredWeight = safeNumber(config.edgeWeights[type], 1);
      const rawWeight = safeNumber(rawEdge.weight, configuredWeight);
      const weight = rawWeight > 0 ? rawWeight : configuredWeight;

      const edge = {
        source,
        target,
        type,
        weight
      };

      outgoingEdges.get(source).push(edge);
      incomingEdges.get(target).push(edge);
      edges.push(edge);
    }

    const outgoingWeightSums = new Map();
    for (const id of nodeOrder) {
      const out = outgoingEdges.get(id) || [];
      let sum = 0;
      for (const edge of out) {
        sum += edge.weight;
      }
      outgoingWeightSums.set(id, sum);
    }

    return {
      nodes,
      incomingEdges,
      outgoingEdges,
      outgoingWeightSums,
      edges,
      nodeOrder,
      nodeCount: nodeOrder.length,
      edgeCount: edges.length
    };
  }

  function validateConversationAdjacency(index) {
    const errors = [];
    if (!index || !(index.nodes instanceof Map)) {
      return ["nodes map is missing"];
    }

    for (const [id, node] of index.nodes.entries()) {
      if (!node || node.id !== id) {
        errors.push(`node id mismatch for ${id}`);
      }

      if (!Array.isArray(node?.incoming_edges) || !Array.isArray(node?.outgoing_edges)) {
        errors.push(`node edge arrays missing for ${id}`);
      }

      if (!(index.incomingEdges instanceof Map) || index.incomingEdges.get(id) !== node.incoming_edges) {
        errors.push(`incomingEdges map mismatch for ${id}`);
      }

      if (!(index.outgoingEdges instanceof Map) || index.outgoingEdges.get(id) !== node.outgoing_edges) {
        errors.push(`outgoingEdges map mismatch for ${id}`);
      }
    }

    for (const edge of Array.isArray(index.edges) ? index.edges : []) {
      if (!edge || !edge.source || !edge.target) {
        errors.push("edge missing endpoints");
        continue;
      }

      if (!index.nodes.has(edge.source) || !index.nodes.has(edge.target)) {
        errors.push(`edge points to unknown node: ${edge.source} -> ${edge.target}`);
      }

      if (!(edge.weight > 0)) {
        errors.push(`edge has non-positive weight: ${edge.source} -> ${edge.target}`);
      }
    }

    return errors;
  }

  const api = {
    DEFAULT_EDGE_WEIGHTS,
    DEFAULT_ALLOWED_EDGE_TYPES,
    normalizeMetrics,
    createConversationAdjacency,
    validateConversationAdjacency
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    window.AriadexConversationAdjacency = api;
  }
})();
