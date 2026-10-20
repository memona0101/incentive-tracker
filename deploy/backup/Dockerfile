# Nightly encrypted backup of the Incentive Tracker SQLite database (see backup.sh).
FROM alpine:3.20
RUN apk add --no-cache sqlite openssl tzdata
COPY backup.sh /usr/local/bin/backup.sh
RUN chmod 755 /usr/local/bin/backup.sh
CMD ["/usr/local/bin/backup.sh"]
