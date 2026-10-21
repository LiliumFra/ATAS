# syntax=docker/dockerfile:1.7
FROM node:24.18.0-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM dependencies AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
COPY rulesets ./rulesets
RUN npm run build

FROM node:24.18.0-alpine AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:24.18.0-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache tini \
  && addgroup -S atas \
  && adduser -S -G atas -h /app atas
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json package-lock.json ./
COPY migrations ./migrations
COPY rulesets ./rulesets
COPY src/public ./src/public
COPY deploy/entrypoint.sh ./entrypoint.sh
RUN chmod 0555 ./entrypoint.sh \
  && chown -R atas:atas /app
USER atas
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["/sbin/tini", "--", "/app/entrypoint.sh"]
