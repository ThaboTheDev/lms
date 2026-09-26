# syntax=docker/dockerfile:1

# --- dependencies -----------------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci

# --- build ------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# The application ships no static files of its own yet, but the runner copies
# `public` out of this stage, and a COPY whose source does not exist fails the
# build. Creating it here keeps that COPY working now, and correct the moment
# somebody adds an asset.
RUN mkdir -p public

ENV NEXT_TELEMETRY_DISABLED=1
# AUTH_SECRET is validated at import time; the build needs a value, never this one.
ENV AUTH_SECRET=build-time-placeholder-value-not-used-at-runtime
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
ARG S3_ENDPOINT=
ENV S3_ENDPOINT=${S3_ENDPOINT}
RUN npx prisma generate && npm run build

# --- runtime: web -----------------------------------------------------------
FROM node:22-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl curl tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home lms
# Local times typed into forms (a due date of 17:00) carry no zone, and every
# page formats times in the process's zone. In UTC both are two hours out for
# a South African institution; TZ makes the server read and write local time.
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 TZ=Africa/Johannesburg

COPY --from=build --chown=lms:lms /app/.next/standalone ./
COPY --from=build --chown=lms:lms /app/.next/static ./.next/static
COPY --from=build --chown=lms:lms /app/public ./public
COPY --from=build --chown=lms:lms /app/prisma ./prisma
COPY --from=build --chown=lms:lms /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=lms:lms /app/node_modules/@prisma ./node_modules/@prisma
COPY --chown=lms:lms docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER lms
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://localhost:3000/api/v1/health/live || exit 1
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "server.js"]

# --- runtime: worker --------------------------------------------------------
# The same image with a different command, so the worker cannot drift from the
# handlers the web process registers.
FROM node:22-bookworm-slim AS worker
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home lms
ENV NODE_ENV=production TZ=Africa/Johannesburg

COPY --from=deps --chown=lms:lms /app/node_modules ./node_modules
COPY --from=build --chown=lms:lms /app/node_modules/.prisma ./node_modules/.prisma
COPY --chown=lms:lms . .

USER lms
# --conditions=react-server: the job handlers import `server-only`, which only
# resolves to its empty module under the react-server condition.
CMD ["npx", "tsx", "--conditions=react-server", "scripts/worker.ts"]
