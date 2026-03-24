"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const xApiClient = require("./x_api_client.js");

function normalizeConversationDataset(dataset = {}, source = {}) {
  const tweets = Array.isArray(dataset?.tweets) ? dataset.tweets.filter((tweet) => Boolean(tweet && tweet.id)) : [];
  const users = Array.isArray(dataset?.users) ? dataset.users.filter((user) => Boolean(user && user.id)) : [];
  const warnings = Array.isArray(dataset?.warnings) ? dataset.warnings.map((warning) => String(warning)) : [];
  const canonicalRootId = String(dataset?.canonicalRootId || "").trim() || null;
  const clickedTweetId = String(dataset?.clickedTweetId || source?.clickedTweetId || "").trim() || null;
  const rootHintTweetId = String(dataset?.rootHintTweetId || source?.rootHintTweetId || "").trim() || null;
  const rootTweet = dataset?.rootTweet && dataset.rootTweet.id
    ? dataset.rootTweet
    : (canonicalRootId ? (tweets.find((tweet) => String(tweet.id) === canonicalRootId) || null) : null);

  return {
    canonicalRootId,
    clickedTweetId,
    rootHintTweetId,
    rootTweet,
    tweets,
    users,
    warnings,
    source: {
      kind: String(source?.kind || dataset?.source?.kind || "unknown"),
      path: source?.path ? path.resolve(String(source.path)) : null,
      mode: source?.mode ? String(source.mode) : null
    }
  };
}

async function loadConversationDatasetFromXApi(options = {}) {
  const dataset = await xApiClient.buildConversationDataset(options);
  return normalizeConversationDataset(dataset, {
    kind: "x_api",
    clickedTweetId: options.clickedTweetId,
    rootHintTweetId: options.rootHintTweetId,
    mode: options.mode || null
  });
}

async function collectConversationDatasetForCanonicalRoot(options = {}) {
  const warnings = [];
  const collected = await xApiClient.collectConnectedApiTweets({
    rootTweetId: options.canonicalRootId,
    client: options.client,
    followingSet: options.followingSet || new Set(),
    onWarning: (message) => {
      warnings.push(String(message));
      if (typeof options.onWarning === "function") {
        options.onWarning(message);
      }
    },
    onProgress: options.onProgress
  });

  return normalizeConversationDataset({
    canonicalRootId: options.canonicalRootId,
    clickedTweetId: options.clickedTweetId || null,
    rootHintTweetId: options.rootHintTweetId || null,
    rootTweet: collected.tweets.find((tweet) => String(tweet?.id || "") === String(options.canonicalRootId || "")) || null,
    tweets: collected.tweets,
    users: collected.users,
    warnings
  }, {
    kind: "x_api",
    clickedTweetId: options.clickedTweetId,
    rootHintTweetId: options.rootHintTweetId,
    mode: options.mode || null
  });
}

function fixtureDocumentToDataset(document = {}, source = {}) {
  const conversation = document?.conversation && typeof document.conversation === "object"
    ? document.conversation
    : document;

  return normalizeConversationDataset({
    canonicalRootId: conversation?.canonicalRootId || null,
    clickedTweetId: conversation?.clickedTweetId || null,
    rootHintTweetId: conversation?.rootHintTweetId || null,
    rootTweet: conversation?.rootTweet || null,
    tweets: Array.isArray(conversation?.tweets) ? conversation.tweets : [],
    users: Array.isArray(conversation?.users) ? conversation.users : [],
    warnings: Array.isArray(conversation?.warnings) ? conversation.warnings : []
  }, {
    kind: "fixture",
    path: source?.path || null,
    mode: document?.source?.mode || source?.mode || null
  });
}

async function loadConversationDatasetFromFixtureFile(filePath) {
  const resolvedPath = path.resolve(String(filePath || ""));
  if (!resolvedPath) {
    throw new Error("Missing fixture file path");
  }
  const raw = await fs.readFile(resolvedPath, "utf8");
  const parsed = raw ? JSON.parse(raw) : {};
  return fixtureDocumentToDataset(parsed, { path: resolvedPath });
}

async function loadConversationDataset(options = {}) {
  const kind = String(options?.kind || options?.source?.kind || "").trim().toLowerCase();

  if (kind === "fixture") {
    if (options.document) {
      return fixtureDocumentToDataset(options.document, {
        path: options.path || null,
        mode: options.mode || null
      });
    }
    return loadConversationDatasetFromFixtureFile(options.path);
  }

  if (kind === "x_api" || !kind) {
    return loadConversationDatasetFromXApi(options);
  }

  throw new Error(`Unsupported conversation dataset source: ${kind}`);
}

module.exports = {
  normalizeConversationDataset,
  loadConversationDatasetFromXApi,
  collectConversationDatasetForCanonicalRoot,
  fixtureDocumentToDataset,
  loadConversationDatasetFromFixtureFile,
  loadConversationDataset
};
