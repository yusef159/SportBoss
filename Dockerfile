FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DATA_DIR=/data
RUN mkdir -p /data && touch /data/.keep && chown -R node:node /data
COPY --chown=node:node package.json catalog.json server.mjs reminders.mjs ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node public ./public
COPY --chown=node:node tools/backup.mjs ./tools/backup.mjs
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
