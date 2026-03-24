"use strict";

const { buildPathAnchoredSelection, DEFAULT_OPTIONS } = require("../../server/path_anchored_snapshot.js");

const ALGORITHM_ID = "path_anchored_v1";

function select({ dataset, clickedTweetId = null, rootHintTweetId = null, params = {} } = {}) {
  const selection = buildPathAnchoredSelection(dataset, {
    clickedTweetId,
    rootHintTweetId,
    ...params
  });

  return {
    ...selection,
    algorithmId: ALGORITHM_ID,
    params: {
      ...DEFAULT_OPTIONS,
      ...(params || {})
    }
  };
}

module.exports = {
  algorithmId: ALGORITHM_ID,
  defaultParams: {
    ...DEFAULT_OPTIONS
  },
  label: "Path Anchored",
  description: "Current bounded path-first selector used by Ariadex.",
  select
};
