const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { createSelectorLabServer } = require("../scripts/selector_lab_server.js");
const { upsertFixtureRecord } = require("../research/fixture_catalog.js");

function invokeServer(server, { method, url, bodyText = "" }) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter();
    req.method = method;
    req.url = url;
    req.headers = {
      "content-type": "application/json"
    };
    req.setEncoding = () => {};

    const headers = {};
    let statusCode = null;
    let payload = "";
    const res = {
      setHeader(name, value) {
        headers[String(name).toLowerCase()] = value;
      },
      writeHead(nextStatusCode, nextHeaders = {}) {
        statusCode = nextStatusCode;
        for (const [name, value] of Object.entries(nextHeaders)) {
          headers[String(name).toLowerCase()] = value;
        }
      },
      end(chunk = "") {
        payload += String(chunk || "");
        resolve({
          statusCode,
          headers,
          payload
        });
      }
    };

    try {
      server.emit("request", req, res);
    } catch (error) {
      reject(error);
      return;
    }

    process.nextTick(() => {
      if (bodyText) {
        req.emit("data", bodyText);
      }
      req.emit("end");
    });
  });
}

test("selector lab exposes catalog, selectors, and run api", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ariadex-lab-"));
  const catalogPath = path.join(tempDir, "catalog.json");
  const fixturePath = path.join(tempDir, "fixture.json");

  const fixtureDocument = {
    fixtureType: "full_conversation_graph",
    capturedAt: "2026-03-24T03:00:00.000Z",
    conversation: {
      clickedTweetId: "seed",
      canonicalRootId: "root",
      rootTweet: { id: "root", text: "Root tweet" },
      tweets: [
        {
          id: "root",
          text: "Root tweet with enough substance and a reference to https://example.com/report.pdf",
          author: "@root",
          author_profile: { public_metrics: { followers_count: 10 } }
        },
        {
          id: "seed",
          text: "Explored tweet with enough substance and a linked tweet https://x.com/example/status/42?s=20",
          author: "@seed",
          reply_to: "root",
          likes: 10,
          author_profile: { public_metrics: { followers_count: 5 } }
        }
      ],
      users: [],
      warnings: []
    }
  };
  await fs.writeFile(fixturePath, `${JSON.stringify(fixtureDocument, null, 2)}\n`, "utf8");
  await upsertFixtureRecord({
    catalogPath,
    fixtureDocument,
    fixturePath
  });

  const server = createSelectorLabServer({ catalogPath });

  const catalogResponse = await invokeServer(server, {
    method: "GET",
    url: "/api/catalog"
  });
  const catalog = JSON.parse(catalogResponse.payload);
  assert.equal(catalog.fixtures.length, 1);

  const selectorsResponse = await invokeServer(server, {
    method: "GET",
    url: "/api/selectors"
  });
  const selectors = JSON.parse(selectorsResponse.payload);
  assert.ok(selectors.some((entry) => entry.algorithmId === "path_anchored_v1"));

  const runResponse = await invokeServer(server, {
    method: "POST",
    url: "/api/run",
    bodyText: JSON.stringify({
      fixturePath,
      exploredTweetId: "seed",
      algorithmId: "path_anchored_v1",
      params: {}
    })
  });
  const run = JSON.parse(runResponse.payload);
  assert.equal(runResponse.statusCode, 200);
  assert.equal(run.algorithmId, "path_anchored_v1");
  assert.equal(run.artifact.exploredTweetId, "seed");
  assert.equal(run.artifact.mandatoryPath[0].pathRole, "canonical_root");
  assert.equal(run.artifact.mandatoryPath[1].pathRole, "explored_tweet");
  assert.ok(Array.isArray(run.references.external));
  assert.ok(Array.isArray(run.references.tweets));
  assert.ok(Array.isArray(run.people));
  assert.ok(run.people.some((person) => person.author === "@seed"));
});
