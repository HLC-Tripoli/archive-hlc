#!/usr/bin/env bash
# =============================================================================
# التحقق من ملفات Compose قبل النشر أو من داخل سير عمل GitHub Actions:
#   1) ملف الإنتاج docker-compose.yml بلا أي build: ولا يعتمد على شيفرة المصدر.
#   2) كل خدمات التطبيق (api/migrate/web) تستخدم صور GHCR بأوسمة صحيحة.
#   3) api وmigrate يستخدمان نفس وسم صورة API بالضبط.
#   4) فقط الواجهة (web) تنشر منفذاً؛ قاعدة البيانات والخادم داخليان.
#   5) مجلد المرفقات يُربط في حاوية api وحدها، ولا يُوصل إلى Angie إطلاقاً.
#   6) ملف التطوير docker-compose.dev.yml يبني الصور محلياً كما هو متوقع.
#   7) ‎.env‎ متجاهَل في Git ومستبعَد من سياق بناء صورة الواجهة (المرفقات أيضاً).
#
# الاستخدام (من أي مكان داخل المستودع):
#   ./scripts/validate-compose.sh
#
# يتطلب: docker compose (الإصدار 2) و jq. إذا لم يكن ‎.env‎ موجوداً يُنشأ مؤقتاً
# من ‎.env.example‎ ثم يُحذف عند الانتهاء.
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

fail() {
  echo "::error::$*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "docker غير مثبت على هذا الجهاز"
docker compose version >/dev/null 2>&1 || fail "docker compose (v2) غير متاح"
command -v jq >/dev/null 2>&1 || fail "jq مطلوب للتحقق من الإعداد المحلول"
command -v git >/dev/null 2>&1 || fail "git مطلوب للتحقق من تجاهل ‎.env‎"

created_env=0
if [ ! -f .env ]; then
  cp .env.example .env
  created_env=1
fi
cleanup() {
  if [ "$created_env" = "1" ]; then rm -f .env; fi
}
trap cleanup EXIT

# --- 1) ملف الإنتاج لا يحتوي build: في نصه الأصلي --------------------------
if grep -nE '^[[:space:]]*build:' docker-compose.yml >/dev/null; then
  grep -nE '^[[:space:]]*build:' docker-compose.yml >&2 || true
  fail "docker-compose.yml الإنتاجي يجب ألا يحتوي أي build: (البناء في docker-compose.dev.yml فقط)"
fi

# --- 2) استخراج الإعداد الإنتاجي المحلول والتحقق من الصور -------------------
prod_json="$(docker compose -f docker-compose.yml config --format json)"

echo "$prod_json" | jq -e '[.services[] | has("build")] | all(. == false)' >/dev/null \
  || fail "الإعداد الإنتاجي المحلول يحتوي build: — كل الصور يجب أن تُسحب من GHCR"

api_image="$(echo "$prod_json" | jq -r '.services.api.image')"
migrate_image="$(echo "$prod_json" | jq -r '.services.migrate.image')"
web_image="$(echo "$prod_json" | jq -r '.services.web.image')"

[ "$api_image" = "$migrate_image" ] \
  || fail "api وmigrate يجب أن يستخدما نفس وسم صورة API (api=$api_image migrate=$migrate_image)"

expected_prefix="ghcr.io/mohandl3g/archive-hlc:"
case "$api_image" in
  "${expected_prefix}api-"*) ;;
  *) fail "صورة api يجب أن تبدأ بـ ${expected_prefix}api- — وجد: $api_image" ;;
esac
case "$web_image" in
  "${expected_prefix}web-"*) ;;
  *) fail "صورة web يجب أن تبدأ بـ ${expected_prefix}web- — وجد: $web_image" ;;
esac
[ "$api_image" != "$web_image" ] || fail "api وweb يجب ألا يستخدما نفس وسم الصورة"

# --- 3) حدود الشبكة والمنافذ ------------------------------------------------
echo "$prod_json" | jq -e '(.services.db.ports // []) == []' >/dev/null \
  || fail "قاعدة البيانات يجب ألا تنشر أي منفذ على المضيف"
echo "$prod_json" | jq -e '(.services.api.ports // []) == []' >/dev/null \
  || fail "خادم API يجب ألا ينشر أي منفذ على المضيف (الوصول عبر Angie فقط)"
echo "$prod_json" | jq -e '[(.services.web.ports // [])[] | .target == 80] | length >= 1' >/dev/null \
  || fail "خدمة الواجهة يجب أن تنشر المنفذ 80 داخلياً (WEB_PORT)"

# --- 4) مجلد المرفقات: في api وحدها، ولا يظهر في Angie ---------------------
echo "$prod_json" | jq -e '(.services.web.volumes // []) == []' >/dev/null \
  || fail "Angie (web) يجب ألا يحصل على أي volume — خصوصاً مجلد المرفقات الخاصة"
echo "$prod_json" | jq -e '[(.services.api.volumes // [])[] | select(.type == "bind" and .target == "/data/uploads")] | length == 1' >/dev/null \
  || fail "api يجب أن يربط مجلد المضيف (ARCHIVE_UPLOADS_PATH) إلى /data/uploads"
echo "$prod_json" | jq -e '[(.services.db.volumes // [])[] | select(.type == "volume")] | length == 1' >/dev/null \
  || fail "قاعدة البيانات يجب أن تستخدم حجماً دائماً واحداً (pgdata)"

# --- 5) ملف التطوير يبني محلياً ----------------------------------------------
docker compose -f docker-compose.dev.yml config --quiet
dev_json="$(docker compose -f docker-compose.dev.yml config --format json)"
echo "$dev_json" | jq -e '[.services.migrate, .services.api, .services.web] | all(has("build"))' >/dev/null \
  || fail "docker-compose.dev.yml يجب أن يبني الصور الثلاث محلياً (build)"

# --- 6) استبعاد بيانات التشغيل من Git وسياق بناء صورة الواجهة ---------------
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git check-ignore -q .env || fail "‎.env‎ غير متجاهَل في Git (راجع .gitignore)"
else
  # نسخة غير مستودع (مثل مجلد اختبار منسوخ): تحقق نصي من قاعدة التجاهل
  echo "تنبيه: المجلد ليس مستودع Git — تحقق نصي من .gitignore فقط"
  grep -qE '^\.env$' .gitignore || fail ".gitignore لا يتجاهل ملف ‎.env‎"
fi
grep -qE '^\.env$' .dockerignore || fail ".dockerignore لا يستبعد ملف ‎.env‎"
grep -qE '^archive$' .dockerignore || fail ".dockerignore لا يستبعد مجلد المرفقات archive"

echo "OK — ملفات Compose سليمة:"
echo "  api/migrate: $api_image"
echo "  web:         $web_image"
echo "  (وضع التحقق المحلي للتطوير يعمل في docker-compose.dev.yml)"
