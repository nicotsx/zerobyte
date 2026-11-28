FROM oven/bun:1.4.5 AS bun
FROM caddy:2-alpine AS caddy
FROM restic/rest-server:0.15.0 AS rest-server

FROM debian:trixie-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates restic systemd systemd-sysv \
    && rm -rf /var/lib/apt/lists/*

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

COPY --from=caddy /usr/bin/caddy /usr/local/bin/caddy
COPY --from=rest-server /usr/bin/rest-server /usr/local/bin/rest-server

CMD ["/sbin/init"]
