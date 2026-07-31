FROM node:22-alpine AS build

WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY csp.config.cjs /csp.config.cjs
COPY frontend/index.html ./
COPY frontend/vite.config.js ./
COPY frontend/public ./public
COPY frontend/src ./src

ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm run build

FROM nginx:1.27-alpine
RUN apk add --no-cache nodejs
COPY frontend/nginx.conf /etc/nginx/templates/default.conf.template
COPY csp.config.cjs /etc/rakshakai/csp.config.cjs
COPY frontend/docker-entrypoint.d/10-csp-defaults.sh /docker-entrypoint.d/10-csp-defaults.envsh
COPY frontend/docker-entrypoint.d/render-csp.cjs /docker-entrypoint.d/render-csp.cjs
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=20s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
