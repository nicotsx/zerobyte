ARG BASE_IMAGE=zerobyte-integration-runtime-base:latest
FROM ${BASE_IMAGE}

WORKDIR /app

ENV NODE_ENV=test

COPY ./package.json ./bun.lock ./
COPY ./packages/core/package.json ./packages/core/package.json
COPY ./packages/contracts/package.json ./packages/contracts/package.json
COPY ./apps/agent/package.json ./apps/agent/package.json
COPY ./apps/docs/package.json ./apps/docs/package.json
COPY ./apps/desktop/package.json ./apps/desktop/package.json

RUN VITE_GIT_HOOKS=0 bun install --frozen-lockfile

COPY . .

CMD ["sh", "app/test/integration/infra/entrypoint.sh"]
