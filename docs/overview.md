# AriadeX Overview

AriadeX is a path explorer for X conversations.

Its core question is:

> How did this tweet get here, and what important context hangs off that path?

The answer is not a feed, a full graph, or an opaque summary. It is a structured artifact that keeps the evidence visible.

## Mental Model

AriadeX treats a clicked tweet as the end of a path.

The path is resolved by following explicit X relationships backward:

- quote target
- replied-to tweet
- stop at root

Once AriadeX has the path, it builds four companion views:

- `Root Path`: the spine from root to explored tweet
- `References`: external links cited along that spine
- `People`: authors and mentioned users on that spine
- `Replies`: reply pockets where path authors participate

Report and gist generation are optional narrative layers on top of the artifact.

## What AriadeX Is Good At

AriadeX is useful when you land on a tweet and need to answer:

- What original tweet or quote chain led here?
- Which sources were cited along the way?
- Which people are involved or mentioned?
- Where did the path authors show up in replies?
- Can this artifact be turned into a readable report?
- Can I export the evidence as JSON?

## What AriadeX Is Not

AriadeX is intentionally not:

- a whole-conversation crawler
- a ranking engine
- a replacement X client
- a background surveillance tool
- a general social graph database

It explores one clicked tweet at a time.

## Primary Artifact

The extension produces one artifact per explored tweet:

- `path`
  Ordered root-to-explored tweet chain.

- `references`
  Deduped canonical external URLs from path tweets.

- `people`
  Deduped canonical X users from path authors and mentions.

- `replyChains`
  Anchored reply subtrees under path tweets where path authors appear.

The artifact can be exported as JSON, sent to the local report backend, or sent to the local gist backend.

## Trust Model

AriadeX keeps its generated text downstream of visible structure.

The resolver builds the artifact first. The report backend only receives that artifact after the user asks for a report or gist. This keeps source collection deterministic and makes generated prose optional.

## Current Limitations

- X API visibility can differ from what the X web UI displays.
- Recent search may omit deleted, hidden, old, or inaccessible replies.
- Reference extraction depends on X API `entities.urls`.
- The backend currently supports OpenAI-compatible chat completions only.
- The extension expects local developer setup, not packaged distribution.
