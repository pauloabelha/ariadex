const test = require("node:test");
const assert = require("node:assert/strict");

const {
  articleToPlainText,
  createArticlePdfBuffer
} = require("../server/article_pdf.js");

test("articleToPlainText includes title sections and references", () => {
  const text = articleToPlainText({
    title: "Digest",
    dek: "Dek line",
    summary: "Summary line",
    sections: [
      { heading: "Section One", body: "Body one" },
      { heading: "Section Two", body: "Body two" }
    ],
    references: [
      { displayUrl: "https://example.com/doc" }
    ]
  });

  assert.match(text, /Digest/);
  assert.match(text, /SECTION ONE/);
  assert.match(text, /Body two/);
  assert.match(text, /REFERENCES/);
  assert.match(text, /https:\/\/example\.com\/doc/);
});

test("createArticlePdfBuffer returns a valid pdf buffer", () => {
  const buffer = createArticlePdfBuffer({
    title: "Digest",
    summary: "Summary",
    sections: [{ heading: "One", body: "Body text" }],
    references: []
  });

  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.slice(0, 8).toString("utf8"), "%PDF-1.4");
  assert.match(buffer.toString("utf8"), /Digest/);
  assert.match(buffer.toString("utf8"), /Body text/);
});
