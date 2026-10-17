# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install all dependencies
RUN npm ci --legacy-peer-deps

# Copy application source
COPY . .

# Build/compile the application static assets
RUN npm run build

# Development stage: Vite dev server with hot reload, used by docker-compose.yml
FROM node:20-alpine AS dev

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host"]

# Runtime stage using lightweight Nginx to serve static assets
FROM nginx:alpine AS runner

# Copy compilation output from builder stage to Nginx public folder
COPY --from=builder /app/dist /usr/share/nginx/html

# Expose the standard Nginx port
EXPOSE 80

# Run Nginx in foreground
CMD ["nginx", "-g", "daemon off;"]
