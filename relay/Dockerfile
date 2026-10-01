# JumpingBallsLive publish relay – one file, no dependencies. Mount a volume at /data for the keys, accounts and clips.
FROM node:22-alpine
WORKDIR /app
COPY server.mjs package.json ./
ENV NODE_ENV=production RELAY_DATA_DIR=/data PORT=8787
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "server.mjs"]
