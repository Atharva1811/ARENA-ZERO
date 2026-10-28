# ==============================================================================
# ARENA ZERO — Authoritative Multiplayer Colyseus Game Server Dockerfile
# ==============================================================================
FROM node:22-alpine AS base

WORKDIR /app

# Copy server package definitions
COPY server/package*.json ./server/
COPY shared/ ./shared/

# Install server dependencies
WORKDIR /app/server
RUN npm ci --omit=dev || npm install --omit=dev

# Copy server source code
COPY server/ ./

# Expose Colyseus server port
EXPOSE 2567

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:2567/health || exit 1

# Environment variables
ENV NODE_ENV=production
ENV PORT=2567

# Run server with tsx
CMD ["npx", "tsx", "src/index.ts"]
