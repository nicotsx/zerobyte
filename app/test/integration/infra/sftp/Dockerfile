FROM alpine:3.21

RUN apk add --no-cache openssh-client openssh-server

COPY entrypoint.sh /usr/local/bin/zerobyte-sftp-entrypoint
RUN chmod +x /usr/local/bin/zerobyte-sftp-entrypoint

EXPOSE 22

ENTRYPOINT ["/usr/local/bin/zerobyte-sftp-entrypoint"]
