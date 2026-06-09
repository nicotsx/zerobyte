ARG BASE_IMAGE=zerobyte-integration-runtime-base:latest
FROM ${BASE_IMAGE}

WORKDIR /app

ENV NODE_ENV=test
ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"

RUN npm install --global pnpm@11.5.2

COPY ./package.json ./pnpm-lock.yaml ./pnpm-workspace.yaml ./
COPY ./packages/core/package.json ./packages/core/package.json
COPY ./packages/contracts/package.json ./packages/contracts/package.json
COPY ./apps/agent/package.json ./apps/agent/package.json
COPY ./apps/docs/package.json ./apps/docs/package.json

RUN VITE_GIT_HOOKS=0 pnpm install --frozen-lockfile

COPY . .

CMD ["sh", "app/test/integration/infra/entrypoint.sh"]
