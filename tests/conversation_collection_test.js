const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const content = require("../extension/content.js");

function setDomFromExample() {
  const html = fs.readFileSync(path.join(__dirname, "..", "X_example.html"), "utf8");
  const dom = new JSDOM(html, { url: "https://x.com/some_user/status/111" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.Element = dom.window.Element;
  global.MutationObserver = dom.window.MutationObserver;
  return dom;
}

function createTweetHtml({ id, user, text, statusId, replies, reposts, likes }) {
  return `
    <article data-testid="tweet" role="article" id="${id}">
      <div data-testid="User-Name">
        <a href="/${user}">${user}</a>
      </div>
      <div data-testid="tweetText"><span>${text}</span></div>
      <a href="/${user}/status/${statusId}"><time datetime="2026-03-12T00:00:00.000Z">Now</time></a>
      <div role="group" aria-label="Reply Repost Like Share">
        <button data-testid="reply" aria-label="${replies} replies"><span data-testid="app-text-transition-container"><span>${replies}</span></span></button>
        <button data-testid="retweet" aria-label="${reposts} reposts"><span data-testid="app-text-transition-container"><span>${reposts}</span></span></button>
        <button data-testid="like" aria-label="${likes} likes"><span data-testid="app-text-transition-container"><span>${likes}</span></span></button>
      </div>
    </article>
  `;
}

test("collectConversationTweets returns a flat visible conversation list", () => {
  const dom = setDomFromExample();
  const mount = dom.window.document.createElement("main");
  mount.id = "conversation-root";
  mount.innerHTML = [
    createTweetHtml({ id: "root", user: "root_user", text: "Root tweet", statusId: 111, replies: 10, reposts: 22, likes: 33 }),
    createTweetHtml({ id: "reply-1", user: "reply_one", text: "First reply", statusId: 222, replies: 2, reposts: 3, likes: 4 }),
    createTweetHtml({ id: "reply-2", user: "reply_two", text: "Second reply", statusId: 333, replies: 5, reposts: 6, likes: 7 })
  ].join("\n");

  dom.window.document.body.appendChild(mount);

  const rootTweetElement = dom.window.document.getElementById("root");
  const result = content.collectConversationTweets(rootTweetElement);

  assert.equal(Array.isArray(result), true);
  assert.equal(result.length, 3);
  assert.equal(result[0].author, "@root_user");
  assert.equal(result[0].url, "https://x.com/root_user/status/111");
  assert.equal(result[0].id, "111");
  assert.deepEqual(
    result.slice(1).map((tweet) => tweet.author).sort(),
    ["@reply_one", "@reply_two"]
  );
});

test("collectConversationTweets deduplicates visible tweets by URL", () => {
  const dom = setDomFromExample();
  const mount = dom.window.document.createElement("main");
  mount.innerHTML = [
    createTweetHtml({ id: "root", user: "root_user", text: "Root tweet", statusId: 111, replies: 10, reposts: 22, likes: 33 }),
    createTweetHtml({ id: "reply-1", user: "dup_user", text: "Duplicate reply", statusId: 444, replies: 1, reposts: 1, likes: 1 }),
    createTweetHtml({ id: "reply-1-dup", user: "dup_user", text: "Duplicate reply copy", statusId: 444, replies: 9, reposts: 9, likes: 9 })
  ].join("\n");

  dom.window.document.body.appendChild(mount);

  const rootTweetElement = dom.window.document.getElementById("root");
  const result = content.collectConversationTweets(rootTweetElement);

  assert.equal(result.length, 2);
  assert.equal(result[1].url, "https://x.com/dup_user/status/444");
});
