FROM node:26.2.0-alpine AS node-base

ARG RESTIC_VERSION="0.18.1"
ARG RCLONE_VERSION="1.74.2"
ARG SHOUTRRR_VERSION="0.15.1"

ENV VITE_RESTIC_VERSION=${RESTIC_VERSION} \
    VITE_RCLONE_VERSION=${RCLONE_VERSION} \
    VITE_SHOUTRRR_VERSION=${SHOUTRRR_VERSION}

RUN apk update --no-cache && \
    apk upgrade --no-cache && \
	apk add --no-cache acl attr cifs-utils davfs2=1.6.1-r2 openssh-client fuse3 sshfs tini tzdata

ENTRYPOINT ["/sbin/tini", "-s", "--"]

FROM node-base AS pnpm-base

WORKDIR /app

ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"

RUN npm install --global pnpm@11.5.2

COPY ./pnpm-lock.yaml ./
RUN pnpm fetch --frozen-lockfile


# ------------------------------
# DEPENDENCIES
# ------------------------------
FROM node-base AS deps

WORKDIR /deps

ARG TARGETARCH
ENV TARGETARCH=${TARGETARCH}

RUN apk add --no-cache curl bzip2 unzip tar

RUN echo "Building for ${TARGETARCH}"
RUN if [ "${TARGETARCH}" = "arm64" ]; then \
	    curl -fL -o restic.bz2 "https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_linux_arm64.bz2"; \
      curl -fL -o rclone.zip "https://github.com/rclone/rclone/releases/download/v${RCLONE_VERSION}/rclone-v${RCLONE_VERSION}-linux-arm64.zip"; \
      unzip rclone.zip; \
      curl -fL -o shoutrrr.tar.gz "https://github.com/nicholas-fedor/shoutrrr/releases/download/v${SHOUTRRR_VERSION}/shoutrrr_linux_arm64v8_${SHOUTRRR_VERSION}.tar.gz"; \
      elif [ "${TARGETARCH}" = "amd64" ]; then \
      curl -fL -o restic.bz2 "https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_linux_amd64.bz2"; \
      curl -fL -o rclone.zip "https://github.com/rclone/rclone/releases/download/v${RCLONE_VERSION}/rclone-v${RCLONE_VERSION}-linux-amd64.zip"; \
      unzip rclone.zip; \
      curl -fL -o shoutrrr.tar.gz "https://github.com/nicholas-fedor/shoutrrr/releases/download/v$SHOUTRRR_VERSION/shoutrrr_linux_amd64_${SHOUTRRR_VERSION}.tar.gz"; \
      fi

RUN bzip2 -d restic.bz2 && chmod +x restic
RUN mv rclone-v*-linux-*/rclone /deps/rclone && chmod +x /deps/rclone
RUN tar -xzf shoutrrr.tar.gz && chmod +x shoutrrr

# ------------------------------
# RUNTIME TOOLS
# ------------------------------
FROM node-base AS runtime-tools

COPY --from=deps /deps/restic /usr/local/bin/restic
COPY --from=deps /deps/rclone /usr/local/bin/rclone
COPY --from=deps /deps/shoutrrr /usr/local/bin/shoutrrr

# ------------------------------
# DEVELOPMENT
# ------------------------------
FROM pnpm-base AS development

ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
ENV VITE_APP_VERSION=${APP_VERSION}
ENV NODE_ENV="development"

WORKDIR /app

COPY --from=deps /deps/restic /usr/local/bin/restic
COPY --from=deps /deps/rclone /usr/local/bin/rclone
COPY --from=deps /deps/shoutrrr /usr/local/bin/shoutrrr

COPY ./package.json ./pnpm-lock.yaml ./pnpm-workspace.yaml ./
COPY ./packages/core/package.json ./packages/core/package.json
COPY ./packages/contracts/package.json ./packages/contracts/package.json
COPY ./apps/agent/package.json ./apps/agent/package.json
COPY ./apps/docs/package.json ./apps/docs/package.json

RUN VITE_GIT_HOOKS=0 pnpm install --frozen-lockfile

COPY . .

EXPOSE 3000

CMD ["pnpm", "run", "dev"]

# ------------------------------
# PRODUCTION
# ------------------------------
FROM pnpm-base AS builder

ARG APP_VERSION=dev
ENV VITE_APP_VERSION=${APP_VERSION}
ENV PORT=4096

WORKDIR /app

COPY ./package.json ./pnpm-lock.yaml ./pnpm-workspace.yaml ./
COPY ./packages/core/package.json ./packages/core/package.json
COPY ./packages/contracts/package.json ./packages/contracts/package.json
COPY ./apps/agent/package.json ./apps/agent/package.json
COPY ./apps/docs/package.json ./apps/docs/package.json

RUN VITE_GIT_HOOKS=0 pnpm install --frozen-lockfile

COPY . .

RUN pnpm run build
RUN pnpm exec esbuild apps/agent/src/index.ts --bundle --platform=node --format=esm --outfile=.output/agent/index.mjs
RUN mkdir -p .node-runtime/node_modules && cp -R -L node_modules/ws .node-runtime/node_modules/ws

FROM node-base AS production

ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
ENV NODE_ENV="production"
ENV PORT=4096

WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/.node-runtime/node_modules ./node_modules

COPY --from=deps /deps/restic /usr/local/bin/restic
COPY --from=deps /deps/rclone /usr/local/bin/rclone
COPY --from=deps /deps/shoutrrr /usr/local/bin/shoutrrr
COPY --from=builder /app/.output ./.output
COPY --from=builder /app/app/drizzle ./assets/migrations

# Include third-party licenses and attribution
COPY ./LICENSES ./LICENSES
COPY ./NOTICES.md ./NOTICES.md
COPY ./LICENSE ./LICENSE.md

EXPOSE 4096

CMD ["node", ".output/server/index.mjs"]
