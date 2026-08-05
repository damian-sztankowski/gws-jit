# ==========================================
# Stage 1: Build the Frontend React SPA
# ==========================================
FROM node:22-alpine AS frontend-builder
WORKDIR /app

# Copy dependency files for workspace context
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/
RUN npm ci --workspace=frontend --ignore-scripts

# Copy frontend source files and build
COPY frontend/ ./frontend/
RUN npm run build --workspace=frontend

# ==========================================
# Stage 2: Build the Backend TypeScript
# ==========================================
FROM node:22-alpine AS backend-builder
WORKDIR /app

# Copy dependency files
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
RUN npm ci --workspace=backend --ignore-scripts

# Copy backend source files and build
COPY backend/ ./backend/
RUN npm run build --workspace=backend

# ==========================================
# Stage 3: Production Runner Image
# ==========================================
FROM node:22-alpine AS runner
WORKDIR /app

# Copy dependency files
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/

# Install only production dependencies
RUN npm ci --workspace=backend --omit=dev --ignore-scripts

# Copy compiled backend dist folder
COPY --from=backend-builder /app/backend/dist ./backend/dist

# Copy built frontend dist folder
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Copy system README and USER_MANUAL for in-app documentation viewer
COPY README.md USER_MANUAL.md ./
# Set file ownership and run as non-root user for security container hardening
RUN chown -R node:node /app
USER node

# Expose backend port
ENV PORT=8080
EXPOSE 8080

# Health check for container orchestration (Cloud Run, Kubernetes, Docker Compose)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/healthz || exit 1

# Run Express server
CMD ["node", "backend/dist/index.js"]
