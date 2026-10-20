# Incentive Tracker: one small container. Node's built-in HTTP server + SQLite, no npm packages, no build step.
FROM node:22-alpine

# tzdata so TZ=Asia/Karachi works ("today" and the 3-day back-dating rule use local time)
RUN apk add --no-cache tzdata

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DB_FILE=/data/incentives.db

COPY package.json ./
COPY server ./server
COPY public ./public

# the database lives in a named volume mounted at /data; run as the unprivileged "node" user (uid 1000)
RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/config >/dev/null || exit 1

CMD ["node", "server/server.js"]
