# Top Takes Benchmark Suite

This directory is the canonical home for research fixtures used to compare Top Takes iterations.

Each fixture should capture:

- the source tweet URL and domain
- the retrieval settings used for the run
- expected high-signal perspectives
- expected low-signal or redundant patterns
- missing-perspective notes
- UX comprehension notes
- persisted run outputs under `runs/`

The benchmark target is understanding gain, not popularity. A good run should surface the smallest representative set that explains the important perspectives around the source tweet.

## Iteration Log Format

For each substantial algorithm or UX change, record:

- hypothesis
- expected effect
- observed outcome
- regression risks
- command or fixture run used for comparison

Generated run outputs belong under `benchmarks/top_takes/runs/` and should remain local unless intentionally curated.
