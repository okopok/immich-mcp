# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app

# Optional: update the Immich SDK (and therefore the API spec) during the build.
# Examples: --build-arg IMMICH_SDK_VERSION=3.3.0  or  =latest
# When empty, the version pinned in package.json is used.
ARG IMMICH_SDK_VERSION=

COPY package.json package-lock.json ./
RUN if [ -n "$IMMICH_SDK_VERSION" ]; then \
      npm install --save-exact @immich/sdk@"$IMMICH_SDK_VERSION"; \
    else \
      npm ci; \
    fi

COPY tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY spec ./spec
COPY src ./src

# Cache buster for the spec refresh, declared after the dependency layer so it
# does not invalidate `npm ci`. Any change forces a fresh download even when
# every other input is unchanged (CI passes the run id; locally pass a
# timestamp: IMMICH_REFRESH=$(date +%s) docker compose build).
ARG IMMICH_REFRESH=

# Refresh the Immich OpenAPI specification + SDK typings, regenerate the MCP
# tool manifest from it, then compile.
RUN echo "immich-refresh=${IMMICH_REFRESH:-none}" \
 && node scripts/fetch-spec.mjs \
 && npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    IMMICH_MCP_TRANSPORT=http \
    IMMICH_MCP_HTTP_HOST=0.0.0.0 \
    IMMICH_MCP_HTTP_PORT=3000
WORKDIR /app

# Reuse the (possibly SDK-updated) manifests from the build stage.
COPY --from=build /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.IMMICH_MCP_HTTP_PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
