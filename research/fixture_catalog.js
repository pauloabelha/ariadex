"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_FIXTURE_DIR = path.join(process.cwd(), "research", "fixtures", "full_graphs");
const DEFAULT_CATALOG_PATH = path.join(process.cwd(), "research", "db", "fixture_catalog.json");

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function summarizeFixtureDocument(document = {}, fixturePath = null) {
  const conversation = document?.conversation && typeof document.conversation === "object"
    ? document.conversation
    : {};
  const rootTweet = conversation?.rootTweet && typeof conversation.rootTweet === "object" ? conversation.rootTweet : null;
  const tweets = Array.isArray(conversation?.tweets) ? conversation.tweets : [];
  const exploredTweet = tweets.find((tweet) => String(tweet?.id || "") === String(conversation?.clickedTweetId || "")) || null;

  return {
    fixturePath: fixturePath ? path.resolve(fixturePath) : null,
    fixtureType: String(document?.fixtureType || ""),
    capturedAt: document?.capturedAt || null,
    exploredTweetId: String(conversation?.clickedTweetId || "").trim() || null,
    rootHintTweetId: String(conversation?.rootHintTweetId || "").trim() || null,
    canonicalRootId: String(conversation?.canonicalRootId || "").trim() || null,
    tweetCount: Number(conversation?.tweetCount || tweets.length || 0),
    userCount: Number(conversation?.userCount || (Array.isArray(conversation?.users) ? conversation.users.length : 0)),
    rootTextPreview: String(rootTweet?.text || "").trim().slice(0, 140),
    exploredTextPreview: String(exploredTweet?.text || "").trim().slice(0, 140)
  };
}

function normalizeCatalog(catalog = {}) {
  const fixtures = Array.isArray(catalog?.fixtures) ? catalog.fixtures : [];
  return {
    schemaVersion: 1,
    updatedAt: catalog?.updatedAt || null,
    fixtures
  };
}

async function loadCatalog(catalogPath = DEFAULT_CATALOG_PATH) {
  return normalizeCatalog(await readJson(path.resolve(catalogPath), { schemaVersion: 1, fixtures: [] }));
}

async function upsertFixtureRecord({ catalogPath = DEFAULT_CATALOG_PATH, fixtureDocument, fixturePath }) {
  const resolvedCatalogPath = path.resolve(catalogPath);
  const record = summarizeFixtureDocument(fixtureDocument, fixturePath);
  const catalog = await loadCatalog(resolvedCatalogPath);
  const fixtures = catalog.fixtures.filter((entry) => String(entry?.fixturePath || "") !== String(record.fixturePath || ""));
  fixtures.push(record);
  fixtures.sort((a, b) => {
    const left = String(a?.capturedAt || "");
    const right = String(b?.capturedAt || "");
    return right.localeCompare(left);
  });
  const next = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    fixtures
  };
  await writeJson(resolvedCatalogPath, next);
  return next;
}

async function syncCatalogFromFixtures({ fixtureDir = DEFAULT_FIXTURE_DIR, catalogPath = DEFAULT_CATALOG_PATH } = {}) {
  const resolvedFixtureDir = path.resolve(fixtureDir);
  let entries = [];
  try {
    entries = await fs.readdir(resolvedFixtureDir, { withFileTypes: true });
  } catch {
    const empty = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      fixtures: []
    };
    await writeJson(path.resolve(catalogPath), empty);
    return empty;
  }

  const fixtures = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const fullPath = path.join(resolvedFixtureDir, entry.name);
    const document = await readJson(fullPath, null);
    if (!document || String(document?.fixtureType || "") !== "full_conversation_graph") {
      continue;
    }
    fixtures.push(summarizeFixtureDocument(document, fullPath));
  }

  fixtures.sort((a, b) => String(b?.capturedAt || "").localeCompare(String(a?.capturedAt || "")));
  const next = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    fixtures
  };
  await writeJson(path.resolve(catalogPath), next);
  return next;
}

module.exports = {
  DEFAULT_CATALOG_PATH,
  DEFAULT_FIXTURE_DIR,
  loadCatalog,
  summarizeFixtureDocument,
  syncCatalogFromFixtures,
  upsertFixtureRecord
};
