FROM node:20-bookworm-slim

# better-sqlite3 needs to compile a native addon
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV DATABASE_PATH=/app/data/game.db
VOLUME ["/app/data"]

EXPOSE 3000
CMD ["node", "server/index.js"]
