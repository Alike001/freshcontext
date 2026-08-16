# FreshContext

FreshContext is an evidence-bound memory layer for coding agents. It is being built for Hack Hydra
on top of the open-source HydraDB graph database.

The product goal is simple: when code changes invalidate something an agent remembers, FreshContext
withholds the stale claim and shows the exact code path that explains why.

## Current build status

The repository currently contains the reproducible runtime foundation, immutable graph persistence,
the TypeScript repository indexer, and the local MCP memory surface. It starts the released HydraDB
OSS image, generates a local bearer token outside Git, performs real graph writes and strong reads,
and exposes a fail-closed health endpoint. The indexer reads a clean Git commit, resolves tracked
files, imports, functions, methods, and calls with ts-morph, and persists the commit-scoped graph to
HydraDB. The MCP server accepts only evidence that resolves to that graph, returns current memory,
withholds unsafe memory, and distinguishes abstention from unavailable context. Impact traversal,
human review, evaluation, and the web product remain tracked as separate public issues.

## Run it

Prerequisites: Docker Engine with Docker Compose v2.

```bash
docker compose up --build --wait
```

Then open <http://localhost:3000/api/health>. A ready response means FreshContext has completed a
real authenticated write-read round trip through HydraDB. The generated credential stays in a Docker
volume and is never returned by the API.

Stop the local stack with:

```bash
docker compose down
```

Use `docker compose down --volumes` only when you intentionally want to delete the local HydraDB
data and generated token.

## Local quality checks

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm test:integration
```

The integration test creates an isolated Compose project, proves the real HydraDB round trip, runs
the immutable graph, real Git indexer, and MCP stdio contracts against the pinned engine, verifies
retry and overwrite behavior, stops HydraDB to prove that health fails closed, and removes only that
isolated project's containers and volume.

## Agent tool contract

The local stdio server publishes three bounded tools:

- `freshcontext_remember` stores a claim only after every cited symbol resolves at the selected
  indexed commit.
- `freshcontext_recall` returns current claims for an exact symbol, reports withheld unsafe matches,
  and explicitly abstains when no safe claim exists.
- `freshcontext_status` reports the selected completed index and its real ingestion counts.

The MCP process is packaged in the `mcp-runtime` Docker target. Its contract test spawns the real
stdio process and exercises it against the pinned HydraDB container. There is no in-memory or second
database fallback.

## Why HydraDB matters

HydraDB will store code structure, evidence-linked memories, commit chronology, and transitive
impact paths. FreshContext's core result depends on graph traversal across those relationships.
There is no fallback database or hardcoded success path.

The runtime is pinned to HydraDB `v0.1.1`, source revision
`02a40025d2d57e97ab2754c8256219cdbfeab379`, using the multi-platform image digest:

```text
ghcr.io/hydra-db/hydradb@sha256:db78309a233be54662db29744047e985a39b51c45a270d1a1f47c31a62cdb709
```

## License

[MIT](LICENSE)
