FROM node:22-bookworm-slim

# OpenCode CLI is needed by the original bridge's execFile() integration.
# No provider credentials or application secrets are baked into the image.
RUN npm install --global @opencode/cli && \
    opencode --version

WORKDIR /app
COPY bridge/server.js ./bridge/server.js
ENV NODE_ENV=production
ENV PORT=10000
EXPOSE 10000

CMD ["node", "bridge/server.js"]
