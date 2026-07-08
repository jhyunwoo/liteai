# Use the official lightweight Bun image (latest alpine)
FROM oven/bun:alpine AS base
WORKDIR /app

# Copy dependency definition files
COPY package.json bun.lock ./

# Install project dependencies
RUN bun install --frozen-lockfile

# Copy application source code and frontend assets
COPY src/ ./src
COPY public/ ./public

# Create database and workspace mountpoints in a central persistent data directory
RUN mkdir -p /app/data

# Configure environment variables to point database and file storage to the mountpoint
ENV DATABASE_PATH=/app/data/liteai.db
ENV WORKSPACE_PATH=/app/data/liteai_workspace

# Expose the server port
EXPOSE 3000

# Start Hono server
CMD ["bun", "run", "src/index.ts"]
