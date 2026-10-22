# =============================================================================
# صورة خادم الواجهة البرمجية (Fastify + TypeScript)
# بناء متعدد المراحل: بناء الترجمة، ثم اعتماديات الإنتاج فقط، ثم صورة تشغيل نحيفة
# تعمل بمستخدم غير جذري (node).
# =============================================================================

# ---------- مرحلة البناء: تثبيت الاعتماديات وترجمة TypeScript ----------
FROM node:25-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
RUN npm run build

# ---------- مرحلة اعتماديات الإنتاج ----------
FROM node:25-bookworm-slim AS production-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---------- مرحلة التشغيل ----------
FROM node:25-bookworm-slim AS runtime

# وسوم OCI الوصفية: يمرّرها سير عمل GitHub Actions عبر build-args (قيم افتراضية فارغة
# للبناء المحلي). مصدر الحزمة (source) يربط صورة GHCR بالمستودع تلقائياً.
ARG VCS_REF=""
ARG IMAGE_VERSION=""
LABEL org.opencontainers.image.source="https://github.com/Mohandl3G/archive-hlc" \
      org.opencontainers.image.title="archive-hlc-api" \
      org.opencontainers.image.description="Archive HLC API - Fastify + TypeScript backend (Hatif Libya electronic archive)" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.version="${IMAGE_VERSION}"

ENV NODE_ENV=production
WORKDIR /app
# أدوات تحسين المرفقات في مرحلة التشغيل فقط (وليست في مرحلة البناء):
#   - qpdf: تحسين PDF هيكلياً (object streams + إعادة ضغط flate) دون rasterization.
#   - libjpeg-turbo-progs: jpegtran لتحسين JPEG بلا فقدان مع نسخ كل العلامات الوصفية.
# النسخ مثبّتة على إصدارات Debian bookworm المستخدمة في الصورة الأساسية.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      qpdf=11.3.0-1+deb12u1 \
      libjpeg-turbo-progs=1:2.1.5-2 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /tmp/archive-hlc \
    && chmod 700 /tmp/archive-hlc \
    && chown node:node /tmp/archive-hlc
ENV PROCESSING_TMP_DIR=/tmp/archive-hlc
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
COPY package.json ./
# مجلد المرفقات الافتراضي داخل الحاوية. عند التشغيل عبر Compose يُستبدل بمجلد
# المضيف المرتبط (ARCHIVE_UPLOADS_PATH) وترث الملكية من المضيف؛ هذا المجلد
# يخدم فقط التشغيل المباشر بدون Compose.
RUN mkdir -p /data/uploads && chown node:node /data/uploads
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/index.js"]
