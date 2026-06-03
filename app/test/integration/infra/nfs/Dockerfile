FROM alpine:3.21

RUN apk add --no-cache nfs-utils

COPY entrypoint.sh /usr/local/bin/zerobyte-nfs-entrypoint
RUN chmod +x /usr/local/bin/zerobyte-nfs-entrypoint

EXPOSE 2049

ENTRYPOINT ["/usr/local/bin/zerobyte-nfs-entrypoint"]
