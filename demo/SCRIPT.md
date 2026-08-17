# Three-minute demo script

Target length: 2 minutes 45 seconds. The final recording must stay under the official three-minute
limit.

## 0:00 to 0:18, the problem

Show Overview.

Narration:

> Coding agents remember useful facts about a repository, but those facts become dangerous when the
> code changes. FreshContext withholds a stale claim and proves exactly which changed function and
> call path invalidated it.

This establishes the clear use case and originality.

## 0:18 to 0:35, one-command product

Keep Overview visible and point to the startup command and connected status.

Narration:

> One Docker command starts the product and pinned HydraDB OSS. It also creates and indexes this
> real two-commit TypeScript checkout example, so a judge can use the full product without an
> account, API key, or setup form.

This proves product completeness and usability.

## 0:35 to 1:25, the graph-native proof

Open Proof Console. Select “Checkout totals add a flat $2 service fee through calculateTotal.” Trace
the orange path from `fee`, through `calculateTotal`, to `Checkout.total`, then show the Git diff.

Narration:

> This claim cites `Checkout.total`, but the changed code is two calls away in `fee`. FreshContext
> indexes stable symbols and call edges in HydraDB, compares the two commits, then runs a bounded
> reverse traversal. The persisted proof is `fee`, `calculateTotal`, `Checkout.total`, and this
> memory. A same-file matcher can't recover that cross-file dependency. Because the proof is unsafe,
> recall withholds the claim instead of giving it to an agent.

This proves technical execution and meaningful graph-native HydraDB use.

## 1:25 to 1:55, changing truth safely

Use the suggested replacement and select Supersede claim. Show the replacement result and the
chronology.

Narration:

> Review creates a new evidence-bound version. It never edits or deletes the old claim. The original
> becomes superseded, the replacement becomes current, and HydraDB keeps the chronology and
> `SUPERSEDES` relationship. If this operation stops halfway, neither version enters recall until a
> safe retry completes it.

This proves a complete, failure-aware workflow.

## 1:55 to 2:25, result quality

Open Evaluation. Show the score comparison, one detected multi-hop case, and the visible four-hop
false negative.

Narration:

> The checked evaluation reruns real Git changes against the pinned HydraDB engine. Across ten
> labels, graph traversal reaches 100 percent precision and 85.7 percent recall. Direct-file
> matching reaches 60 percent precision and 42.9 percent recall. The four-hop miss stays visible
> because V1 deliberately supports zero through three reverse call hops.

This proves quality of results without hiding the boundary.

## 2:25 to 2:45, close with verifiability

Open Setup and briefly show HydraDB connected, example data, selected commit, and ingestion counts.

Narration:

> Setup confirms a real authenticated HydraDB write and read, the selected Git commit, and the
> indexed source counts. Every screen you saw is backed by the local graph or reproducible artifact.
> FreshContext gives coding agents memory that knows when the code has moved on.

## Recording fallback

If the live stack fails during recording, use `demo/video/evaluation-proof.webm` and the five images
in `demo/screenshots/` as the visual source. They were captured from the production container and
pinned HydraDB runtime. Record the final narration separately and keep the exported video below
three minutes.
