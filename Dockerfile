FROM node:24.14.1-alpine AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/hydra/package.json packages/hydra/package.json

RUN pnpm install --frozen-lockfile

COPY apps/server apps/server
COPY packages/hydra packages/hydra

RUN pnpm build
RUN pnpm --filter @freshcontext/server deploy --prod /prod/freshcontext

FROM node:24.14.1-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /prod/freshcontext ./

USER node

EXPOSE 3000

CMD ["node", "dist/start.js"]
