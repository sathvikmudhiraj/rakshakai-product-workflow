FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app/backend

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY csp.config.cjs /app/csp.config.cjs
COPY backend/controllers ./controllers
COPY backend/database ./database
COPY backend/middleware ./middleware
COPY backend/repositories ./repositories
COPY backend/routes ./routes
COPY backend/scripts ./scripts
COPY backend/services ./services
COPY backend/data/db.example.json ./data/db.example.json
COPY backend/server.js ./

USER node
EXPOSE 5000

CMD ["node", "server.js"]
