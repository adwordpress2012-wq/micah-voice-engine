# micah-dialogflow (repo root) — builds `micah-realtime-bridge` for Fly.io.
# Use this when you run `fly launch` / `fly deploy` from the repository root.
# For a slimmer context, you can instead: `cd micah-realtime-bridge && fly deploy`.

FROM node:22-alpine AS builder
WORKDIR /app

COPY micah-realtime-bridge/package.json micah-realtime-bridge/package-lock.json ./
RUN npm ci

COPY micah-realtime-bridge/tsconfig.json ./
COPY micah-realtime-bridge/src ./src
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY micah-realtime-bridge/package.json micah-realtime-bridge/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

RUN chown -R node:node /app
USER node

EXPOSE 8080
CMD ["node", "dist/server.js"]
