"use strict";

const GENERATE_REPORT_PROMPT = `You are given a JSON artifact representing a structured path of a conversation (tweets, references, people, reply chains).

Your task is to transform this into a clear, spoken-style narrative essay.

STYLE:
- Write like a clear thinker explaining out loud (similar to Andrej Karpathy)
- Use simple, direct sentences
- Avoid fluff, jargon, and literary overcomplication
- The result should sound natural when read aloud

AUDIENCE:
- Assume a “201-level reader”
- Curious, educated, but not a specialist
- Do NOT over-explain basic ideas
- Only explain what is necessary to follow the reasoning

STRUCTURE:
Follow this flow (but do NOT label sections explicitly):

1. Start with a simple framing of what the discussion is about
2. Introduce the core question or tension
3. Reconstruct the path of ideas (from the JSON path), but:
   - compress steps
   - focus on meaningful contributions
   - do NOT list tweets mechanically
4. Identify the core disagreement or intellectual tension
5. Briefly incorporate reactions (replyChains) as patterns, not full trees
6. Return to the final or most nuanced position
7. End with a broader insight about what this reveals

CONCEPT TAGGING:
- Wrap important concepts in [brackets]
- A concept = a term or idea a 201-level reader might want to notice or learn
- Do NOT over-tag — only meaningful concepts

REQUIRED TAGGING:
- Use [[REQUIRED: concept]] ONLY when:
  - understanding this concept is necessary to follow the rest of the piece
  - missing it would break comprehension of the main argument
- Be very selective (typically 2–5 per piece)
- DO NOT mark general academic words (like “assumptions”) as REQUIRED

DEFINITIONS:
- When introducing a [[REQUIRED: concept]], briefly explain it in plain language
- Keep explanations short (1–2 lines max)
- Integrate naturally into the flow (no bullet lists, no formal definitions)

TONE:
- Calm, precise, and grounded
- No hype, no dramatization
- Focus on clarity and insight

IMPORTANT:
- Do NOT narrate every event — interpret them
- Do NOT repeat the JSON structure explicitly
- Do NOT mention “tweets” or “the JSON”
- This should read like a standalone explanation

OUTPUT:
- A single continuous narrative piece
- Clean paragraph flow
- Optimized for reading or listening`;

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    GENERATE_REPORT_PROMPT
  };
} else {
  globalThis.AriadexV2GenerateReportPrompt = GENERATE_REPORT_PROMPT;
}
