FROM alpine:3.21

RUN apk add --no-cache apache2 apache2-utils apache2-webdav curl

COPY entrypoint.sh /usr/local/bin/zerobyte-webdav-entrypoint
RUN chmod +x /usr/local/bin/zerobyte-webdav-entrypoint

EXPOSE 80

ENTRYPOINT ["/usr/local/bin/zerobyte-webdav-entrypoint"]
