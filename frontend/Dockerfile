# ==============================================================================
# VaultDAO — Frontend multi-stage Dockerfile
#
# Stages:
#   builder  — installs deps, runs `npm run build`, produces /app/dist
#   dev      — Vite dev server with hot reload (used by docker-compose.yml)
#   runner   — production Nginx image with SPA fallback + security headers
#
# The repo uses package-lock.json (npm).  pnpm-lock.yaml exists only at the
# workspace root and is NOT used for the frontend build.
# ==============================================================================

# ---- builder ----------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Copy lockfile and manifest first so the layer is cached unless deps change.
# Only package-lock.json — the repo canonical lockfile.  pnpm-lock.yaml is
# intentionally NOT copied here (it belongs to the workspace root, not to the
# frontend package).
COPY package.json package-lock.json ./

RUN npm ci --legacy-peer-deps

# Copy the rest of the source after deps are installed.
COPY . .

RUN npm run build


# ---- dev --------------------------------------------------------------------
FROM node:22-alpine AS dev

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host"]


# ---- runner -----------------------------------------------------------------
FROM nginx:1.27-alpine AS runner

# Remove the default Nginx config that ships with the image.
RUN rm /etc/nginx/conf.d/default.conf

# Copy our custom server block (SPA fallback + security headers + gzip).
COPY nginx/default.conf /etc/nginx/conf.d/default.conf

# Copy compiled SPA assets from the builder stage.
COPY --from=builder /app/dist /usr/share/nginx/html

# Nginx runs as the built-in 'nginx' user (uid 101) — no root required at
# runtime.  The parent image already sets this up; we just make it explicit.
USER nginx

EXPOSE 80

# Healthcheck so compose and orchestrators can probe liveness without curl.
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
