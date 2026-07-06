FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS base

# renovate: datasource=github-releases depName=restic/restic versioning=semver extractVersion=^v?(?<version>.+)$
ARG RESTIC_VERSION="0.19.0"
# renovate: datasource=github-releases depName=rclone/rclone versioning=semver extractVersion=^v?(?<version>.+)$
ARG RCLONE_VERSION="1.74.3"
# renovate: datasource=github-releases depName=nicholas-fedor/shoutrrr versioning=semver extractVersion=^v?(?<version>.+)$
ARG SHOUTRRR_VERSION="0.16.1"

ENV VITE_RESTIC_VERSION=${RESTIC_VERSION} \
    VITE_RCLONE_VERSION=${RCLONE_VERSION} \
    VITE_SHOUTRRR_VERSION=${SHOUTRRR_VERSION}

RUN apk add --no-cache \
	acl=2.3.2-r1 \
	attr=2.5.2-r2 \
	cifs-utils=7.3-r0 \
	davfs2=1.6.1-r2 \
	fuse3=3.16.2-r1 \
	openssh-client-default=10.0_p1-r10 \
	sshfs=3.7.6-r0 \
	tini=0.19.0-r3 \
	tzdata=2026b-r0

ENTRYPOINT ["/sbin/tini", "-s", "--"]


# ------------------------------
# DEPENDENCIES
# ------------------------------
FROM base AS deps

WORKDIR /deps

ARG TARGETARCH
ENV TARGETARCH=${TARGETARCH}

RUN apk add --no-cache \
	bzip2=1.0.8-r6 \
	curl=8.14.1-r2 \
	tar=1.35-r3 \
	unzip=6.0-r15

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
FROM base AS runtime-tools

COPY --from=deps /deps/restic /usr/local/bin/restic
COPY --from=deps /deps/rclone /usr/local/bin/rclone
COPY --from=deps /deps/shoutrrr /usr/local/bin/shoutrrr

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
COPY ./packages/core/package.json ./packages/core/package.json
COPY ./packages/contracts/package.json ./packages/contracts/package.json
COPY ./apps/agent/package.json ./apps/agent/package.json
COPY ./apps/docs/package.json ./apps/docs/package.json
COPY ./apps/desktop/package.json ./apps/desktop/package.json

RUN VITE_GIT_HOOKS=0 bun install --frozen-lockfile --ignore-scripts

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
COPY ./packages/core/package.json ./packages/core/package.json
COPY ./packages/contracts/package.json ./packages/contracts/package.json
COPY ./apps/agent/package.json ./apps/agent/package.json
COPY ./apps/docs/package.json ./apps/docs/package.json
COPY ./apps/desktop/package.json ./apps/desktop/package.json

RUN VITE_GIT_HOOKS=0 bun install --frozen-lockfile

COPY . .

RUN bun run build
RUN bun build apps/agent/src/index.ts --outfile .output/agent/index.mjs --target bun

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
