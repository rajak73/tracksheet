# NIAT — container image, for Northflank (or any platform that runs a container).
#
# ── Why a container at all, and why one long-lived process ────────────────
# Two things in this app assume a process that stays alive between requests,
# which is exactly what serverless does not give you:
#
#   1. `src/instrumentation.ts` starts the metric rollup scheduler with
#      `setInterval`. A frozen serverless function never fires it, so the
#      summary tables silently stop being current.
#   2. `src/server/http/rate-limit.ts` counts login attempts in a `Map`. Every
#      additional instance keeps its own, so N instances give an attacker
#      roughly N times the intended attempt budget.
#
# Keep this to ONE instance until the rate limiter moves to Redis. The
# scheduler is already safe under several — it takes a database lease — but the
# limiter is not.
#
# ── Why no `output: "standalone"` ─────────────────────────────────────────
# It would make a much smaller image. `next.config.ts` is a deliberate, permanent
# local-only change in this repo (it carries a LAN origin for the client's
# walkthroughs) and is not committed, so nothing here may depend on editing it.
# The runtime stage therefore ships `node_modules` with dev dependencies pruned.

# ── Build ─────────────────────────────────────────────────────────────────
FROM node:24.11.1-slim AS build

# Prisma needs OpenSSL to pick its engine; the slim image does not carry it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first, so a source-only change does not reinstall them.
#
# `--include=dev` is load-bearing rather than sloppiness: NODE_ENV=production is
# set at runtime and npm reads that as `omit=dev`, but the BUILD needs
# `tailwindcss` and `@tailwindcss/postcss` or PostCSS cannot resolve its plugin
# and `next build` fails. They stay dev dependencies and the build asks for them
# explicitly, rather than being promoted to runtime dependencies they are not.
COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .

# `prisma.config.ts` resolves `env("DATABASE_URL")` the moment the CLI loads it,
# and there is no `.env` in an image — so without this, `prisma generate` fails
# before it does anything. Nothing here CONNECTS: generate only reads the schema,
# and `next build` compiles routes rather than running their queries. The real
# URL arrives as an environment variable at runtime and this value is confined
# to the build stage, so it cannot leak into the shipped image.
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public"

# The Prisma client is generated into `src/generated/prisma`, which `next build`
# then compiles against — so this has to come first.
RUN npx prisma generate && npm run build

# Drop the build-only packages. `prisma`, `tsx` and `dotenv` are real
# dependencies and survive: the first runs migrations on start, the second runs
# the reference-data script, and `prisma.config.ts` imports the third on every
# prisma CLI call.
RUN npm prune --omit=dev

# The compiler cache is build scratch — `next start` never reads it, and it is
# the single largest thing in `.next`. Dropping it here means the runtime stage
# cannot accidentally carry it.
RUN rm -rf .next/cache

# ── Runtime ───────────────────────────────────────────────────────────────
FROM node:24.11.1-slim AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

COPY --from=build /app/node_modules      ./node_modules
COPY --from=build /app/.next             ./.next
COPY --from=build /app/public            ./public
COPY --from=build /app/src/generated     ./src/generated
COPY --from=build /app/package.json      ./package.json
COPY --from=build /app/next.config.ts    ./next.config.ts
# `prisma migrate deploy` reads the schema and the migration folder; the
# reference-data script is TypeScript run through tsx; the prisma CLI loads
# `prisma.config.ts` on every invocation.
COPY --from=build /app/prisma            ./prisma
COPY --from=build /app/prisma.config.ts  ./prisma.config.ts
COPY --from=build /app/scripts           ./scripts
COPY --from=build /app/tsconfig.json     ./tsconfig.json

COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Not root. Nothing here writes to disk, so the whole tree can stay read-only
# to the process that serves it.
USER node

EXPOSE 3000

# Health: GET /api/health
ENTRYPOINT ["./docker-entrypoint.sh"]
