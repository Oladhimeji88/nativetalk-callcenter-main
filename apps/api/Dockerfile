# UCP API (NestJS) — multi-stage build. Build context = repo root.
#   docker build -f apps/api/Dockerfile -t ucp-api .
FROM node:22-bookworm-slim AS deps
WORKDIR /repo
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @ucp/api --include-workspace-root

FROM deps AS build
WORKDIR /repo
COPY apps/api ./apps/api
RUN npx --workspace @ucp/api prisma generate \
 && npm run --workspace @ucp/api build

FROM node:22-bookworm-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
WORKDIR /repo/apps/api
EXPOSE 4000
# Run migrations then start (deploy = non-interactive, safe for prod).
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
