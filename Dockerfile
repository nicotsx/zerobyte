ARG BUN_VERSION="1.3.6"

FROM oven/bun:${BUN_VERSION}-alpine AS base

ARG RESTIC_VERSION="0.18.1"
ARG RCLONE_VERSION="1.73.0"
ARG SHOUTRRR_VERSION="0.13.1"

ENV VITE_RESTIC_VERSION=${RESTIC_VERSION} \
    VITE_RCLONE_VERSION=${RCLONE_VERSION} \
    VITE_SHOUTRRR_VERSION=${SHOUTRRR_VERSION}

RUN apk update --no-cache && \
    apk upgrade --no-cache && \
    apk add --no-cache davfs2=1.6.1-r2 openssh-client fuse3 sshfs tini

ENTRYPOINT ["/sbin/tini", "-s", "--"]


# ------------------------------
# DEPENDENCIES
# ------------------------------
FROM base AS deps

WORKDIR /deps

ARG TARGETARCH
ENV TARGETARCH=${TARGETARCH}

RUN apk add --no-cache curl bzip2 unzip tar

RUN echo "Building for ${TARGETARCH}"
RUN if [ "${TARGETARCH}" = "arm64" ]; then \
	    curl -L -o restic.bz2 "https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_linux_arm64.bz2"; \
      curl -L -o rclone.zip "https://github.com/rclone/rclone/releases/download/v${RCLONE_VERSION}/rclone-v${RCLONE_VERSION}-linux-arm64.zip"; \
      unzip rclone.zip; \
      curl -L -o shoutrrr.tar.gz "https://github.com/nicholas-fedor/shoutrrr/releases/download/v${SHOUTRRR_VERSION}/shoutrrr_linux_arm64v8_${SHOUTRRR_VERSION}.tar.gz"; \
      elif [ "${TARGETARCH}" = "amd64" ]; then \
      curl -L -o restic.bz2 "https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_linux_amd64.bz2"; \
      curl -L -o rclone.zip "https://github.com/rclone/rclone/releases/download/v${RCLONE_VERSION}/rclone-v${RCLONE_VERSION}-linux-amd64.zip"; \
      unzip rclone.zip; \
      curl -L -o shoutrrr.tar.gz "https://github.com/nicholas-fedor/shoutrrr/releases/download/v$SHOUTRRR_VERSION/shoutrrr_linux_amd64_${SHOUTRRR_VERSION}.tar.gz"; \
      fi

RUN bzip2 -d restic.bz2 && chmod +x restic
RUN mv rclone-v*-linux-*/rclone /deps/rclone && chmod +x /deps/rclone
RUN tar -xzf shoutrrr.tar.gz && chmod +x shoutrrr

# ------------------------------
# DEVELOPMENT
# ------------------------------
FROM base AS development

ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
ENV VITE_APP_VERSION=${APP_VERSION}
ENV NODE_ENV="development"

WORKDIR /app

COPY --from=deps /deps/restic /usr/local/bin/restic
COPY --from=deps /deps/rclone /usr/local/bin/rclone
COPY --from=deps /deps/shoutrrr /usr/local/bin/shoutrrr

COPY ./package.json ./bun.lock ./

RUN bun install --frozen-lockfile --ignore-scripts

COPY . .

EXPOSE 3000

CMD ["bun", "run", "dev"]

# ------------------------------
# PRODUCTION
# ------------------------------
FROM base AS builder

ARG APP_VERSION=dev
ENV VITE_APP_VERSION=${APP_VERSION}
ENV PORT=4096

WORKDIR /app

COPY ./package.json ./bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

RUN bun run build

FROM base AS production

ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
ENV NODE_ENV="production"
ENV PORT=4096

WORKDIR /app

COPY --from=builder /app/package.json ./

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

CMD ["bun", ".output/server/index.mjs"]
