# Top Takes

Top Takes is AriadeX's objective quote-discourse ranking mode.

It answers:

> Which quote tweets most improve a reader's understanding of the source tweet and surrounding discourse?

It does not answer:

> Which quote tweets are most relevant to this viewer?

Viewer relationship signals are excluded from ranking. AriadeX should not use whether the viewer follows an author, liked an author, bookmarked an author, or has any private relationship with an author. If those signals are added later, they belong in separate metadata or a separate personalized mode.

## Contract

Top Takes has two stages:

```text
Collect -> Rank
```

Only quote tweets are ranked.

Replies to quote tweets are context only.

## Collect

Collect builds the candidate universe and lightweight context.

Inputs:

- source tweet id
- X API client
- cache adapter
- OpenAI settings for later rank stage
- progress callback

Collected evidence:

- source tweet
- quote tweets of the source tweet
- public author metadata exposed by X API
- optional top direct replies to each quote tweet

Default quote retrieval:

- `maxQuoteTweets`: `200`
- `maxQuotePages`: `3`
- `maxResultsPerPage`: `100`

Default reply context:

- `topCommentsPerQuote`: `3`
- only direct replies to the quote tweet
- sorted by visible engagement
- skipped if X remains rate-limited

The ranked candidate set remains quote tweets even when replies are attached as context.

## Candidate Filtering

Before model classification, candidates are normalized and deduped.

Filtering removes:

- missing or invalid tweet ids
- empty or very short posts
- repost-like `RT @...` text
- link-only or mention-only text
- spam-like repeated wording
- exact duplicate normalized text
- near-duplicate text

The goal is compact discourse coverage: enough candidates to preserve meaningful perspectives, few enough to avoid wasting X/OpenAI budget on repeated low-information posts.

## Rank

Rank converts collected quote tweets into an inspectable objective list.

OpenAI contributes:

- source domain
- author domain/expertise classification
- epistemic role label
- explanation
- confidence and scorecard fields

Deterministic code contributes:

- length score
- reference score
- filtering
- final score composition
- duplicate-author and near-duplicate suppression

## Score Fields

The final ranking formula is:

```text
take_score =
  author_score * 0.45
+ length_score * 0.30
+ reference_score * 0.25
```

Fields:

- `domain_expert_score`: apparent direct fluency in the source domain.
- `adjacent_expert_score`: apparent useful neighboring expertise.
- `author_score`: stronger of direct and adjacent expertise.
- `length_score`: deterministic estimate that the quote has enough substance to contain reasoning.
- `reference_score`: deterministic signal from non-X external references.
- `take_score`: final objective rank score.

Artifacts preserve both camelCase and snake_case forms:

- `domainExpertScore` / `domain_expert_score`
- `adjacentExpertScore` / `adjacent_expert_score`
- `authorScore` / `author_score`
- `lengthScore` / `length_score`
- `referenceScore` / `reference_score`
- `takeScore` / `take_score`

## Objective Ranking Rules

Top Takes must not optimize for:

- viewer relationship to author
- likes, virality, or raw engagement
- agreement with source tweet
- ideological alignment
- follower count
- verification status
- hype

Public profile metadata is weak evidence. Demonstrated domain fluency in the quote text should carry more weight than profile claims.

## Selection

Representative selection:

- sorts by `take_score`
- requires a minimum score threshold
- avoids duplicate authors
- avoids near-duplicate text
- favors concrete evidence, mechanism, caveats, synthesis, or domain fluency
- downranks vague hype, link-only reactions, and purely affective reactions

The UI renders one compact ranked list. Domain and role labels appear as pills, not as separate sections.

## Caching

Top Takes caches heavily:

- source tweet payloads in the shared tweet cache
- quote tweet collections by source tweet id
- OpenAI classifications by source tweet, quote ids, cache version, and model
- final artifacts by source tweet id and cache version
- OpenAI batch timing summaries

Cache progress is user-visible. The panel should say when AriadeX is fetching, reading cache, writing cache, waiting, reconnecting, or resuming.

## Rate Limits

X API `429` means the endpoint is rate-limited.

Retry behavior uses:

- `Retry-After`
- `x-rate-limit-reset`
- local fallback delay

Defaults:

- `maxRateLimitRetries`: `2`
- `rateLimitRetryDelayMs`: `60000`
- `rateLimitMaxWaitMs`: `120000`

If required quote retrieval rate-limits, AriadeX waits and retries. If optional reply-context retrieval remains rate-limited, AriadeX continues with quote tweets only.

## OpenAI Timing

Each OpenAI batch records:

- batch index
- quote count
- duration
- completion timestamp

Cached timing summary includes:

- total duration
- average batch duration
- average milliseconds per quote
- per-batch records

Future runs use this to show estimated remaining time for OpenAI work.

## Port Reconnect

Top Takes streams progress over a Chrome runtime port when possible.

Manifest V3 service workers can still disconnect long-running ports. If the port closes before a result, the content script falls back to a normal runtime message and tells the UI it is reconnecting and resuming from cache.

## Artifact Shape

```js
{
  sourceTweet,
  sourceDomain,
  sourceDomainConfidence,
  takes,
  groupedRoles,
  representativeTakes,
  people,
  stats,
  modelMetadata,
  openAiTiming,
  cacheKey
}
```

`groupedRoles` is kept for compatibility. The product presentation is still one ranked list.

## Code Map

Primary code:

- `extension/algo.js`
  - `resolveTopTakes`
  - `readQuoteTweetsForSource`
  - `dedupeQuoteTweets`
  - `attachTopCommentsToQuoteTweets`
  - `buildTopTakesCandidateBatch`
  - `normalizeTopTakesClassification`
  - `groupTopTakes`
- `extension/background.js`
  - `resolveTopTakes`
  - `callOpenAiTopTakesBatch`
- `extension/content.js`
  - `resolveTopTakesArtifact`
  - `renderTopTakesTab`
  - `formatTopTakesProgressMessage`

Local runner:

```bash
node scripts/run_top_takes.js https://x.com/handle/status/123
```
