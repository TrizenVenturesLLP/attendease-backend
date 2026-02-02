# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Cache-bust: pass --build-arg CACHEBUST=$(date +%s) or CACHEBUST=$COMMIT_SHA to force fresh build
ARG CACHEBUST=1

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies (cache invalidated when package*.json changes)
RUN npm ci

# Invalidate cache when CACHEBUST changes (pass --build-arg CACHEBUST=$(date +%s) in deployment)
RUN echo "Cache bust: ${CACHEBUST}"

# Copy source code
COPY src ./src

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership
RUN chown -R nodejs:nodejs /app

USER nodejs

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start server
CMD ["node", "dist/index.js"]
