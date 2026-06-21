# ==========================================
# Stage 1: Build the Frontend React SPA
# ==========================================
FROM node:18-alpine AS frontend-builder
WORKDIR /app

# Copy dependency files for workspace context
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/
RUN npm ci --workspace=frontend

# Copy frontend source files and build
COPY frontend/ ./frontend/
RUN npm run build --workspace=frontend

# ==========================================
# Stage 2: Build the Backend TypeScript
# ==========================================
FROM node:18-alpine AS backend-builder
WORKDIR /app

# Copy dependency files
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
RUN npm ci --workspace=backend

# Copy backend source files and build
COPY backend/ ./backend/
RUN npm run build --workspace=backend

# ==========================================
# Stage 3: Production Runner Image
# ==========================================
FROM node:18-alpine AS runner
WORKDIR /app

# Copy dependency files
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/

# Install only production dependencies
RUN npm ci --workspace=backend --omit=dev

# Copy compiled backend dist folder
COPY --from=backend-builder /app/backend/dist ./backend/dist

# Copy built frontend dist folder
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Copy system README and USER_MANUAL for in-app documentation viewer
COPY README.md USER_MANUAL.md ./

# Expose backend port
ENV PORT=8080
EXPOSE 8080

# Run Express server
CMD ["node", "backend/dist/index.js"]
