# syntax=docker/dockerfile:1
ARG NODE_VERSION=22
# SHARED BASE
FROM node:${NODE_VERSION}-alpine AS base
WORKDIR /app
ENV DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data

# DEV DEPENDENCIES
FROM base AS devsetup
RUN --mount=type=bind,source=package.json,target=package.json \
--mount=type=bind,source=package-lock.json,target=package-lock.json \
--mount=type=cache,target=/root/.npm \
npm ci
COPY . .

# DEV
FROM devsetup AS dev
ENV NODE_ENV=dev
CMD ["node", "--watch", "src/index.js"]

# TEST
FROM devsetup AS test
ENV NODE_ENV=test
RUN npm run lint
RUN npm run test

# PRODUCTION DEPENDENCIES 
FROM base AS deps
RUN --mount=type=bind,source=package.json,target=package.json \
--mount=type=bind,source=package-lock.json,target=package-lock.json \
--mount=type=cache,target=/root/.npm \
npm ci --omit=dev

# PRODUCTION 

FROM base AS production

ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
EXPOSE 3000
USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -qO- http://127.0.0.1:3000/health || exit 1

ARG APP_VERSION="production"
ARG GIT_COMMIT="unknown"
ENV GIT_COMMIT=${GIT_COMMIT}
ENV APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.version=${APP_VERSION} \
org.opencontainers.image.revision=${GIT_COMMIT}


CMD [ "node", "src/index.js" ]
