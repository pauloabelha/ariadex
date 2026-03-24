"use strict";

const pathAnchored = require("./path_anchored_v1.js");
const expandAll = require("./expand_all_v0.js");
const quotaPerParent = require("./quota_per_parent_v0.js");
const threadContext = require("./thread_context_v0.js");

const SELECTORS = {
  [pathAnchored.algorithmId]: pathAnchored,
  [expandAll.algorithmId]: expandAll,
  [quotaPerParent.algorithmId]: quotaPerParent,
  [threadContext.algorithmId]: threadContext
};

const DEFAULT_SELECTOR_ID = pathAnchored.algorithmId;

function listSelectorDefinitions() {
  return Object.values(SELECTORS).map((definition) => ({
    algorithmId: definition.algorithmId,
    label: definition.label,
    description: definition.description,
    defaultParams: {
      ...(definition.defaultParams || {})
    }
  }));
}

function getSelectorDefinition(algorithmId = DEFAULT_SELECTOR_ID) {
  const normalized = String(algorithmId || DEFAULT_SELECTOR_ID).trim();
  const definition = SELECTORS[normalized];
  if (!definition) {
    throw new Error(`Unknown selector algorithm: ${normalized}`);
  }
  return definition;
}

function runRegisteredSelector({ algorithmId = DEFAULT_SELECTOR_ID, dataset, clickedTweetId = null, rootHintTweetId = null, params = {} } = {}) {
  const definition = getSelectorDefinition(algorithmId);
  const selection = definition.select({
    dataset,
    clickedTweetId,
    rootHintTweetId,
    params
  });
  return {
    ...selection,
    algorithmId: definition.algorithmId,
    label: definition.label,
    description: definition.description
  };
}

module.exports = {
  DEFAULT_SELECTOR_ID,
  getSelectorDefinition,
  listSelectorDefinitions,
  runRegisteredSelector
};
