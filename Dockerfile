# Handova API server: WhatsApp bot, identity verification, media, reviews/repairs/boosts/referrals/moderation.
# Deploy on Railway / Render / Fly with a persistent volume mounted at /app/server/data (SQLite, uploads, backups).
FROM oven/bun:1.3 AS base
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

COPY server ./server
# The two browser/server shared modules the API imports (everything else in src/ is the web app).
COPY src/lib/arc-rpc.ts src/lib/savings-math.ts src/lib/network.ts ./src/lib/
COPY tsconfig.json ./

ENV NODE_ENV=production \
    RENTFLOW_DB=/app/server/data/rentflow.db \
    MEDIA_DIR=/app/server/data/uploads
# Persist /app/server/data with your host's volume feature (Railway: a volume mounted there — Railway doesn't allow
# the Dockerfile VOLUME instruction).
EXPOSE 3001
CMD ["bun", "run", "server/whatsapp-bot.ts"]
