const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const content = require("../extension/content.js");

function setDomFromExample() {
  const html = fs.readFileSync(path.join(__dirname, "..", "X_example.html"), "utf8");
  const dom = new JSDOM(html, { url: "https://x.com/home" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.Element = dom.window.Element;
  global.MutationObserver = dom.window.MutationObserver;
  return dom;
}

function appendTweetFixture(container) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <article data-testid="tweet" role="article" id="tweet-fixture">
      <div data-testid="User-Name">
        <a href="/ariadex_user">Ariadex User</a>
      </div>
      <div data-testid="tweetText">
        <span>Ariadex explores conversation structure.</span>
      </div>
      <a href="/ariadex_user/status/1234567890"><time datetime="2026-03-12T00:00:00.000Z">Now</time></a>
      <div role="group" aria-label="Reply Repost Like Share">
        <button data-testid="reply" aria-label="14 replies">
          <span data-testid="app-text-transition-container"><span>14</span></span>
        </button>
        <button data-testid="retweet" aria-label="120 reposts">
          <span data-testid="app-text-transition-container"><span>120</span></span>
        </button>
        <button data-testid="like" aria-label="449 likes">
          <span data-testid="app-text-transition-container"><span>449</span></span>
        </button>
      </div>
    </article>
  `;

  const tweet = wrapper.firstElementChild;
  container.appendChild(tweet);
  return tweet;
}

test("extractTweetData parses tweet fields from tweet container", () => {
  const dom = setDomFromExample();
  const root = dom.window.document.getElementById("react-root") || dom.window.document.body;
  const tweet = appendTweetFixture(root);

  const extracted = content.extractTweetData(tweet);

  assert.deepEqual(extracted, {
    id: "1234567890",
    author: "@ariadex_user",
    text: "Ariadex explores conversation structure.",
    url: "https://x.com/ariadex_user/status/1234567890",
    replies: 14,
    reposts: 120,
    likes: 449,
    reply_to: null,
    quote_of: null,
    repost_of: null
  });
});

test("extractTweetData tolerates missing fields", () => {
  const dom = setDomFromExample();
  const root = dom.window.document.getElementById("react-root") || dom.window.document.body;

  const wrapper = dom.window.document.createElement("div");
  wrapper.innerHTML = `
    <article data-testid="tweet" role="article">
      <div role="group" aria-label="Actions">
        <button aria-label="Reply"></button>
      </div>
    </article>
  `;
  const tweet = wrapper.firstElementChild;
  root.appendChild(tweet);

  const extracted = content.extractTweetData(tweet);

  assert.deepEqual(extracted, {
    id: null,
    author: null,
    text: null,
    url: null,
    replies: null,
    reposts: null,
    likes: null,
    reply_to: null,
    quote_of: null,
    repost_of: null
  });
});

test("clicking Explore logs rootTweet/graph conversation object", async () => {
  const dom = setDomFromExample();
  const root = dom.window.document.getElementById("react-root") || dom.window.document.body;
  const tweet = appendTweetFixture(root);
  dom.window.localStorage.setItem("ariadex.x_api_bearer_token", "test-token");

  const apiRootId = "1234567890";
  const apiRootTweet = {
    id: apiRootId,
    author_id: "u1",
    text: "Ariadex explores conversation structure.",
    public_metrics: {
      reply_count: 14,
      retweet_count: 120,
      like_count: 449,
      quote_count: 0
    },
    referenced_tweets: []
  };
  const apiReplyTweet = {
    id: "2234567890",
    author_id: "u2",
    text: "reply",
    public_metrics: {
      reply_count: 0,
      retweet_count: 0,
      like_count: 1,
      quote_count: 0
    },
    referenced_tweets: [{ type: "replied_to", id: apiRootId }]
  };

  dom.window.fetch = async (urlString) => {
    const url = new URL(urlString);
    const jsonResponse = (body) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => body,
      text: async () => JSON.stringify(body)
    });

    if (url.pathname === `/2/tweets/${apiRootId}`) {
      return jsonResponse({
        data: apiRootTweet,
        includes: {
          users: [{ id: "u1", username: "ariadex_user", name: "Ariadex User" }]
        }
      });
    }

    if (url.pathname === "/2/tweets/search/recent") {
      return jsonResponse({
        data: [apiRootTweet, apiReplyTweet],
        includes: {
          users: [
            { id: "u1", username: "ariadex_user", name: "Ariadex User" },
            { id: "u2", username: "reply_user", name: "Reply User" }
          ]
        },
        meta: {}
      });
    }

    if (url.pathname === `/2/tweets/${apiRootId}/quote_tweets`) {
      return jsonResponse({
        data: [],
        includes: { users: [] },
        meta: {}
      });
    }

    if (url.pathname === `/2/tweets/${apiRootId}/retweeted_by`) {
      return jsonResponse({
        data: [],
        meta: {}
      });
    }

    if (url.pathname === "/2/tweets" || url.pathname === "/2/users") {
      return jsonResponse({
        data: [],
        includes: { users: [] }
      });
    }

    throw new Error(`Unexpected URL: ${url.toString()}`);
  };

  const injected = content.injectExploreButton(tweet);
  assert.equal(injected, true);

  const button = tweet.querySelector(".ariadex-explore-button");
  assert.ok(button);

  let loggedPayload = null;
  const originalLog = console.log;
  console.log = (...args) => {
    const candidate = args.find((value) => value && typeof value === "object" && value.graph && value.ranking);
    if (candidate) {
      loggedPayload = candidate;
    }
  };

  button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  console.log = originalLog;

  assert.ok(loggedPayload);
  assert.ok(loggedPayload.rootTweet);
  assert.ok(loggedPayload.graph);
  assert.ok(Array.isArray(loggedPayload.graph.nodes));
  assert.ok(Array.isArray(loggedPayload.graph.edges));
  assert.ok(loggedPayload.ranking);
  assert.ok(Array.isArray(loggedPayload.ranking.scores));
  assert.equal(loggedPayload.rootTweet.author, "@ariadex_user");
  assert.equal(loggedPayload.rootTweet.replies, 14);
  assert.equal(loggedPayload.rootTweet.reposts, 120);
  assert.equal(loggedPayload.rootTweet.likes, 449);
});
