# Use Node.js Alpine image for smaller size
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Create directories for persistent data
RUN mkdir -p cache public/app-alldata/alldata

# Expose the application port
EXPOSE 3000

# Run as non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001
USER nodejs

# Start the application
CMD ["node", "src/server.js"]