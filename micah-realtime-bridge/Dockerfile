# micah-realtime-bridge — Twilio Media Streams ↔ OpenAI Realtime (see README.md).
# Fly.io sets PORT at runtime; image default 8080 matches many platform templates.

FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

RUN chown -R node:node /app
USER node

EXPOSE 8080
CMD ["node", "dist/server.js"]
