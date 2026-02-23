# Build Frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Final Stage
FROM node:20-alpine
WORKDIR /app

# Install build dependencies for better-sqlite3 (native modules)
RUN apk add --no-cache python3 make g++

# Install backend dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy backend source
COPY src ./src
COPY server.js ./
COPY .env.example ./.env

# Create data directory for SQLite
RUN mkdir -p data

# Copy built frontend from previous stage
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

EXPOSE 3000

CMD ["node", "server.js"]
