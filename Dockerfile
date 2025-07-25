# Use Node.js Alpine image for smaller size
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --omit=dev

# Create non-root user first
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy application code
COPY --chown=nodejs:nodejs . .

# Create directories for persistent data with correct ownership
RUN mkdir -p cache public/app-alldata/alldata && \
    chown -R nodejs:nodejs cache public

# Expose the application port
EXPOSE 3000

# Switch to non-root user
USER nodejs

# Start the application
CMD ["node", "src/server.js"]