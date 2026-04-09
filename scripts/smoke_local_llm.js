"use strict";

const { createOpenAiArticleGenerator } = require("../server/openai_article_generator.js");
const { createOpenAiContributionClassifier } = require("../server/openai_contribution_filter.js");
const { resolveEndpointBase, resolveContributionModel } = require("../server/llm_runtime.js");

async function run({
  resolveEndpointBaseImpl = resolveEndpointBase,
  resolveContributionModelImpl = resolveContributionModel,
  createClassifierImpl = createOpenAiContributionClassifier,
  createArticleGeneratorImpl = createOpenAiArticleGenerator,
  consoleImpl = console
} = {}) {
  const endpointBase = resolveEndpointBaseImpl(undefined, { local: true });
  const model = resolveContributionModelImpl(undefined, { local: true });

  const classifier = createClassifierImpl({
    endpointBase,
    model,
    batchSize: 5,
    maxTweetsPerSnapshot: 5,
    requestTimeoutMs: 120000,
    includeReason: true,
    enableHeuristics: false
  });

  const classifierResult = await classifier.classifyTweets([
    { id: "t1", text: "The claim needs evidence because the cited study only measured a proxy outcome, not the behavior itself." },
    { id: "t2", text: "wow true" }
  ], {
    requestId: "llm-smoke",
    canonicalRootId: "smoke-root"
  });

  if (!classifierResult || Number(classifierResult.classifiedCount || 0) < 1) {
    throw new Error("Local classifier did not return any labels. Verify ARIADEX_LOCAL_BASE_URL points at the active llama-server.");
  }

  const generator = createArticleGeneratorImpl({
    endpointBase,
    model,
    requestTimeoutMs: 120000
  });

  const articleResult = await generator.generateArticle({
    clickedTweetId: "seed",
    dataset: {
      canonicalRootId: "root",
      rootTweet: { id: "root", author: "@root", text: "Root says frontier models still need stronger grounding before broad deployment." },
      tweets: [
        { id: "root", author: "@root", text: "Root says frontier models still need stronger grounding before broad deployment." },
        { id: "seed", author: "@seed", text: "One reply argues the benchmarks improved, but the evidence is still narrow.", quote_of: "root" }
      ]
    },
    snapshot: {
      canonicalRootId: "root",
      root: { id: "root", author: "@root", text: "Root says frontier models still need stronger grounding before broad deployment." },
      pathAnchored: {
        selectedTweetIds: ["root", "seed"],
        references: [],
        artifact: {
          exploredTweetId: "seed",
          rootTweet: { id: "root", author: "@root", text: "Root says frontier models still need stronger grounding before broad deployment." },
          mandatoryPath: [
            { id: "root", author: "@root", text: "Root says frontier models still need stronger grounding before broad deployment." },
            { id: "seed", author: "@seed", text: "One reply argues the benchmarks improved, but the evidence is still narrow.", quoteOf: "root" }
          ],
          expansions: [],
          selectedTweets: []
        }
      },
      ranking: [
        { id: "seed", score: 1 },
        { id: "root", score: 0.9 }
      ]
    }
  });

  const output = {
    endpointBase,
    model,
    classifier: {
      llmProvider: classifierResult.llmProvider,
      classifiedCount: classifierResult.classifiedCount,
      contributingCount: classifierResult.contributingCount,
      nonContributingCount: classifierResult.nonContributingCount,
      byTweetId: classifierResult.byTweetId,
      reasonByTweetId: classifierResult.reasonByTweetId
    },
    article: {
      llmProvider: articleResult.llmProvider,
      usedLlm: articleResult.usedLlm,
      usedOpenAi: articleResult.usedOpenAi,
      title: articleResult.title,
      summary: articleResult.summary,
      headings: Array.isArray(articleResult.sections) ? articleResult.sections.map((section) => section.heading) : []
    }
  };

  consoleImpl.log(JSON.stringify(output, null, 2));
  return output;
}

function main() {
  run().catch((error) => {
    console.error(`[Ariadex] local LLM smoke failed: ${error.message}`);
    process.exit(1);
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  run,
  main
};
