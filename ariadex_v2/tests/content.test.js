const test = require("node:test");
const assert = require("node:assert/strict");

const content = require("../extension/content.js");
require("../extension/dev_env_loader.js");

global.window = {
  localStorage: {
    getItem(key) {
      return key === "ariadex.x_api_bearer_token" ? "test-token" : "";
    }
  }
};

test("baseLabelForIndex names root explored and ancestors", () => {
  assert.equal(content.baseLabelForIndex({ id: "1" }, 0, "3"), "Root");
  assert.equal(content.baseLabelForIndex({ id: "3" }, 3, "3"), "Explored");
  assert.equal(content.baseLabelForIndex({ id: "2" }, 2, "3"), "Ancestor 2");
});

test("relationLabel formats quote and reply against parent labels", () => {
  const clickedId = "30";
  assert.equal(
    content.relationLabel({ id: "30", outboundRelation: "quote" }, { id: "20" }, 2, clickedId),
    "quoted Ancestor 2"
  );
  assert.equal(
    content.relationLabel({ id: "20", outboundRelation: "reply" }, { id: "10" }, 1, clickedId),
    "replied to Ancestor 1"
  );
  assert.equal(
    content.relationLabel({ id: "10", outboundRelation: "reply" }, { id: "1" }, 0, clickedId),
    "replied to Root"
  );
});

test("relationLabel falls back to the raw relation type for unknown edge labels", () => {
  assert.equal(
    content.relationLabel({ id: "2", outboundRelation: "mention" }, { id: "1" }, 0, "9"),
    "mention Root"
  );
  assert.equal(content.relationLabel({ id: "2" }, { id: "1" }, 0, "9"), "");
});

test("buildPathEntries creates stable readable titles", () => {
  const entries = content.buildPathEntries([
    { id: "10", outboundRelation: "", referenceNumbers: [] },
    { id: "20", outboundRelation: "reply", referenceNumbers: [1] },
    { id: "30", outboundRelation: "quote", referenceNumbers: [1, 2] }
  ], "30");

  assert.deepEqual(entries.map((entry) => entry.title), [
    "Root",
    "Ancestor 1 (replied to Root)",
    "Explored (quoted Ancestor 1)"
  ]);
});

test("buildPathEntries returns new objects instead of mutating the original artifact", () => {
  const path = [
    { id: "10", outboundRelation: "" },
    { id: "20", outboundRelation: "reply" }
  ];

  const entries = content.buildPathEntries(path, "20");

  assert.notEqual(entries[0], path[0]);
  assert.equal(path[0].title, undefined);
  assert.equal(entries[1].title, "Explored (replied to Root)");
});

test("buildReferenceBadgeText formats reference markers", () => {
  assert.equal(content.buildReferenceBadgeText([]), "");
  assert.equal(content.buildReferenceBadgeText([1]), "[1]");
  assert.equal(content.buildReferenceBadgeText([1, 3]), "[1] [3]");
});

test("buildExportFilename uses the clicked tweet id when available", () => {
  assert.equal(content.buildExportFilename("123"), "ariadex-v2-123.json");
  assert.equal(content.buildExportFilename(""), "ariadex-v2-root-path.json");
});

test("formatProgressMessage writes compact path and reference progress", () => {
  assert.equal(
    content.formatProgressMessage({ phase: "start", clickedTweetId: "30" }),
    "Tracing the root path from the explored tweet..."
  );
  assert.equal(
    content.formatProgressMessage({ phase: "path_walk", ancestorCount: 0, nextRelationType: "quote" }),
    "Found the explored tweet. Following its quote parent..."
  );
  assert.equal(
    content.formatProgressMessage({ phase: "path_walk", ancestorCount: 4, nextRelationType: "reply" }),
    "Tracing the root path... 4 ancestors found so far. Next hop is a reply."
  );
  assert.equal(
    content.formatProgressMessage({ phase: "path_walk", ancestorCount: 1 }),
    "Tracing the root path... 1 ancestor found so far."
  );
  assert.equal(
    content.formatProgressMessage({ phase: "path_walk", ancestorCount: 0 }),
    "Found the explored tweet. Checking whether it has a parent..."
  );
  assert.equal(
    content.formatProgressMessage({ phase: "canonicalizing_refs", tweetCount: 7 }),
    "Root path complete. Canonicalizing references across 7 tweets..."
  );
  assert.equal(
    content.formatProgressMessage({ phase: "done", tweetCount: 1, referenceCount: 1 }),
    "Done. Resolved 1 path tweet and 1 reference."
  );
  assert.equal(
    content.formatProgressMessage({ phase: "done", tweetCount: 7, referenceCount: 2 }),
    "Done. Resolved 7 path tweets and 2 references."
  );
  assert.equal(
    content.formatProgressMessage({ phase: "mystery" }),
    "Tracing the root path..."
  );
});

test("readXApiBearerToken prefers window-level settings before localStorage", () => {
  assert.equal(content.readXApiBearerToken({
    AriadexXApiSettings: {
      bearerToken: "settings-token"
    },
    AriadexXApiBearerToken: "window-token",
    localStorage: {
      getItem() {
        return "local-storage-token";
      }
    }
  }), "settings-token");
});

test("readXApiBearerTokenWithFallbacks uses chrome storage when page storage is unavailable", async () => {
  const chromeStub = {
    runtime: {
      lastError: null
    },
    storage: {
      local: {
        get(keys, callback) {
          callback({
            [keys[0]]: "extension-storage-token"
          });
        }
      }
    }
  };

  const token = await content.readXApiBearerTokenWithFallbacks(chromeStub, {
    localStorage: {
      getItem() {
        return "";
      }
    }
  });

  assert.equal(token, "extension-storage-token");
});

test("formatLookupErrorMessage explains missing bearer-token setup errors", () => {
  assert.match(
    content.formatLookupErrorMessage(new Error("missing_x_api_bearer_token")),
    /missing X API bearer token/i
  );
  assert.match(
    content.formatLookupErrorMessage(new Error("missing X_api_token, or sth")),
    /missing X API bearer token/i
  );
});

test("formatLookupErrorMessage translates X auth rejections", () => {
  assert.match(
    content.formatLookupErrorMessage(new Error("tweet_fetch_failed_401")),
    /X rejected the bearer token/i
  );
});

test("normalizeText trims and collapses whitespace", () => {
  assert.equal(content.normalizeText(" a \n  b   c "), "a b c");
});

test("findClosestTweetArticle delegates to closest when available", () => {
  const article = { id: "tweet" };
  const node = {
    closest(selector) {
      assert.equal(selector, content.ARTICLE_SELECTOR);
      return article;
    }
  };

  assert.equal(content.findClosestTweetArticle(node), article);
  assert.equal(content.findClosestTweetArticle(null), null);
});

test("extractTweetId reads the tweet id from the status permalink", () => {
  const article = {
    querySelector(selector) {
      assert.equal(selector, 'a[href*="/status/"]');
      return {
        getAttribute(name) {
          assert.equal(name, "href");
          return "/alice/status/1234567890?s=20";
        }
      };
    }
  };

  assert.equal(content.extractTweetId(article), "1234567890");
  assert.equal(content.extractTweetId({ querySelector() { return null; } }), "");
});

test("clampPanelPosition keeps the floating panel inside the viewport margins", () => {
  const panel = {
    getBoundingClientRect() {
      return { width: 320, height: 200 };
    }
  };
  const root = {
    defaultView: {
      innerWidth: 900,
      innerHeight: 700
    }
  };

  assert.deepEqual(
    content.clampPanelPosition({ left: -50, top: 10 }, panel, root),
    { left: 20, top: 20 }
  );
  assert.deepEqual(
    content.clampPanelPosition({ left: 800, top: 650 }, panel, root),
    { left: 560, top: 480 }
  );
});

test("applyPanelPosition writes fixed left and top coordinates onto the panel", () => {
  const panel = {
    style: {},
    getBoundingClientRect() {
      return { width: 300, height: 180 };
    }
  };
  const root = {
    defaultView: {
      innerWidth: 1000,
      innerHeight: 800
    }
  };

  content.applyPanelPosition(panel, { left: 120, top: 140 }, root);

  assert.equal(panel.style.left, "120px");
  assert.equal(panel.style.top, "140px");
  assert.equal(panel.style.right, "auto");
});

test("makePanelMovable updates the saved panel position while dragging the header", () => {
  const listeners = {};
  const panel = {
    style: {},
    __ariadexV2State: { activeTab: "path", position: null },
    getBoundingClientRect() {
      return { left: 20, top: 20, width: 300, height: 200 };
    }
  };
  const handle = {
    classList: {
      add() {},
      remove() {}
    },
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
    removeEventListener(type, listener) {
      if (listeners[type] === listener) {
        delete listeners[type];
      }
    }
  };
  const root = {
    defaultView: {
      innerWidth: 1000,
      innerHeight: 800,
      addEventListener(type, listener) {
        listeners[`window:${type}`] = listener;
      },
      removeEventListener(type, listener) {
        if (listeners[`window:${type}`] === listener) {
          delete listeners[`window:${type}`];
        }
      }
    }
  };

  content.makePanelMovable(panel, handle, root);
  listeners.mousedown({
    button: 0,
    clientX: 70,
    clientY: 80,
    target: {
      closest() {
        return null;
      }
    },
    preventDefault() {}
  });
  listeners["window:mousemove"]({
    clientX: 250,
    clientY: 260
  });
  listeners["window:mouseup"]();

  assert.deepEqual(panel.__ariadexV2State.position, {
    left: 200,
    top: 200
  });
  assert.equal(panel.style.left, "200px");
  assert.equal(panel.style.top, "200px");
});

test("resolveRootArtifact sends the expected extension message", async () => {
  const chromeStub = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        callback({
          ok: true,
          artifact: {
            path: [{ id: "1" }, { id: "2" }],
            references: [{ number: 1 }],
            people: [{ handle: "alice", displayName: "Alice Example" }],
            replyChains: []
          }
        });
        chromeStub.sent = message;
      }
    }
  };

  const artifact = await content.resolveRootArtifact("2", chromeStub);
  assert.deepEqual(artifact, {
    path: [{ id: "1" }, { id: "2" }],
    references: [{ number: 1 }],
    people: [{ handle: "alice", displayName: "Alice Example" }],
    replyChains: []
  });
  assert.deepEqual(chromeStub.sent, {
    type: content.MESSAGE_TYPE,
    tweetId: "2",
    bearerToken: "test-token"
  });
});

test("resolveRootArtifact returns an empty artifact immediately when no tweet id is provided", async () => {
  const artifact = await content.resolveRootArtifact("", {
    runtime: {}
  });
  assert.deepEqual(artifact, { path: [], references: [], people: [], replyChains: [] });
});

test("resolveRootArtifact rejects extension errors", async () => {
  const chromeStub = {
    runtime: {
      lastError: null,
      sendMessage(_message, callback) {
        callback({ ok: false, error: "boom" });
      }
    }
  };

  await assert.rejects(() => content.resolveRootArtifact("2", chromeStub), /boom/);
});

test("resolveRootArtifact falls back to chrome storage for the bearer token", async () => {
  const chromeStub = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        chromeStub.sent = message;
        callback({
          ok: true,
          artifact: {
            path: [],
            references: [],
            people: [],
            replyChains: []
          }
        });
      }
    },
    storage: {
      local: {
        get(keys, callback) {
          callback({
            [keys[0]]: "storage-token"
          });
        }
      }
    }
  };

  const previousWindow = global.window;
  global.window = {
    localStorage: {
      getItem() {
        return "";
      }
    }
  };

  try {
    await content.resolveRootArtifact("2", chromeStub);
  } finally {
    global.window = previousWindow;
  }

  assert.deepEqual(chromeStub.sent, {
    type: content.MESSAGE_TYPE,
    tweetId: "2",
    bearerToken: "storage-token"
  });
});

test("resolveRootArtifact still sends the request when the content script cannot read a bearer token", async () => {
  const chromeStub = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        chromeStub.sent = message;
        callback({
          ok: false,
          error: "missing_x_api_bearer_token"
        });
      }
    },
    storage: {
      local: {
        get(_keys, callback) {
          callback({});
        }
      }
    }
  };

  const previousWindow = global.window;
  global.window = {
    localStorage: {
      getItem() {
        return "";
      }
    }
  };

  try {
    await assert.rejects(() => content.resolveRootArtifact("2", chromeStub), /missing_x_api_bearer_token/);
  } finally {
    global.window = previousWindow;
  }

  assert.deepEqual(chromeStub.sent, {
    type: content.MESSAGE_TYPE,
    tweetId: "2",
    bearerToken: ""
  });
});

test("resolveRootArtifact rejects when the extension runtime is unavailable", async () => {
  await assert.rejects(() => content.resolveRootArtifact("2", {}), /extension_runtime_unavailable/);
});

test("resolveRootArtifact uses the streaming port when available and relays progress", async () => {
  const progressEvents = [];
  let portListener;
  let disconnected = false;
  const chromeStub = {
    runtime: {
      sendMessage() {},
      connect(options) {
        assert.deepEqual(options, { name: "ARIADEx_V2_RESOLVE_ROOT_PATH_PORT" });
        return {
          onMessage: {
            addListener(listener) {
              portListener = listener;
            }
          },
          postMessage(message) {
            assert.deepEqual(message, {
              type: content.MESSAGE_TYPE,
              tweetId: "2",
              bearerToken: "test-token"
            });

            // Simulate the worker's streaming contract in-order.
            portListener({ type: "progress", progress: { phase: "start" } });
            portListener({
              type: "result",
              artifact: {
                path: [{ id: "1" }],
                references: null,
                people: [{ handle: "alice", displayName: "Alice Example" }],
                replyChains: [{ id: "chain-1" }]
              }
            });
          },
          disconnect() {
            disconnected = true;
          }
        };
      }
    }
  };

  const artifact = await content.resolveRootArtifact("2", chromeStub, (progress) => {
    progressEvents.push(progress);
  });

  assert.deepEqual(progressEvents, [{ phase: "start" }]);
  assert.deepEqual(artifact, {
    path: [{ id: "1" }],
    references: [],
    people: [{ handle: "alice", displayName: "Alice Example" }],
    replyChains: [{ id: "chain-1" }]
  });
  assert.equal(disconnected, true);
});

test("resolveRootArtifact rejects streaming port errors", async () => {
  let portListener;
  const chromeStub = {
    runtime: {
      sendMessage() {},
      connect() {
        return {
          onMessage: {
            addListener(listener) {
              portListener = listener;
            }
          },
          postMessage() {
            portListener({ type: "error", error: "boom" });
          },
          disconnect() {}
        };
      }
    }
  };

  await assert.rejects(() => content.resolveRootArtifact("2", chromeStub), /boom/);
});

test("clearTweetCache sends the expected extension message", async () => {
  const chromeStub = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        callback({ ok: true, cleared: true });
        chromeStub.sent = message;
      }
    }
  };

  await content.clearTweetCache(chromeStub);
  assert.deepEqual(chromeStub.sent, {
    type: content.CLEAR_CACHE_MESSAGE_TYPE
  });
});

test("clearTweetCache surfaces runtime failures", async () => {
  await assert.rejects(() => content.clearTweetCache({}), /extension_runtime_unavailable/);

  const chromeStub = {
    runtime: {
      lastError: { message: "send failed" },
      sendMessage(_message, callback) {
        callback({});
      }
    }
  };

  await assert.rejects(() => content.clearTweetCache(chromeStub), /send failed/);
});

test("renderPeopleTab renders canonical people and opens profiles on click", () => {
  const opened = [];
  const root = {
    createElement(tagName) {
      return {
        tagName,
        className: "",
        textContent: "",
        children: [],
        listeners: {},
        appendChild(child) {
          this.children.push(child);
        },
        addEventListener(type, listener) {
          this.listeners[type] = listener;
        }
      };
    },
    defaultView: {
      open(url, target, features) {
        opened.push({ url, target, features });
      }
    }
  };

  const list = content.renderPeopleTab([
    {
      handle: "alice",
      displayName: "Alice Example",
      avatarUrl: "https://img.example/alice.jpg",
      profileUrl: "https://x.com/alice",
      citedByTweetIds: ["10", "20"],
      sourceTypes: ["author", "mention"]
    }
  ], root);

  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].children[0].tagName, "img");
  assert.equal(list.children[0].children[0].src, "https://img.example/alice.jpg");
  assert.equal(list.children[0].children[1].textContent, "@alice");
  assert.equal(list.children[0].children[2].textContent, "Alice Example");
  assert.match(list.children[0].children[4].textContent, /2 path tweets/);
  list.children[0].listeners.click();
  assert.deepEqual(opened, [{
    url: "https://x.com/alice",
    target: "_blank",
    features: "noopener,noreferrer"
  }]);
});

test("renderPeopleTab shows an empty state when no people are available", () => {
  const root = {
    createElement(tagName) {
      return {
        tagName,
        className: "",
        textContent: "",
        appendChild() {},
        addEventListener() {}
      };
    }
  };

  const empty = content.renderPeopleTab([], root);
  assert.equal(empty.textContent, "No people were collected on this root path.");
});

test("renderReplyChainsTab renders one card per tweet and labels the anchor branch", () => {
  const root = {
    createElement(tagName) {
      return {
        tagName,
        className: "",
        textContent: "",
        children: [],
        listeners: {},
        appendChild(child) {
          this.children.push(child);
        },
        addEventListener(type, listener) {
          this.listeners[type] = listener;
        }
      };
    },
    defaultView: {
      location: {
        href: "https://x.com/home"
      }
    }
  };

  const list = content.renderReplyChainsTab([{
    id: "10__20",
    anchorTweetId: "20",
    anchorAuthor: "alice",
    participantHandles: ["alice", "bob"],
    tweets: [
      { id: "10", author: "alice", text: "first", url: "https://x.com/alice/status/10" },
      { id: "20", author: "bob", text: "second", url: "https://x.com/bob/status/20" }
    ]
  }], [{ id: "10" }, { id: "20" }], "20", root);

  assert.equal(list.children.length, 1);
  assert.match(list.children[0].children[0].textContent, /Explored Reply Chain/);
  assert.match(list.children[0].children[1].textContent, /Reply to @alice/);
  assert.equal(list.children[0].children[3].children.length, 2);
  assert.equal(list.children[0].children[3].children[0].children[1].textContent, "@alice");
  assert.equal(list.children[0].children[3].children[1].children[1].textContent, "@bob");
  list.children[0].children[3].children[0].listeners.click();
  assert.equal(root.defaultView.location.href, "https://x.com/alice/status/10");
  list.children[0].children[3].children[1].listeners.click();
  assert.equal(root.defaultView.location.href, "https://x.com/bob/status/20");
});

test("renderReplyChainsTab shows an empty state when no chains are available", () => {
  const root = {
    createElement(tagName) {
      return {
        tagName,
        className: "",
        textContent: "",
        appendChild() {},
        addEventListener() {}
      };
    }
  };

  const empty = content.renderReplyChainsTab([], [], "", root);
  assert.equal(empty.textContent, "No replies to the explored tweet were found.");
});

test("renderReferencesTab renders canonical references and opens them on click", () => {
  const opened = [];
  const root = {
    createElement(tagName) {
      return {
        tagName,
        className: "",
        textContent: "",
        children: [],
        listeners: {},
        appendChild(child) {
          this.children.push(child);
        },
        addEventListener(type, listener) {
          this.listeners[type] = listener;
        }
      };
    },
    defaultView: {
      open(url, target, features) {
        opened.push({ url, target, features });
      }
    }
  };

  const list = content.renderReferencesTab([{
    number: 1,
    canonicalUrl: "https://example.com/paper",
    domain: "example.com",
    citedByTweetIds: ["10", "20"]
  }], root);

  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].children[0].textContent, "Reference [1]");
  assert.equal(list.children[0].children[1].textContent, "https://example.com/paper");
  assert.match(list.children[0].children[2].textContent, /2 path tweets/);
  list.children[0].listeners.click();
  assert.deepEqual(opened, [{
    url: "https://example.com/paper",
    target: "_blank",
    features: "noopener,noreferrer"
  }]);
});

test("renderReferencesTab shows an empty state when no references are available", () => {
  const root = {
    createElement(tagName) {
      return {
        tagName,
        className: "",
        textContent: "",
        appendChild() {},
        addEventListener() {}
      };
    }
  };

  const empty = content.renderReferencesTab([], root);
  assert.equal(empty.textContent, "No external references found on this root path.");
});

test("renderPathTab navigates to the tweet url on card click", () => {
  const root = {
    createElement(tagName) {
      return {
        tagName,
        className: "",
        textContent: "",
        children: [],
        listeners: {},
        appendChild(child) {
          this.children.push(child);
        },
        addEventListener(type, listener) {
          this.listeners[type] = listener;
        }
      };
    },
    defaultView: {
      location: {
        href: "https://x.com/home"
      }
    }
  };

  const list = content.renderPathTab([{
    id: "10",
    author: "alice",
    text: "hello",
    url: "https://x.com/alice/status/10",
    outboundRelation: "",
    referenceNumbers: [1]
  }], "10", root);

  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].children[0].textContent, "Root");
  assert.equal(list.children[0].children[3].textContent, "[1]");
  list.children[0].listeners.click();
  assert.equal(root.defaultView.location.href, "https://x.com/alice/status/10");
});

test("renderPathTab omits the reference badge when a tweet has no references", () => {
  const root = {
    createElement(tagName) {
      return {
        tagName,
        className: "",
        textContent: "",
        children: [],
        listeners: {},
        appendChild(child) {
          this.children.push(child);
        },
        addEventListener(type, listener) {
          this.listeners[type] = listener;
        }
      };
    },
    defaultView: {
      location: {
        href: "https://x.com/home"
      }
    }
  };

  const list = content.renderPathTab([{
    id: "10",
    author: "alice",
    text: "hello",
    url: "https://x.com/alice/status/10",
    outboundRelation: "",
    referenceNumbers: []
  }], "10", root);

  assert.equal(list.children[0].children.length, 4);
  assert.equal(list.children[0].children[3].textContent, "10");
});

test("triggerJsonDownload creates a blob url and clicks a temporary download link", () => {
  const appended = [];
  const clicked = [];
  const removed = [];
  const revoked = [];
  const root = {
    createElement(tagName) {
      return {
        tagName,
        style: {},
        click() {
          clicked.push({ href: this.href, download: this.download });
        },
        remove() {
          removed.push(true);
        }
      };
    },
    body: {
      appendChild(node) {
        appended.push(node);
      }
    },
    defaultView: {
      URL: {
        createObjectURL(blob) {
          appended.push(blob);
          return "blob:ariadex";
        },
        revokeObjectURL(url) {
          revoked.push(url);
        }
      }
    }
  };

  content.triggerJsonDownload({ hello: "world" }, "snapshot.json", root);

  assert.equal(appended[0] instanceof Blob, true);
  assert.equal(appended[1].tagName, "a");
  assert.deepEqual(clicked, [{
    href: "blob:ariadex",
    download: "snapshot.json"
  }]);
  assert.equal(removed.length, 1);
  assert.deepEqual(revoked, ["blob:ariadex"]);
});

test("triggerJsonDownload rejects when blob downloads are unavailable", () => {
  const root = {
    createElement() {
      return {};
    },
    body: {
      appendChild() {}
    },
    defaultView: {
      URL: {
        createObjectURL() {
          return "";
        }
      }
    }
  };

  assert.throws(() => content.triggerJsonDownload({ ok: true }, "snapshot.json", root), /download_unavailable/);
});
