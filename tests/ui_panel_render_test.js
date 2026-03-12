const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const uiPanel = require("../extension/ui_panel.js");

function setupDom(html = "<body><main></main></body>") {
  const dom = new JSDOM(html, { url: "https://x.com/home" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.Element = dom.window.Element;
  return dom;
}

test("createPanelContainer returns expected panel structure", () => {
  setupDom();
  const panel = uiPanel.createPanelContainer();

  assert.equal(panel.className, "ariadex-panel");
  assert.ok(panel.querySelector(".ariadex-header"));
  assert.ok(panel.querySelector(".ariadex-thread-list"));
  assert.equal(panel.parentElement, document.body);
  assert.equal(panel.style.position, "fixed");
  assert.equal(panel.style.right, "24px");
});

test("renderTopThreads renders ranked tweet entries", () => {
  setupDom();

  uiPanel.renderTopThreads([
    { id: "1", score: 0.42, tweet: { id: "1", author: "@user1", text: "First idea" } },
    { id: "2", score: 0.31, tweet: { id: "2", author: "@user2", text: "Second idea" } }
  ]);

  const panel = document.querySelector(".ariadex-panel");
  const items = panel.querySelectorAll(".ariadex-thread");

  assert.ok(panel);
  assert.equal(items.length, 2);
  assert.match(items[0].textContent, /@user1/);
  assert.match(items[0].textContent, /score:/i);
});

test("panel is not duplicated", () => {
  setupDom();
  uiPanel.createPanelContainer();
  uiPanel.createPanelContainer();

  const panels = document.querySelectorAll(".ariadex-panel");
  assert.equal(panels.length, 1);
});

test("clicking a rendered thread scrolls to the tweet element", () => {
  setupDom(`
    <body>
      <article data-testid="tweet" role="article" id="tweet-123">
        <a href="/user/status/123">status</a>
      </article>
    </body>
  `);

  const tweet = document.getElementById("tweet-123");
  let scrolled = false;
  tweet.scrollIntoView = () => {
    scrolled = true;
  };

  uiPanel.renderTopThreads([
    { id: "123", score: 0.77, tweet: { id: "123", author: "@user", text: "Thread body" } }
  ]);

  const item = document.querySelector(".ariadex-thread");
  item.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  assert.equal(scrolled, true);
});

test("author_thread entry renders collapsed thread label", () => {
  setupDom();

  uiPanel.renderTopThreads([
    {
      id: "author_thread:@a",
      score: 0.55,
      tweet: {
        id: "author_thread:@a",
        type: "author_thread",
        author: "@a",
        text: "Root text",
        tweets: [
          { id: "101", text: "Root text", author: "@a" },
          { id: "102", text: "follow-up", author: "@a" }
        ]
      }
    }
  ]);

  const item = document.querySelector(".ariadex-thread");
  assert.match(item.textContent, /Author thread \(@a\)/);
  assert.match(item.textContent, /2 tweets/);
});
