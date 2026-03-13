(() => {
  "use strict";

  const globalScope = typeof globalThis !== "undefined" ? globalThis : {};

  function normalizeAuthor(author) {
    return String(author || "").trim().toLowerCase();
  }

  function dedupeEdges(edges) {
    const seen = new Set();
    const deduped = [];

    for (const edge of edges || []) {
      if (!edge || !edge.source || !edge.target || edge.source === edge.target) {
        continue;
      }

      const key = `${edge.source}|${edge.target}|${edge.type || "reply"}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push({ source: edge.source, target: edge.target, type: edge.type || "reply" });
    }

    return deduped;
  }

  function collapseAuthorThread(graph) {
    const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
    const edges = Array.isArray(graph?.edges) ? graph.edges : [];

    if (!graph || nodes.length === 0 || !graph.root) {
      return graph;
    }

    const rootAuthor = graph.root.author;
    const rootAuthorNorm = normalizeAuthor(rootAuthor);
    if (!rootAuthorNorm) {
      return graph;
    }

    const authorNodes = nodes.filter((node) => {
      if (!node || node.type === "author_thread") {
        return false;
      }
      return normalizeAuthor(node.author) === rootAuthorNorm;
    });

    if (authorNodes.length <= 1) {
      return graph;
    }

    const collapsedIds = new Set(authorNodes.map((node) => node.id).filter(Boolean));

    let threadId = `author_thread:${rootAuthorNorm}`;
    let suffix = 1;
    const allNodeIds = new Set(nodes.map((node) => node?.id).filter(Boolean));
    while (allNodeIds.has(threadId)) {
      threadId = `author_thread:${rootAuthorNorm}:${suffix}`;
      suffix += 1;
    }

    const threadNode = {
      id: threadId,
      type: "author_thread",
      author: rootAuthor,
      tweets: authorNodes,
      text: graph.root.text || authorNodes[0]?.text || "",
      url: graph.root.url || authorNodes[0]?.url || null
    };

    const firstAuthorIndex = nodes.findIndex((node) => node && collapsedIds.has(node.id));
    const remainingNodes = nodes.filter((node) => !node || !collapsedIds.has(node.id));

    const newNodes = [...remainingNodes];
    const insertionIndex = firstAuthorIndex >= 0 ? Math.min(firstAuthorIndex, newNodes.length) : 0;
    newNodes.splice(insertionIndex, 0, threadNode);

    const remappedEdges = edges.map((edge) => {
      if (!edge) {
        return edge;
      }

      const source = collapsedIds.has(edge.source) ? threadId : edge.source;
      const target = collapsedIds.has(edge.target) ? threadId : edge.target;
      return {
        source,
        target,
        type: edge.type || "reply"
      };
    });

    const newRootId = collapsedIds.has(graph.rootId) ? threadId : graph.rootId;
    const newRoot = normalizeAuthor(graph.root.author) === rootAuthorNorm ? threadNode : graph.root;

    return {
      ...graph,
      rootId: newRootId,
      root: newRoot,
      nodes: newNodes,
      edges: dedupeEdges(remappedEdges)
    };
  }

  const api = {
    collapseAuthorThread
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globalScope.AriadexCoreThreadCollapse = api;
  }
})();
