# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install all dependencies (including devDependencies for typescript build)
RUN npm install -g pnpm && pnpm install --frozen-lockfile

# Copy source files
COPY . .

# Build/compile the application
RUN pnpm build

# Prune node_modules to retain only production dependencies
RUN pnpm prune --prod

# Runtime stage
FROM node:20-alpine AS runner

# Set production environment
ENV NODE_ENV=production
WORKDIR /app

# Configure permissions for the non-root node user
RUN chown -R node:node /app

# Copy only production compilation outputs and pruned dependencies with correct ownership
COPY --chown=node:node package.json ./
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/node_modules ./node_modules

# Health check using node's HTTP module
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 8787) + '/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# Run as non-root user for security
USER node

# Start application
CMD ["node", "dist/index.js"]
