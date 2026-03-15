Efficient Graph Algorithm
=========================

Purpose
-------

This document defines the intended efficient Ariadex graph algorithm.

It is written at the pseudocode level in structured prose.
It describes the target algorithmic behavior, not the current implementation details.

The algorithm is designed to be:

- path-first
- cache-first
- reference-aware
- best-first
- persistent
- cheap on revisits

The main design goal is not merely correctness.
It is efficient correctness.

That means:

- no repeated payment for known tweets
- no repeated payment for known references
- no broad recollection when reusable graph primitives already exist
- constant-time hit or miss checks before any network call


Design Principle
----------------

The algorithm should not be centered on "collect a big conversation and then trim it".

It should be centered on:

- persistent graph primitives
- deterministic ancestor tracing
- ordered frontier expansion

In other words:

- store small reusable pieces first
- compose the explored artifact from those pieces
- never rebuild known stable pieces unless the algorithm version changes


Core Entities
-------------

Explored Tweet
  The tweet where the user clicked `Explore`.

Parent
  The parent of a tweet is determined from that tweet's own structure.

  - if the tweet is a quote tweet, parent is the quoted tweet
  - else if the tweet is a reply, parent is the replied-to tweet
  - else the tweet has no parent

Root
  The first tweet reached in the parent walk that is neither a quote nor a reply.

Ancestor Path
  The ordered chain starting at the explored tweet and ending at the root.

Mandatory Path
  The ancestor path, treated as always-included context.

Candidate Child
  A direct child tweet discovered during expansion.

Canonical Reference
  A normalized external source identity used to merge equivalent raw URLs.

Ordered Frontier
  A priority queue of expansion candidates, sorted by ThinkerRank.

Explored Artifact
  The final structured result for a single explored tweet.


Persistent Primitive Caches
---------------------------

The algorithm is built around persistent primitive caches.

These caches must live on disk or in a persistent database-like store.
They are not temporary in-memory conveniences.

Required cache layers:

Tweet Cache
  Keyed by stable tweet id.

  Stores:
  - normalized tweet entity
  - parent relation metadata
  - author metadata already known
  - fetch timestamp
  - normalization version

User Cache
  Keyed by stable user id.

  Stores:
  - normalized user entity

Reference Cache
  Keyed by canonical reference hash.

  Stores:
  - canonical URL
  - normalized domain
  - reference type
  - canonical metadata

Tweet-Reference Edge Cache
  Keyed by tweet id.

  Stores:
  - all canonical reference ids cited by that tweet

Reply Bag Cache
  Keyed by parent tweet id.

  Stores:
  - direct reply child ids
  - retrieval metadata

Quote Bag Cache
  Keyed by parent tweet id.

  Stores:
  - direct quote child ids
  - retrieval metadata

Ancestor Path Cache
  Keyed by explored tweet id plus algorithm-version signature.

  Stores:
  - ordered ancestor path ids

Explored Artifact Cache
  Keyed by explored tweet id plus algorithm-version signature.

  Stores:
  - final assembled graph artifact
  - diagnostics


Constant-Time Cache Rule
------------------------

Before any network call, the algorithm must:

- compute the appropriate stable cache key
- check persistent storage
- decide hit or miss immediately

This check should be effectively O(1).

Examples:

- tweet hit check:
  - by tweet id
- user hit check:
  - by user id
- reference hit check:
  - by canonical URL hash
- explored artifact hit check:
  - by explored tweet id plus algorithm version

If the primitive is present and valid:

- load it
- do not call the API

If the primitive is missing:

- fetch it
- normalize it
- persist it immediately


Reference Collection Rule
-------------------------

Reference collection happens across the whole algorithm.

It is not limited to root finding.

References must be collected:

- from the explored tweet
- from every tweet on the mandatory path
- from every expanded kept tweet

For every kept tweet:

- inspect text URLs
- inspect entity-backed URLs
- inspect media or card-backed external links when available
- inspect videos, papers, documents, and other off-X references when available
- discard internal X links as evidence references
- canonicalize every remaining external reference
- merge them into the canonical reference cache
- write tweet-to-reference edges

The purpose is to ensure that the final artifact points to a small stable set of canonical references, even when many tweets cite equivalent URLs.


Substance Filter
----------------

The expansion algorithm must ignore low-substance tweets.

Default rule:

- ignore any tweet with fewer than 200 characters

This filter is applied before a tweet enters the ordered frontier.


Parent Trace
------------

The algorithm starts from the explored tweet and walks upward deterministically.

For the current tweet:

- if it is structurally a quote tweet, move to the quoted tweet
- else if it is structurally a reply, move to the replied-to tweet
- else stop

Then repeat the same rule on the parent.

This continues until a tweet has no parent.
That tweet is the root.

The complete path from explored tweet to root is the mandatory path.


Ordered Expansion
-----------------

After the mandatory path is known, expansion begins.

Expansion is not broad graph crawling.
Expansion is not force-directed.
Expansion is not root-only collection.

Expansion is a best-first traversal using an ordered frontier.

Each frontier entry contains:

- tweet id
- parent tweet id
- depth
- ThinkerRank score

The frontier is ordered by score.

The next tweet to expand is always chosen by the ordering strategy, not by retrieval order.


ThinkerRank Role
----------------

ThinkerRank is the ordering function used to prioritize expansion.

It decides:

- which eligible candidate children should be expanded
- the order in which they should be visited

ThinkerRank can combine:

- likes
- quotes
- replies
- author reach
- author follower count
- path proximity
- structural relation signals
- other bounded relevance signals

But the algorithm does not depend on a specific exact formula here.

The algorithm only depends on the existence of a stable ranking function used to order the frontier.


Efficient Traversal Procedure
-----------------------------

Algorithm: Persistent Path Trace Then Best-First Expansion

Inputs:

- explored tweet id
- maximum depth
- maximum total expanded tweets
- maximum children kept per expanded tweet
- minimum text length, default 200 characters
- minimum acceptable ThinkerRank score
- algorithm version signature

State:

- persistent primitive caches
- stored tweets in insertion order
- stored canonical references
- tweet-to-reference edges
- ordered ancestor path
- visited tweet ids
- ordered frontier
- expansion order

Procedure:

1. Compute the explored artifact cache key.

2. Check the persistent explored artifact cache.

3. If the explored artifact already exists for the current algorithm version:

   - load it
   - return immediately

4. Otherwise begin ancestor tracing.

5. Set the current tweet id to the explored tweet id.

6. While the current tweet exists and has not already been visited in the ancestor walk:

   - check the persistent tweet cache using the current tweet id
   - if present, load the normalized tweet
   - else fetch it, normalize it, and persist it immediately
   - store the tweet in the current artifact
   - collect and canonicalize references from that tweet
   - persist tweet-to-reference edges
   - append the tweet to the ancestor path
   - inspect the tweet's own structure
   - if it is a quote tweet, set current tweet id to the quoted tweet id
   - else if it is a reply, set current tweet id to the replied-to tweet id
   - else stop

7. Persist the ancestor path for the explored tweet.

8. For every tweet in the mandatory path:

   - check the persistent reply bag cache
   - if missing, fetch direct replies and persist the reply bag
   - check the persistent quote bag cache
   - if missing, fetch direct quotes and persist the quote bag
   - merge those direct children into a candidate set
   - reject any candidate under 200 characters
   - compute ThinkerRank for each remaining candidate
   - reject any candidate below the minimum score
   - keep only the top configured number
   - push them into the ordered frontier

9. While the ordered frontier is not empty:

   - if the expansion budget is exhausted, stop
   - pop the highest-ranked frontier entry
   - if that tweet id was already visited, skip it
   - mark it visited
   - check the persistent tweet cache for that tweet id
   - if present, load it
   - else fetch it, normalize it, and persist it immediately
   - store the tweet in the artifact
   - collect and canonicalize references from that tweet
   - persist tweet-to-reference edges
   - record its expansion order
   - if the depth limit has been reached, continue
   - check the persistent reply bag cache for this tweet
   - if missing, fetch direct replies and persist the reply bag
   - check the persistent quote bag cache for this tweet
   - if missing, fetch direct quotes and persist the quote bag
   - merge those direct children into a candidate set
   - reject any child under 200 characters
   - reject already visited children
   - compute ThinkerRank for the remaining candidates
   - reject any candidate below the minimum score
   - keep only the top configured number
   - push those candidates into the frontier

10. Assemble the explored artifact from:

   - explored tweet id
   - root tweet id
   - ancestor path
   - stored tweets
   - expansion order
   - canonical references
   - tweet-to-reference edges
   - diagnostics

11. Persist the explored artifact under its stable cache key.

12. Return the artifact.


Why This Is Efficient
---------------------

This design is efficient because it separates reusable primitives from per-explored assembly.

Known tweet:
  no tweet fetch

Known reply bag:
  no reply collection

Known quote bag:
  no quote collection

Known canonical reference:
  no repeated normalization work

Known explored artifact:
  no traversal at all

So the expensive parts become one-time costs for stable data.


What Is Persistent
------------------

The following should survive server restarts:

- tweet entities
- user entities
- reply bags
- quote bags
- canonical references
- tweet-reference edges
- ancestor paths
- explored artifacts

This persistence is required for the algorithm to remain cheap over time.


What Must Be Versioned
----------------------

The following must participate in cache versioning:

- tweet normalization rules
- reference canonicalization rules
- ThinkerRank scoring version
- traversal limits
- artifact schema

If any of these change materially, explored artifacts should roll to a new version key.

Primitive caches may still remain reusable when safe.


Ordering Guarantees
-------------------

The algorithm guarantees:

- the explored tweet is always included
- the full path to root is always included
- references are collected across the full kept set
- low-substance tweets never enter expansion
- expansion order is determined by ThinkerRank
- cache checks happen before API calls


Resulting Artifact
------------------

The output is a reusable graph artifact.

At minimum it contains:

- explored tweet id
- root tweet id
- ordered ancestor path
- stored kept tweets
- ordered expansion set
- canonical references
- tweet-to-reference edges
- diagnostics
- cache metadata

This artifact can then drive:

- digest generation
- graph rendering
- people ranking
- reference views
- audio rendering


What This Algorithm Is
----------------------

This algorithm is:

- path-anchored
- persistent
- cache-first
- reference-aware
- best-first
- bounded


What This Algorithm Is Not
--------------------------

This algorithm is not:

- a broad conversation scrape followed by trimming
- a force-directed graph crawl
- a root-only collection strategy
- a one-shot transient pipeline with no reusable primitives
