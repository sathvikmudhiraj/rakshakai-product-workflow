FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY controllers ./controllers
COPY database ./database
COPY middleware ./middleware
COPY repositories ./repositories
COPY routes ./routes
COPY scripts ./scripts
COPY services ./services
COPY data ./data
COPY server.js ./

USER node
EXPOSE 5000

CMD ["node", "server.js"]
