# Stage 1: Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
COPY package*.json ./
RUN npm ci

# Copy TypeScript source and configuration
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript to JavaScript in /app/dist
RUN npm run build

# Stage 2: Runtime stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled artifacts from builder
COPY --from=builder /app/dist ./dist

# Copy entrypoint script
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Create non-root system user for security
RUN addgroup -S astro && adduser -S astro -G astro \
  && chown -R astro:astro /app

USER astro

EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
