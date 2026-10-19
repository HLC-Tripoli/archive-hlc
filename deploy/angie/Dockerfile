# =============================================================================
# صورة الواجهة: Angie الرسمي (docker.angie.software/angie)
# يقدّم الملفات الثابتة (HTML/CSS/JS) ويوكّل /api/ إلى خدمة Fastify الداخلية.
# =============================================================================
FROM docker.angie.software/angie:1.12.4-alpine

# وسوم OCI الوصفية: يمرّرها سير عمل GitHub Actions عبر build-args (قيم افتراضية فارغة
# للبناء المحلي). مصدر الحزمة (source) يربط صورة GHCR بالمستودع تلقائياً.
ARG VCS_REF=""
ARG IMAGE_VERSION=""
LABEL org.opencontainers.image.source="https://github.com/Mohandl3G/archive-hlc" \
      org.opencontainers.image.title="archive-hlc-web" \
      org.opencontainers.image.description="Archive HLC web - Angie static frontend host and reverse proxy (Hatif Libya electronic archive)" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.version="${IMAGE_VERSION}"

# إزالة الموقع الافتراضي المرفق بالصورة
RUN rm -f /etc/angie/http.d/default.conf

# الإعدادات الخاصة بالمنظومة
COPY deploy/angie/angie.conf /etc/angie/angie.conf
COPY deploy/angie/security-headers.conf /etc/angie/snippets/security-headers.conf
COPY deploy/angie/http.d/archive.conf /etc/angie/http.d/archive.conf

# ملفات الواجهة الثابتة
COPY index.html /usr/share/angie/html/index.html
COPY css /usr/share/angie/html/css
COPY js /usr/share/angie/html/js
COPY img /usr/share/angie/html/img

EXPOSE 80
