FROM node:24.14.1-alpine AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

RUN apk add --no-cache git
RUN corepack enable && corepack prepare pnpm@10.33.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/graph/package.json packages/graph/package.json
COPY packages/hydra/package.json packages/hydra/package.json
COPY packages/indexer/package.json packages/indexer/package.json

RUN pnpm install --frozen-lockfile

COPY apps/server apps/server
COPY packages/graph packages/graph
COPY packages/hydra packages/hydra
COPY packages/indexer packages/indexer

RUN pnpm build
RUN pnpm --filter @freshcontext/server deploy --prod /prod/freshcontext

FROM node:24.14.1-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

RUN apk add --no-cache git
COPY --from=build /prod/freshcontext ./

USER node

EXPOSE 3000

CMD ["node", "dist/start.js"]
