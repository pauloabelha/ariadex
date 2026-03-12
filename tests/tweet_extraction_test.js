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
    reply_to: null
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
    reply_to: null
  });
});

test("clicking Explore logs rootTweet/graph conversation object", () => {
  const dom = setDomFromExample();
  const root = dom.window.document.getElementById("react-root") || dom.window.document.body;
  const tweet = appendTweetFixture(root);

  const injected = content.injectExploreButton(tweet);
  assert.equal(injected, true);

  const button = tweet.querySelector(".ariadex-explore-button");
  assert.ok(button);

  let loggedPayload = null;
  const originalLog = console.log;
  console.log = (payload) => {
    loggedPayload = payload;
  };

  button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  console.log = originalLog;

  assert.ok(loggedPayload);
  assert.ok(loggedPayload.rootTweet);
  assert.ok(loggedPayload.graph);
  assert.ok(Array.isArray(loggedPayload.graph.children));
  assert.equal(loggedPayload.rootTweet.author, "@ariadex_user");
  assert.equal(loggedPayload.rootTweet.replies, 14);
  assert.equal(loggedPayload.rootTweet.reposts, 120);
  assert.equal(loggedPayload.rootTweet.likes, 449);
});
