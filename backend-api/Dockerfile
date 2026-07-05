# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim

# App directory
WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy application source
COPY src ./src
COPY scripts ./scripts

# Runtime folders used by multer/file services
RUN mkdir -p uploads

# Render provides PORT at runtime; keep fallback for local docker runs
ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

CMD ["npm", "start"]
