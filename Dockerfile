FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY hogulink-api/package.json hogulink-api/package.json
COPY hogulink-web/package.json hogulink-web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV PUBLIC_HTTPS=1
ARG API_INTERNAL_URL=http://api:4000
ARG NEXT_PUBLIC_SITE_URL
ENV API_INTERNAL_URL=$API_INTERNAL_URL NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
RUN npm exec -w @hogulink/web -- next typegen && npm run build && npm prune --omit=dev

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PUBLIC_HTTPS=1
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/hogulink-api/data/private-evidence /app/backups && chown -R node:node /app/hogulink-api/data /app/backups
USER node
WORKDIR /app/hogulink-api
CMD ["node", "--import", "tsx", "src/entrypoint.ts", "main"]
