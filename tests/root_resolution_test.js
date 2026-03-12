const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const rootResolution = require("../extension/root_resolution.js");

function setupDom() {
  const dom = new JSDOM("<main id='scope'></main>", { url: "https://x.com/home" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.Element = dom.window.Element;
  return dom;
}

function createTweet({ id, text = "tweet" }) {
  const article = document.createElement("article");
  article.setAttribute("data-testid", "tweet");
  article.setAttribute("role", "article");
  article.id = id;
  article.textContent = text;
  return article;
}

test("root tweet resolves to itself", () => {
  setupDom();
  const scope = document.getElementById("scope");
  const root = createTweet({ id: "root" });
  scope.appendChild(root);

  const resolved = rootResolution.resolveConversationRoot(root);
  assert.equal(resolved, root);
});

test("quote tweet resolves to embedded quoted tweet", () => {
  setupDom();
  const scope = document.getElementById("scope");
  const tweetA = createTweet({ id: "A" });
  const tweetB = createTweet({ id: "B" });
  tweetA.appendChild(tweetB);
  scope.appendChild(tweetA);

  const resolved = rootResolution.resolveConversationRoot(tweetA);
  assert.equal(resolved, tweetB);
});

test("reply thread resolves to earliest tweet in local scope", () => {
  setupDom();
  const scope = document.getElementById("scope");
  const root = createTweet({ id: "root" });
  const reply1 = createTweet({ id: "reply-1" });
  const reply2 = createTweet({ id: "reply-2" });
  scope.appendChild(root);
  scope.appendChild(reply1);
  scope.appendChild(reply2);

  const resolved = rootResolution.resolveConversationRoot(reply1);
  assert.equal(resolved, root);
});

test("nested quote + reply resolves to quoted root", () => {
  setupDom();
  const scope = document.getElementById("scope");
  const tweetA = createTweet({ id: "A" });
  const tweetB = createTweet({ id: "B" });
  const tweetC = createTweet({ id: "C" });

  tweetB.appendChild(tweetC);
  tweetA.appendChild(tweetB);
  scope.appendChild(tweetA);

  const resolved = rootResolution.resolveConversationRoot(tweetC);
  assert.equal(resolved, tweetB);
});
