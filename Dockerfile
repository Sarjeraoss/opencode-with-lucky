FROM node:22-bookworm-slim
WORKDIR /app
COPY bridge/openai-mcp-server.js ./bridge/openai-mcp-server.js
ENV NODE_ENV=production
ENV PORT=10000
EXPOSE 10000
USER node
CMD ["node", "bridge/openai-mcp-server.js"]
