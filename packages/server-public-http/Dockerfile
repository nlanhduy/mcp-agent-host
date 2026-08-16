# Multi-stage build for the public team-log MCP server.
# Build context is the REPOSITORY ROOT, not this directory, because the server
# depends on the @hw/shared workspace:
#   docker build -f packages/server-public-http/Dockerfile -t team-log .

FROM node:22-alpine AS builder
WORKDIR /app

# Copy manifests first so `npm ci` is cached across source-only changes.
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server-public-http/package.json ./packages/server-public-http/

# The lockfile covers all workspaces; installing them all keeps the build
# reproducible even though only two are compiled below.
RUN npm install --ignore-scripts

COPY packages/shared ./packages/shared
COPY packages/server-public-http ./packages/server-public-http

RUN npx tsc --build packages/shared packages/server-public-http

# --- runtime -----------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/server-public-http/package.json ./packages/server-public-http/
COPY --from=builder /app/packages/server-public-http/dist ./packages/server-public-http/dist

# Standup entries live here. Mount a volume at this path for durable storage.
ENV DATA_DIR=/app/data
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

# PaaS hosts override PORT; 3002 is the local default.
ENV PORT=3002
EXPOSE 3002

# MCP_API_KEY must be supplied at run time — the server refuses to start without it.
CMD ["node", "packages/server-public-http/dist/index.js"]
