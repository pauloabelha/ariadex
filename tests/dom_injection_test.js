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

test("injects the Explore button into tweet action bar", () => {
  const dom = setDom(`
    <article role="article" id="tweet-1">
      <div role="group" aria-label="Reply Repost Like Share">
        <button aria-label="Reply"></button>
        <button aria-label="Repost"></button>
        <button aria-label="Like"></button>
      </div>
    </article>
  `);

  const tweet = dom.window.document.querySelector("article");
  const injected = content.injectExploreButton(tweet);
  const button = dom.window.document.querySelector(".ariadex-explore-button");

  assert.equal(injected, true);
  assert.ok(button);
  assert.equal(button.textContent, "◇ Explore");
});

test("prevents duplicate button injection", () => {
  const dom = setDom(`
    <article role="article" id="tweet-dup">
      <div role="group" aria-label="Reply Repost Like Share">
        <button aria-label="Reply"></button>
        <button aria-label="Repost"></button>
        <button aria-label="Like"></button>
      </div>
    </article>
  `);

  const tweet = dom.window.document.querySelector("article");
  const first = content.injectExploreButton(tweet);
  const second = content.injectExploreButton(tweet);
  const buttons = dom.window.document.querySelectorAll(".ariadex-explore-button");

  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(buttons.length, 1);
});

test("processRoot handles dynamically added tweet nodes", () => {
  const dom = setDom(`
    <main id="root"></main>
  `);

  const root = dom.window.document.getElementById("root");
  root.innerHTML = `
    <article role="article" id="tweet-a">
      <div role="group" aria-label="Reply Repost Like Share">
        <button aria-label="Reply"></button>
        <button aria-label="Repost"></button>
        <button aria-label="Like"></button>
      </div>
    </article>
    <article role="article" id="tweet-b">
      <div role="group" aria-label="Reply Repost Like Share">
        <button aria-label="Reply"></button>
        <button aria-label="Repost"></button>
        <button aria-label="Like"></button>
      </div>
    </article>
  `;

  content.processRoot(root);
  const buttons = root.querySelectorAll(".ariadex-explore-button");

  assert.equal(buttons.length, 2);
});
