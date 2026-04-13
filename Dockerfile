# Build stage
FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# Runtime stage
FROM node:22-slim
RUN groupadd -r mcp && useradd -r -g mcp mcp
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
RUN chown -R mcp:mcp /app
USER mcp

ENV GDRIVE_MCP_TRANSPORT=http
ENV GDRIVE_MCP_PORT=8080
ENV GDRIVE_MCP_HOST=0.0.0.0
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "const http = require('http'); http.get('http://localhost:8080/health', (r) => { if (r.statusCode !== 200) throw new Error(); }).on('error', () => { process.exit(1); })"

CMD ["node", "dist/index.js"]
