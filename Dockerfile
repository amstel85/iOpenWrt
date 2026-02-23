# Build Frontend
FROM node:18-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Final Stage
FROM node:18-alpine
WORKDIR /app

# Install backend dependencies
COPY package*.json ./
RUN npm install --production

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
