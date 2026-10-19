# =============================================================================
# صورة خادم الواجهة البرمجية (Fastify + TypeScript)
# بناء متعدد المراحل: بناء الترجمة، ثم اعتماديات الإنتاج فقط، ثم صورة تشغيل نحيفة
# تعمل بمستخدم غير جذري (node).
# =============================================================================

# ---------- مرحلة البناء: تثبيت الاعتماديات وترجمة TypeScript ----------
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
RUN npm run build

# ---------- مرحلة اعتماديات الإنتاج ----------
FROM node:24-bookworm-slim AS production-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---------- مرحلة التشغيل ----------
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
COPY package.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/index.js"]
