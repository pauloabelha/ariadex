(() => {
  "use strict";

  const globalScope = typeof globalThis !== "undefined" ? globalThis : {};

  const conversationGraphApi = typeof module !== "undefined" && module.exports
    ? require("./conversation_graph.js")
    : (globalScope.AriadexCoreConversationGraph || {});
  const threadCollapseApi = typeof module !== "undefined" && module.exports
    ? require("./thread_collapse.js")
    : (globalScope.AriadexCoreThreadCollapse || {});
  const conversationRankApi = typeof module !== "undefined" && module.exports
    ? require("./conversation_rank.js")
    : (globalScope.AriadexCoreConversationRank || {});

  const buildConversationGraph = typeof conversationGraphApi.buildConversationGraph === "function"
    ? conversationGraphApi.buildConversationGraph
    : () => ({ rootId: null, nodes: [], edges: [], root: null, children: [] });
  const collapseAuthorThread = typeof threadCollapseApi.collapseAuthorThread === "function"
    ? threadCollapseApi.collapseAuthorThread
    : (graph) => graph;
  const rankConversationGraph = typeof conversationRankApi.rankConversationGraph === "function"
    ? conversationRankApi.rankConversationGraph
    : () => ({ scores: [], scoreById: new Map(), topTweetIds: [] });

  function runConversationEngine({ tweets, rankOptions = {}, collapseThreads = true } = {}) {
    const safeTweets = Array.isArray(tweets) ? tweets : [];
    const graph = buildConversationGraph(safeTweets);
    const collapsedGraph = collapseThreads ? collapseAuthorThread(graph) : graph;
    const rankingResult = rankConversationGraph(collapsedGraph, rankOptions);

    return {
      rootId: collapsedGraph.rootId,
      root: collapsedGraph.root,
      nodes: collapsedGraph.nodes,
      edges: collapsedGraph.edges,
      ranking: Array.isArray(rankingResult?.scores) ? rankingResult.scores : [],
      rankingMeta: rankingResult || { scores: [] }
    };
  }

  const api = {
    runConversationEngine,
    buildConversationGraph,
    collapseAuthorThread,
    rankConversationGraph
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globalScope.AriadexConversationEngine = api;
  }
})();
