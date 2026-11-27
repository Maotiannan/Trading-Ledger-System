FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG CIRCLE_NODE_TOTAL
ARG NODE_OPTIONS
RUN npx prisma generate && npm run build

FROM deps AS migration-cli
# Standalone traces the app, not the separate migration command. Retain only its locked dependency tree.
RUN node -e "const p=require('./package.json'); require('fs').writeFileSync('package.json',JSON.stringify({name:p.name,version:p.version,dependencies:{prisma:p.dependencies.prisma},overrides:p.overrides}))" \
    && npm prune --offline --ignore-scripts --omit=dev --omit=optional --no-audit --no-fund

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/package.json ./package.json
COPY --from=migration-cli /app/node_modules /opt/prisma-cli/node_modules
RUN mkdir -p node_modules/.bin \
    && ln -s /opt/prisma-cli/node_modules/prisma node_modules/prisma \
    && ln -s ../prisma/build/index.js node_modules/.bin/prisma

EXPOSE 3000

CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && exec node server.js"]
