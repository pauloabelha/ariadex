const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const content = require("../extension/content.js");

function setDom(html) {
  const dom = new JSDOM(html);
  global.window = dom.window;
  global.document = dom.window.document;
  global.Element = dom.window.Element;
  return dom;
}

test("detects tweet candidates by article/data-testid selectors", () => {
  const dom = setDom(`
    <main>
      <article role="article" id="tweet-1">
        <div role="group" aria-label="Reply Repost Like Share">
          <button aria-label="Reply"></button>
          <button aria-label="Repost"></button>
          <button aria-label="Like"></button>
        </div>
      </article>
      <div data-testid="tweet" id="tweet-2">
        <div role="group" aria-label="Reply Repost Like Share">
          <button aria-label="Reply"></button>
          <button aria-label="Repost"></button>
          <button aria-label="Like"></button>
        </div>
      </div>
    </main>
  `);

  const candidates = content.getTweetCandidates(dom.window.document);
  assert.equal(candidates.length, 2);
  const ids = candidates.map((candidate) => candidate.id).sort();
  assert.deepEqual(ids, ["tweet-1", "tweet-2"]);
});

test("locates action bar based on role group and action hints", () => {
  const dom = setDom(`
    <article role="article" id="tweet-3">
      <div role="group" id="other-group">
        <button aria-label="Follow"></button>
      </div>
      <div role="group" id="action-group" aria-label="Reply Repost Like Share">
        <button aria-label="Reply"></button>
        <button aria-label="Repost"></button>
        <button aria-label="Like"></button>
      </div>
    </article>
  `);

  const tweet = dom.window.document.querySelector("article");
  const actionBar = content.locateActionBar(tweet);

  assert.ok(actionBar);
  assert.equal(actionBar.id, "action-group");
});
