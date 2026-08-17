# Third-party notices

FreshContext source is MIT licensed. The components below retain their own copyrights and licenses.
Exact JavaScript package versions and the full transitive dependency graph are recorded in
`pnpm-lock.yaml`.

## Runtime and protocol

- [HydraDB OSS](https://github.com/hydra-db/hydradb), v0.1.1, is licensed under AGPL-3.0.
  FreshContext runs the official pinned HydraDB container as a separate graph database service and
  communicates with it over HTTP. No HydraDB source is copied into this repository.
- [Node.js](https://github.com/nodejs/node), used through the pinned `node:24.14.1-alpine` image, is
  MIT licensed. Packages included by the Alpine base image retain their own licenses.
- [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) is
  MIT licensed.

## Application libraries

- [Fastify](https://github.com/fastify/fastify) and
  [@fastify/static](https://github.com/fastify/fastify-static) are MIT licensed.
- [React](https://github.com/facebook/react), React DOM, and
  [React Router](https://github.com/remix-run/react-router) are MIT licensed.
- [ts-morph](https://github.com/dsherret/ts-morph) is MIT licensed.
- [Zod](https://github.com/colinhacks/zod) is MIT licensed.

## Build and test tools

- [Vite](https://github.com/vitejs/vite), [Vitest](https://github.com/vitest-dev/vitest),
  [ESLint](https://github.com/eslint/eslint), [Prettier](https://github.com/prettier/prettier), and
  [tsx](https://github.com/privatenumber/tsx) are MIT licensed.
- [TypeScript](https://github.com/microsoft/TypeScript) and
  [Playwright](https://github.com/microsoft/playwright) are Apache-2.0 licensed.

## Fonts

The bundled Inter, JetBrains Mono, and Fragment Mono font files are installed through Fontsource
packages and licensed under SIL Open Font License 1.1.

## Development assistance

OpenAI Codex assisted the solo participant with research, implementation, tests, and documentation.
The participant directed the work, made the product decisions, and reviewed the final result.
