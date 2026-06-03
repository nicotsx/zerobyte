FROM alpine:3.21

RUN apk add --no-cache samba samba-common-tools samba-client

COPY entrypoint.sh /usr/local/bin/zerobyte-smb-entrypoint
RUN chmod +x /usr/local/bin/zerobyte-smb-entrypoint

EXPOSE 445

ENTRYPOINT ["/usr/local/bin/zerobyte-smb-entrypoint"]
