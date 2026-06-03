FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0

ARG RESTIC_VERSION="0.18.1"
ARG RCLONE_VERSION="1.74.0"
ARG SHOUTRRR_VERSION="0.14.3"
ARG TARGETARCH

WORKDIR /app

RUN apk update --no-cache && \
    apk upgrade --no-cache && \
	apk add --no-cache acl attr cifs-utils curl bzip2 unzip tar davfs2=1.6.1-r2 openssh-client fuse3 sshfs tini tzdata

COPY ./package.json ./bun.lock ./
COPY ./packages/core/package.json ./packages/core/package.json
COPY ./packages/contracts/package.json ./packages/contracts/package.json
COPY ./apps/agent/package.json ./apps/agent/package.json
COPY ./apps/docs/package.json ./apps/docs/package.json

RUN VITE_GIT_HOOKS=0 bun install --frozen-lockfile

COPY . .

RUN bun run build:backend-integration

RUN echo "Building for ${TARGETARCH}" && if [ "${TARGETARCH}" = "arm64" ]; then \
	    curl -fL -o restic.bz2 "https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_linux_arm64.bz2"; \
	    curl -fL -o rclone.zip "https://github.com/rclone/rclone/releases/download/v${RCLONE_VERSION}/rclone-v${RCLONE_VERSION}-linux-arm64.zip"; \
	    unzip rclone.zip; \
	    curl -fL -o shoutrrr.tar.gz "https://github.com/nicholas-fedor/shoutrrr/releases/download/v${SHOUTRRR_VERSION}/shoutrrr_linux_arm64v8_${SHOUTRRR_VERSION}.tar.gz"; \
	elif [ "${TARGETARCH}" = "amd64" ]; then \
	    curl -fL -o restic.bz2 "https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_linux_amd64.bz2"; \
	    curl -fL -o rclone.zip "https://github.com/rclone/rclone/releases/download/v${RCLONE_VERSION}/rclone-v${RCLONE_VERSION}-linux-amd64.zip"; \
	    unzip rclone.zip; \
	    curl -fL -o shoutrrr.tar.gz "https://github.com/nicholas-fedor/shoutrrr/releases/download/v${SHOUTRRR_VERSION}/shoutrrr_linux_amd64_${SHOUTRRR_VERSION}.tar.gz"; \
	else \
	    echo "Unsupported TARGETARCH: ${TARGETARCH}" >&2; \
	    exit 1; \
	fi

RUN bzip2 -d restic.bz2 && install -m 0755 restic /usr/local/bin/restic
RUN mv rclone-v*-linux-*/rclone /usr/local/bin/rclone && chmod +x /usr/local/bin/rclone
RUN tar -xzf shoutrrr.tar.gz && install -m 0755 shoutrrr /usr/local/bin/shoutrrr

ENTRYPOINT ["/sbin/tini", "-s", "--"]

CMD ["bun", ".output/backend-integration/index.js"]
