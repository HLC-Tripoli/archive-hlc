# منظومة الأرشيف الإلكتروني — هاتف ليبيا

نظام أرشيف مراسلات ووثائق كامل بواجهة عربية RTL: واجهة أمامية ثابتة (HTML/CSS/JS
بلا أطر عمل)، وخادم REST مكتوب بـ TypeScript (Fastify)، وقاعدة بيانات PostgreSQL 18،
ومرفقات خاصة تُخزَّن على نظام ملفات المضيف (دون أي اعتماد على S3)، تعمل جميعها عبر
Docker Compose خلف خادم Angie الذي يقدّم الواجهة ويوكّل `/api/` إلى الخادم.

**فصل واضح بين التطوير والنشر:** المستودع هو مصدر الشيفرة والتطوير المحلي والاختبارات،
ويبني GitHub Actions صور التطبيق وينشرها إلى GitHub Container Registry (GHCR)، أما
أجهزة النشر الإنتاجي فتحتاج **ملفين فقط** (`docker-compose.yml` و`.env`) وتسحب صوراً
جاهزة — بلا شيفرة مصدر، وبلا Node.js أو npm، وبلا أي بناء محلي.

An Arabic RTL correspondence archive for Hatif Libya: a static frontend served by Angie,
a Fastify (TypeScript) REST API, PostgreSQL 18, and private attachments on a persistent
host directory (no S3 dependency). Development happens from the source repository;
GitHub Actions builds and publishes both images to `ghcr.io/mohandl3g/archive-hlc`;
production hosts only need the standalone `docker-compose.yml` plus a configured `.env`
file and pull prebuilt images. All application data lives on the server; the browser
keeps only the theme preference and optional legacy demo data awaiting migration.

**جدول المحتويات**

1) البنية العامة
2) التطوير من المستودع
3) CI/CD ونشر الصور إلى GHCR
4) النشر الإنتاجي المستقل
5) متغيرات البيئة
6) قاعدة البيانات والمرفقات الدائمة
7) إنشاء أول مدير
8) التحديث والتثبيت والرجوع
9) استكشاف الأخطاء
10) واجهة برمجة التطبيقات (مختصر)
11) الصلاحيات
12) ترحيل بيانات النسخة التجريبية (localStorage)
13) الاختبارات والتحقق
14) ملاحظات وحدود معروفة
15) الترخيص والحقوق

---

## 1) البنية العامة

```
المتصفح (RTL، عربي)
   │  HTTPS (يُنهى خارجياً — انظر قسم المتغيرات والنشر)
   ▼
Angie — صورة web المنشورة من GHCR (المنفذ 80 داخل الحاوية، يُنشر على WEB_PORT)
   ├── ملفات ثابتة: index.html, css/, js/, img/
   └── /api/  ⇢  خادم Fastify — صورة api المنشورة من GHCR (api:3000، غير منشور)
                     │
                     ├── PostgreSQL 18 (db:5432، داخل شبكة Compose فقط)
                     └── مجلد المرفقات على المضيف (bind mount إلى /data/uploads داخل
                         حاوية api وحدها؛ غير مرئي لحاوية Angie إطلاقاً)
```

- **الواجهة الأمامية**: `index.html` + `css/style.css` + `js/` — بدون إطار عمل، بدون
  خطوة بناء، بدون موارد خارجية (لا CDN، لا خطوط خارجية). الاتصال بالخادم عبر `js/api.js`
  الذي يضيف ترويسة CSRF ويعالج الأخطاء العربية وانتهاء الجلسة.
- **الخادم**: `backend/` — Fastify 5، TypeScript صارم (ESM/NodeNext)، مخططات JSON لكل
  المدخلات، تحقق من الصلاحيات على كل مسار، تسجيل تدقيق للعمليات الحساسة.
- **قاعدة البيانات**: `backend/migrations/0001_init.sql` — تُدار بمرحّل خاص
  (`src/db/migrate.ts`) يتحقق من بصمات الملفات (SHA-256) ويرفض أي تعديل على ترحيل
  مطبَّق (الترحيلات غير قابلة للتعديل بعد تطبيقها).
- **التخزين**: مزوّد محلي (`LocalFilesystemStorageProvider`) يكتب المرفقات تحت
  `UPLOADS_DIR` (افتراضياً `/data/uploads` داخل الحاوية، مربوط بمجلد دائم على المضيف)،
  خلف واجهة `StorageProvider` تبقى بقية طبقات التطبيق مستقلة عن آلية التخزين.
  قاعدة البيانات تحتفظ بالمفاتيح النسبية والأحجام والبصمات فقط، ولا تُخزَّن أي ملفات
  ثنائية في PostgreSQL.
- **الصور**: صورتان منفصلتان يُنشئهما سير عمل واحد وينشرهما إلى GHCR:
  `ghcr.io/mohandl3g/archive-hlc:api-*` (خادم Fastify من `backend/Dockerfile`) و
  `ghcr.io/mohandl3g/archive-hlc:web-*` (Angie + الملفات الثابتة من
  `deploy/angie/Dockerfile`). خدمة الترحيلات (`migrate`) تستخدم صورة api نفسها مع
  أمر الترحيل — فلا صورة ثالثة ولا حاويات زائدة.

### هيكل المستودع

```
.
├── index.html                  # هيكل الواجهة (كل الصفحات والنوافذ)
├── css/style.css               # الأنماط (مظهر فاتح/داكن عبر متغيرات CSS)
├── js/                         # theme-pre.js, theme.js, api.js, script.js
├── img/logo.svg
├── docker-compose.yml          # النشر الإنتاجي: صور GHCR جاهزة، بلا أي build
├── docker-compose.dev.yml      # التطوير المحلي: بناء الصور من المصدر (مقصود)
├── .env.example                # نموذج متغيرات بيئة النشر (انسخه إلى .env)
├── .github/
│   ├── workflows/publish-images.yml   # الاختبارات + البناء + النشر إلى GHCR
│   └── dependabot.yml                 # تحديث أسبوعي لتثبيتات الإجراءات والصور
├── scripts/validate-compose.sh # تحقق آلي من ملفات Compose وإعدادات النشر
├── deploy/angie/               # إعدادات Angie ورؤوس الأمان (تدخل في صورة web)
├── backend/
│   ├── Dockerfile              # بناء متعدد المراحل، تشغيل بمستخدم غير جذري (uid=1000)
│   ├── migrations/             # ترحيلات SQL مرقّمة
│   ├── src/                    # app.ts, config.ts, index.ts, db/, lib/, plugins/,
│   │                           #   routes/, services/ (منها storage/local.ts), scripts/
│   └── test/                   # اختبارات آلية (node:test) — 01..09
├── archive/files/uploads/      # (يُنشأ على المضيف) مجلد المرفقات — مستبعَد من Git والصور
└── README.md
```

**English summary**: two separate images (api / web) with their own Dockerfiles and
contexts; a one-shot `migrate` service reuses the api image; PostgreSQL and uploads are
the only persistent state; production Compose pulls images from GHCR and contains no
`build:` directives.

## 2) التطوير من المستودع

التطوير يجري على نسخة المستودع الكاملة. البناء المحلي مسموح ومقصود **للتطوير فقط**؛
الإنتاج لا يبني أبداً (انظر القسمين 3 و4).

**المتطلبات**: Node.js ≥ 20.19 (يُفضَّل 24) وnpm للتطوير الخلفي، وDocker مع Compose v2
للتشغيل المحلي بالسكربتات وبناء الصور والاختبارات المتكاملة. (لا شيء من هذا مطلوب على
جهاز النشر الإنتاجي.)

### 2.1 إعداد أولي

```bash
git clone https://github.com/MohandL3G/archive-hlc.git
cd archive-hlc
cp .env.example .env
# للتطوير على HTTP محلي: COOKIE_SECURE=false وكلمة مرور محلية في POSTGRES_PASSWORD/DATABASE_URL
```

> تنبيه: `DATABASE_URL` في `.env.example` مضبوط على المضيف `db` (اسم خدمة Compose).
> إن شغّلت خادم التطوير خارج Compose فوجّهه إلى قاعدة البيانات المحلية، مثال:
> `postgres://hlc:hlc-dev-password@localhost:5432/archive_hlc`.

### 2.2 قاعدة بيانات تطوير/اختبار معزولة

```bash
docker run -d --name hlc-dev-pg \
  -e POSTGRES_USER=hlc -e POSTGRES_PASSWORD=hlc-dev-password -e POSTGRES_DB=archive_hlc \
  -p 5432:5432 postgres:18
```

### 2.3 الاعتماديات والفحوص والاختبارات

```bash
cd backend
npm ci
npm run typecheck        # فحص TypeScript بلا إخراج
export DATABASE_URL=postgres://hlc:hlc-dev-password@localhost:5432/hlc_test
npm test                 # الاختبارات تنشئ مخططها بنفسها
```

> مهم: حزمة الاختبارات تعمل على **قاعدة بيانات معزولة** (تُنشئ المخطط من الصفر في أول
> ملف). لا توجّهها إلى قاعدة بيانات إنتاجية أو بيانات حقيقية.

### 2.4 تشغيل الخادم للتطوير

```bash
cd backend
export DATABASE_URL=postgres://hlc:hlc-dev-password@localhost:5432/archive_hlc
export UPLOADS_DIR=/tmp/hlc-uploads        # لا تستخدم /data/uploads محلياً
npm run db:migrate                          # ترحيلات قاعدة التطوير
npm run dev                                 # تشغيل مع إعادة التحميل التلقائي
```

### 2.5 تشغيل المنظومة كاملة محلياً (الأقرب للإنتاج)

```bash
cp .env.example .env      # مرة واحدة: COOKIE_SECURE=false محلياً + كلمة مرور محلية
mkdir -p ./archive/files/uploads
sudo chown 1000:1000 ./archive/files/uploads && sudo chmod 750 ./archive/files/uploads
docker compose -f docker-compose.dev.yml up -d --build
```

هذا الملف **مقصود فيه البناء المحلي**: ينتج صورتَي `archive-hlc-api:local` و
`archive-hlc-web:local` من `./backend` ومن `deploy/angie/Dockerfile`، ويستخدم مشروع
Compose مستقلاً باسم `archive-hlc-dev` (كي لا تتشارك بيانات التطوير والإنتاج أي حجم
دائم على الجهاز نفسه). بعد تعديل Dockerfile أو الإعدادات أعد الأمر نفسه لإعادة البناء.

> وجود `build:` و`archive-hlc-*-local` هنا **وحده** مقصود ومعلَّق عليه؛ ملف الإنتاج
> `docker-compose.yml` لا يحتوي أي `build:` ويحقّق `scripts/validate-compose.sh` ذلك آلياً.

التحقق بعد التشغيل:

```bash
docker compose -f docker-compose.dev.yml ps
curl -s http://localhost:8080/healthz          # ok
curl -s http://localhost:8080/api/v1/ready     # {"status":"ready","database":true,"storage":true}
```

### 2.6 الواجهة وحدها

الواجهة ملفات ثابتة: اخدم جذر المستودع بأي خادم ثابت ثم وجّه `/api/` إلى الخادم:

```bash
python3 -m http.server 8081
# أو استخدم المنظومة الكاملة أعلاه (الأقرب للإنتاج)
```

### 2.7 ملخص الفرق بين بيئتي التطوير والإنتاج

| | التطوير (`docker-compose.dev.yml`) | الإنتاج (`docker-compose.yml`) |
| --- | --- | --- |
| مصدر الصور | بناء محلي من المصدر (`:local`) | سحب من GHCR (`api-*` / `web-*`) |
| الحاجة إلى الشيفرة | نعم (المستودع) | **لا** — ملفان فقط: compose + .env |
| الحاجة إلى Node.js/npm | نعم للخادم والاختبارات | **لا** |
| اسم مشروع Compose | `archive-hlc-dev` | `archive-hlc` |
| الأمر المعتاد | `docker compose -f docker-compose.dev.yml up -d --build` | `docker compose pull && docker compose up -d` |

## 3) CI/CD ونشر الصور إلى GHCR

الملف: `.github/workflows/publish-images.yml`. يعمل تلقائياً عند:

- **الدفع إلى `main`** → اختبارات + بناء + **نشر** الصور.
- **طلبات السحب (PR) الموجّهة إلى `main`** → اختبارات + تحقق + بناء الصور **دون نشر**.
- **وسوم الإصدارات** المطابقة لـ `v*` (مثل `v1.0.0`) → نشر مع وسم إصدار.
- **التشغيل اليدوي** عبر `workflow_dispatch` (تبويب Actions → Run workflow).

مكونات السير (مهام منفصلة، والنشر لا يبدأ إلا بعد نجاح كل ما قبله):

1. **backend** — `npm ci` بالـ lockfile، `npm run typecheck`، ثم كامل حزمة الاختبارات
   على خدمة `postgres:18` مؤقتة داخل عدّاء GitHub.
2. **validate** — `./scripts/validate-compose.sh`: التحقق من أن ملف الإنتاج بلا أي
   `build:` وبصور GHCR فقط، وأن `api` و`migrate` يستخدمان وسم الصورة نفسه، وأن منافذ
   قاعدة البيانات والخادم غير منشورة، وأن مجلد المرفقات مربوط في `api` وحدها، وأن ملف
   التطوير يبني محلياً، وأن `.env` متجاهَل في Git ومستبعَد من سياق بناء صورة الواجهة.
3. **images** — مصفوفة مكوّنين (`api` و`web`) تبني بالمصدر نفسه الذي يستخدمه التطوير:
   `context: ./backend` مع `backend/Dockerfile` للخادم، و`context: .` مع
   `deploy/angie/Dockerfile` للواجهة. النشر إلى GHCR فقط عند `main`/الوسوم وبعد نجاح
   المهمتين السابقتين؛ طلبات السحب تبني بلا نشر.

### الوسوم المنشورة (حزمة GHCR واحدة)

| الوسم | المعنى |
| --- | --- |
| `ghcr.io/mohandl3g/archive-hlc:api-latest` / `web-latest` | أحدث بناء ناجح على `main` |
| `ghcr.io/mohandl3g/archive-hlc:api-sha-<short-sha>` / `web-sha-<short-sha>` | التزام محدد — للتثبيت الدقيق |
| `ghcr.io/mohandl3g/archive-hlc:api-v1.2.3` / `web-v1.2.3` | وسم إصدار (`v*`) |

لا يُستخدم `latest` أبداً لصورتين مختلفتين؛ كل صورة لها وسومها المسبوقة باسم المكوّن.
خدمة `migrate` في ملف الإنتاج تستخدم `ARCHIVE_API_IMAGE` نفسها التي يستخدمها `api`.

### الأمان والصلاحيات والتثبيت

- صلاحيات السير الدنيا: `contents: read` على مستوى السير، و`packages: write` تُمنح
  **لمهمة النشر وحدها**. النشر يستخدم `GITHUB_TOKEN` المدمج — لا حاجة إلى رمز شخصي
  (PAT)، ولا تُخزَّن أي أسرار إضافية.
- الإجراءات الخارجية مثبّتة على SHA التزامات مراجَعة مع تعليق الإصدار، ويتابعها
  Dependabot أسبوعياً (`.github/dependabot.yml`) — تحديثات الإجراءات وصور Dockerfiles.
- تخزين BuildKit مؤقت منفصل لكل مكوّن (`type=gha,scope=api` و`scope=web`) كي لا
  تتلوّث ذاكرة البناء إحداهما بالأخرى.
- كل مهمة تكتب ملخصاً في صفحة السير (الالتزام، إصدار الصورة، الوسوم المنشورة).
- الصور تحمل وسوم OCI: `org.opencontainers.image.source` (يربط الحزمة بالمستودع)،
  و`title` و`description`، و`revision`/`version` من التزام البناء (`VCS_REF`/`IMAGE_VERSION`).

### ظهور الحزمة العامة (خطوة تحقق لمرة واحدة)

المستودع عام، والحزمة عادةً ترث الظهور العام عند أول نشر. **تحقق مرة واحدة بعد أول نشر**:

1. افتح صفحة الحزمة:
   `https://github.com/MohandL3G/archive-hlc/pkgs/container/archive-hlc`
   (أو من ملف المستودع الشخصي → تبويب Packages).
2. من «Package settings» تأكّد أن الظهور **Public**. إن كان Private فغيّره مرة واحدة
   (سير العمل ينشر لكنه لا يغيّر الظهور تلقائياً).
3. تحقق من السحب **بلا تسجيل دخول** (ستحتاجه أي آلة نشر غير مرتبطة بحساب GitHub):

```bash
docker logout ghcr.io   # تأكيد أن السحب مجهول الهوية
docker pull ghcr.io/mohandl3g/archive-hlc:api-latest
docker pull ghcr.io/mohandl3g/archive-hlc:web-latest
```

> لا تضع أي رمز GitHub في ملف `.env` للنشر — الصور عامة والسحب لا يحتاج مصادقة.

**English summary**: on pushes to `main` (and `v*` tags) the workflow runs the backend
suite + type check, validates the Compose files, then builds and pushes component-tagged
images to GHCR (`:api-latest`, `:api-sha-<sha>`, optionally `:api-v1.0.0`; same for web)
using the built-in `GITHUB_TOKEN` with minimal permissions. Pull requests build without
publishing. Verify once that the package is Public, then anonymous `docker pull` must
work on any deployment host.

## 4) النشر الإنتاجي المستقل

### الملفات المطلوبة على جهاز النشر (فقط)

- `docker-compose.yml` — ملف النشر الإنتاجي (لا يحتوي أي `build:`).
- `.env` — نسخة معدَّلة من `.env.example`.

لا شيفرة مصدر، لا `backend/`، لا `deploy/`، لا Dockerfiles، ولا Node.js/npm على جهاز النشر.

### الحصول على الملفين دون نسخ المستودع

```bash
mkdir -p /srv/archive-hlc && cd /srv/archive-hlc
curl -fsSLO https://raw.githubusercontent.com/MohandL3G/archive-hlc/main/docker-compose.yml
curl -fsSLO https://raw.githubusercontent.com/MohandL3G/archive-hlc/main/.env.example
cp .env.example .env
nano .env        # كلمة مرور قوية، WEB_PORT، مسار المرفقات، الصور إن أردت تثبيتاً
```

بدائل: من واجهة GitHub افتح الملف → زر **Raw** → احفظ باسمه (بلا امتداد إضافي)؛ أو
استبدل `main` بوسم إصدار (مثل `v1.0.0`) لتحصل على نسخة مجمّدة من الملف والوسوم.

### تجهيز مجلد المرفقات (مرة واحدة)

```bash
mkdir -p ./archive/files/uploads
sudo chown 1000:1000 ./archive/files/uploads   # مستخدم تشغيل حاوية الخادم (uid=1000)
sudo chmod 750 ./archive/files/uploads
```

### النشر

```bash
docker compose config       # تحقق من صحة الإعداد بعد تعديل .env
docker compose pull         # سحب الصور الجاهزة من GHCR
docker compose up -d        # db → migrate → api → web بالترتيب الصحي
docker compose ps           # يجب أن تكون db/api/web بحالة healthy
```

> ممنوع تماماً على الإنتاج: `docker compose up -d --build` أو أي `build`. ملف الإنتاج
> لا يحتوي سياقات بناء أصلاً، وكل ما يعمل عليه يجب أن يأتي من GHCR.

### التحقق بعد النشر

```bash
curl -s http://localhost:8080/healthz          # ok  (فحص الواجهة/الحياة)
curl -s http://localhost:8080/api/v1/health    # {"status":"ok",...}
curl -s http://localhost:8080/api/v1/ready     # {"status":"ready","database":true,"storage":true}
```

الترتيب محكوم بالصحة: `migrate` يعمل مرة واحدة بعد جهوزية قاعدة البيانات ثم يتوقف
بنجاح، ولا يبدأ `api` إلا بعد نجاحه، ولا يبدأ `web` إلا بعد جهوزية `api`. إن رجع
`/api/v1/ready` الرمز 503 مع `"storage":false` فراجع ملكية مجلد المرفقات (القسم 6).

بعد نجاح التشغيل أنشئ أول مدير (القسم 7) ثم سجّل الدخول من الواجهة على `WEB_PORT`.

**English summary**: on a deployment host you copy `.env.example` to `.env`, edit it,
create/own the uploads directory for uid 1000, then run `docker compose config`,
`docker compose pull`, `docker compose up -d`. No source tree or Node.js is needed;
never build images on the production host.

## 5) متغيرات البيئة

انسخ `.env.example` إلى `.env` بجانب `docker-compose.yml` وعدّل القيم. لا تُودِع
`.env` في Git إطلاقاً.

| المتغيّر | الوصف |
| --- | --- |
| `ARCHIVE_API_IMAGE` / `ARCHIVE_WEB_IMAGE` | وسوم صور GHCR (افتراضياً `api-latest`/`web-latest`). للتثبيت استبدل الوسم بـ `api-sha-<sha>` أو `api-v1.0.0` (انظر القسم 8). |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | بيانات قاعدة البيانات (تُنشأ عند أول تشغيل). |
| `DATABASE_URL` | رابط الاتصال؛ يجب أن يطابق الثلاثة أعلاه وأن يشير إلى المضيف `db` داخل شبكة Compose. |
| `NODE_ENV=production` | يفعّل: كوكي Secure افتراضياً، وثوق الوكيل العكسي. |
| `PORT` | منفذ الخادم داخل الحاوية (لا يُنشر للخارج؛ الوصول عبر Angie فقط). |
| `LOG_LEVEL` | مستوى السجل (`fatal`..`trace` أو `silent`). |
| `PUBLIC_ORIGIN` | الأصل العام للمنظومة (مثل `https://archive.example.com`). عند ضبطه يُفرض على كل الطلبات المتغيّرة. اتركه فارغاً خلف وكيل عكسي موحّد. |
| `TRUST_PROXY=true` | خلف Angie يجب أن يبقى `true` (يُفعّل احترام `X-Forwarded-*`). |
| `SESSION_TTL_HOURS` | مدة الجلسة بالساعات (افتراضي 12). |
| `COOKIE_SECURE` | `true` في الإنتاج مع HTTPS. اضبطها `false` مؤقتاً فقط للاختبار على HTTP. |
| `UPLOAD_MAX_MB` | أقصى حجم للمرفق الواحد (افتراضي 25). الحّد الصلب في صورة الواجهة `client_max_body_size 32m`؛ القيم حتى 32 ميغابايت تعمل مع الصور المنشورة كما هي، ورفعها فوق ذلك يتطلب تعديل `deploy/angie/angie.conf` وإعادة نشر صورة الواجهة عبر سير العمل. |
| `WEB_PORT` | المنفذ المنشور للواجهة (افتراضي 8080) — المنفذ الخارجي الوحيد. |
| `ARCHIVE_UPLOADS_PATH` | مجلد المرفقات على مضيف Docker (افتراضي `./archive/files/uploads` بجانب ملف compose). يقبل مساراً نسبياً أو مطلقاً (قرص مخصّص، مثال `/srv/archive-hlc/uploads`). يُربط إلى `/data/uploads` في حاوية `api` وحدها. |
| `UPLOADS_DIR` | مسار تخزين المرفقات داخل الحاوية (افتراضي `/data/uploads`)؛ اتركه كما هو إلا لحالات خاصة. |
| `RATE_LIMIT_*` | حدود المعدّل: دخول/عمليات حساسة/عام. |

> ملاحظة أمنية: جميع الأسرار تبقى في `.env` على المضيف فقط؛ الصور لا تحتوي أي أسرار،
> ولا حاجة لأي توكن GitHub في بيئة النشر (الصور عامة).

## 6) قاعدة البيانات والمرفقات الدائمة

### 6.1 قاعدة البيانات (حجم `pgdata` الدائم)

- PostgreSQL 18 رسمي (`postgres:18`) بحجم دائم `pgdata` مربوط على
  `/var/lib/postgresql` (تخطيط PostgreSQL 18). لا يُنشر أي منفذ لقاعدة البيانات.
- اسم المشروع مثبّت في ملف الإنتاج (`name: archive-hlc`)، لذا اسم الحجم الفعلي يبقى
  `archive-hlc_pgdata` **حتى لو نقلت مجلد النشر إلى مسار آخر** — لن تبدأ المنظومة بقاعدة
  فارغة عند النقل. (بدون هذا التثبيت يشتق Compose اسم المشروع من اسم المجلد ويتغير
  الحجم — لذلك لا تحذف السطر `name:`.)
- الترحيلات تُطبَّق تلقائياً عبر خدمة `migrate` عند كل `docker compose up`، والإصدار
  المطبَّق غير قابل للتعديل (checksums).

### 6.2 المرفقات على قرص المضيف (لا يوجد أي اعتماد على S3)

- **المسار على المضيف**: `ARCHIVE_UPLOADS_PATH` في `.env` (افتراضياً
  `./archive/files/uploads` بجانب `docker-compose.yml`). يمكن جعله مساراً مطلقاً على
  قرص مخصّص بلا أي بناء، مثال: `ARCHIVE_UPLOADS_PATH=/srv/archive-hlc/uploads`.
- **المسار داخل الحاوية**: `/data/uploads` (`UPLOADS_DIR`) — مربوط فقط بحاوية `api`
  بصلاحية قراءة/كتابة. **حاوية Angie لا ترى هذا المجلد إطلاقاً** ولا يوجد أي مسار عام
  يقود إليه؛ محاولة الوصول إلى `/uploads/...` ترجع 404 عمداً.
- **مستخدم التشغيل**: الحاوية تعمل بمستخدم غير جذري `node` بمعرّف **uid=1000, gid=1000**.
  أنشئ المجلد قبل أول تشغيل وامنحه ملكية هذا المستخدم:

  ```bash
  mkdir -p ./archive/files/uploads
  sudo chown 1000:1000 ./archive/files/uploads
  sudo chmod 750 ./archive/files/uploads
  ```

  إن أُنشئ المجلد تلقائياً بواسطة Docker فسيكون مملوكاً لـ `root` ولن يستطيع الخادم
  الكتابة فيه؛ حينها يسجّل الخادم خطأ `EACCES` واضحاً، وترجع الجاهزية `503` مع
  `"storage":false`، وتفشل عمليات الرفع برسالة عربية واضحة *بدون* تسجيل أي سطر في
  قاعدة البيانات. الإصلاح: طبّق أمرَي `chown`/`chmod` أعلاه (لا حاجة لإعادة تشغيل
  الحاوية — الفحص حيّ).

- **الخصوصية والصلاحيات**: لا يُشتق أي مسار على القرص من اسم ملف قدّمه العميل — المفاتيح
  الداخلية مثل `documents/<معرّف المعاملة>/<معرّف عشوائي>.<امتداد>` يولّدها الخادم وحده
  وتُخزَّن نسبيةً في `document_files.storage_key` (لا مسارات مضيف مطلقة في قاعدة
  البيانات، ولا تُعرض أي مفاتيح تخزين عبر الواجهة البرمجية). التنزيل يمر حصراً عبر
  `GET /api/v1/files/:id/download` بعد التحقق من الجلسة، مع ترويسات `Content-Disposition`
  آمنة، `Cache-Control: private, no-store`، و`X-Content-Type-Options: nosniff`. رفض
  المسارات المتسلّلة والروابط الرمزية وعدم استبدال ملفات قائمة وعدم ترك ملفات مؤقتة عند
  الفشل — كلها مطبَّقة داخل المزوّد المحلي ومغطاة بالاختبارات.

- **الاستمرارية**: المرفقات تصمد أمام إعادة تشغيل Compose، وإعادة إنشاء الحاوية،
  وترقية الصور، لأن المحتوى في مجلد المضيف المرتبط وليس داخل الصور أو الحاويات.
  اختبار سريع: ارفع مرفقاً ثم `docker compose restart api` ونزّله — المحتوى (وبصمة
  sha256) نفسه.

- **النسخ الاحتياطي (مهم)**: الأرشيف القابل للاستعادة يتطلب **نسختين معاً**: مجلد
  المرفقات (`ARCHIVE_UPLOADS_PATH` كاملاً) ونسخة `pg_dump` من قاعدة البيانات. نسخ
  أحدهما دون الآخر لا يكفي. لا تتضمن المنظومة نظام نسخ احتياطي مدمجاً (لا حاويات ولا
  مكونات زائدة)؛ أمثلة:

  ```bash
  docker compose exec -T db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup-db-$(date +%F).sql
  tar czf backup-uploads-$(date +%F).tgz -C ./archive/files/uploads .
  ```

- **الانتقال من النسخة السابقة (S3)**: لم يُنشر أي نظام إنتاجي سابق يعتمد S3 — استُخدمت
  خدمة S3 فقط في بيئة اختبار مؤقتة أُزيلت مع أدواتها. جميع عمليات الرفع الجديدة تذهب
  إلى التخزين المحلي. كإجراء وقائي، أي سطر قديم في `document_files` يحمل مزوّد تخزين
  مختلفاً (مثل `s3`) يُرفض الوصول إليه (تنزيلاً وحذفاً) برسالة عربية واضحة
  `unsupported_storage_provider` بدل تفسير مفتاحه القديم كمسار محلي — ولا يُحذف السطر
  ولا أي كائن تلقائياً. لا توجد أداة ترحيل تلقائية من S3 (غير لازمة لحالة هذا النظام).

**English summary**: PostgreSQL data lives in the named volume `archive-hlc_pgdata`
(project name pinned in the compose file, so moving the deployment directory does not
start an empty database). Attachments are stored on a persistent host directory
(`ARCHIVE_UPLOADS_PATH`, default `./archive/files/uploads`) bind-mounted read/write into
the **api** container only, as `/data/uploads`; the container runs as uid/gid `1000:1000`,
so the host directory must be pre-created and owned by that user. The Angie container
never sees the directory and `/uploads/...` is explicitly 404. Downloads go exclusively
through the authenticated API. Back up both the uploads directory and PostgreSQL — one
without the other is not a recoverable archive.

## 7) إنشاء أول مدير (إلزامي — لا توجد حسابات افتراضية)

من مجلد النشر (بعد `docker compose up -d`):

```bash
docker compose run --rm api node dist/scripts/create-admin.js --username admin --display-name "مدير النظام"
# سيطلب كلمة المرور تفاعلياً (أو مرّرها عبر --password-stdin / ADMIN_PASSWORD للأتمتة)
```

بعدها سجّل الدخول من الواجهة من صفحة «إدارة المستخدمين» لإنشاء بقية الحسابات.

## 8) التحديث والتثبيت والرجوع

### تحديث معتاد (وسوم متجددة)

```bash
docker compose pull      # سحب أحدث الصور من GHCR
docker compose up -d     # يشغّل migrate ثم يبدّل الحاويات المتغيرة
docker compose ps
curl -s http://localhost:8080/api/v1/ready
```

- لا `--build` أبداً على الإنتاج، ولا نسخ مصدر ولا Dockerfiles مطلوبة.
- خدمة الترحيلات تعمل تلقائياً وفق قواعدها المعتادة (بعد جهوزية قاعدة البيانات، وقبل
  تشغيل الخادم الجديد)، والترحيلات المطبَّقة لا تُعدَّل.
- **لا تحذف الأحجام أو مجلد المرفقات** لتحديث الصور؛ كلاهما بيانات دائمة.

### تثبيت نسخة محددة (Reproducible pinning)

عدّل `.env`:

```env
ARCHIVE_API_IMAGE=ghcr.io/mohandl3g/archive-hlc:api-sha-ab12cd3
ARCHIVE_WEB_IMAGE=ghcr.io/mohandl3g/archive-hlc:web-sha-ab12cd3
```

ثم `docker compose pull && docker compose up -d`. قائمة الوسوم المنشورة (sha/إصدارات):
`https://github.com/MohandL3G/archive-hlc/pkgs/container/archive-hlc` أو من صفحة
Releases عند وسم الإصدارات. استخدم **نفس التزام البناء** لصورتي api وweb معاً.

### الرجوع

الرجوع الآمن هو إعادة التثبيت على وسم سابق: أعد القيمتين في `.env` إلى وسم أصدر سابقاً
ثم `pull` + `up -d`. تنبيه صريح: الترحيلات إلى الأمام فقط؛ إذا كان الإصدار الأحدث قد
طبّق ترحيلات جديدة فسيبقى مخطط قاعدة البيانات محدَّثاً بعد الرجوع، لذا راجع ملاحظات
الإصدار قبل الرجوع وتواصل مع مطوّر النظام عند تغييرات مخطط.

## 9) استكشاف الأخطاء

| العَرَض | السبب المرجَّح | الحل |
| --- | --- | --- |
| `docker compose pull`: `denied` / `unauthorized` | حزمة GHCR ما زالت خاصة | خطوة لمرة واحدة: اجعل ظهور الحزمة Public (القسم 3) ثم أعد `pull` |
| `docker compose pull`: `manifest unknown` | الوسم غير موجود (خطأ إملائي أو وسم غير منشور) | راجع الوسوم في صفحة الحزمة، أو استخدم `api-latest`/`web-latest` |
| `docker compose up`: `env file .env not found` | لم تنسخ `.env.example` إلى `.env` | `cp .env.example .env` ثم عدّل القيم |
| `docker compose up`: متغيّر ناقص `POSTGRES_PASSWORD` | قيمة إلزامية غير مضبوطة | اضبطها في `.env` (ومعها `DATABASE_URL` المطابق) |
| `origin_not_allowed` عند الدخول من المتصفح | الوكيل لا يمرّر `Host` الأصلي بالمنفذ، أو `PUBLIC_ORIGIN` غير مطابق | تأكد من `proxy_set_header Host $http_host;` في Angie، أو اضبط `PUBLIC_ORIGIN` بالأصل الفعلي |
| الكوكي لا يُحفظ بعد الدخول على HTTP | `COOKIE_SECURE=true` مع اتصال غير مشفّر | فعّل HTTPS (المستحسن)، أو اضبطها `false` مؤقتاً للاختبار |
| `413` عند رفع مرفق كبير | الحد في صورة الواجهة `client_max_body_size 32m` أصغر من الملف | استخدم ملفاً حتى 32MB، أو ارفع الحد في `deploy/angie/angie.conf` وأعد نشر صورة الواجهة عبر سير العمل |
| `api` لا يقلع: `Missing required environment variable` | متغيّر ناقص في `.env` | راجع `docker compose logs api` وأكمل القيم؛ `DATABASE_URL` إلزامي دائماً |
| `ready` يرجع `503` مع `"storage":false` | مجلد المرفقات مملوك لـ root (أُنشئ تلقائياً بعد `up`)، أو غير موجود، أو غير قابل للكتابة | `ls -ld ./archive/files/uploads` ثم `sudo chown 1000:1000 ...` و`sudo chmod 750 ...`؛ الفحص حيّ فلا حاجة لإعادة تشغيل الحاوية |
| فشل الرفع بخطأ تخزين مع أن المجلد سليم | نفدت مساحة القرص أو انقطع الربط | تحقق من `df -h` على المضيف ومن ربط `/data/uploads` عبر `docker inspect` لحاوية `api` |
| «Applied migrations are immutable» | تعديل ملف ترحيل مطبَّق سابقاً | أعِد الملف الأصلي، وأنشئ ترحيلاً جديداً للتغييرات |
| الجلسات تنتهي فوراً | حُذف الحجم `pgdata` أو استُبدل (مشروع مختلف) | سجّل الدخول مجدداً؛ تأكد من السطر `name: archive-hlc` في ملف الإنتاج وعدم حذف الحجم |
| خطأ `401` متكرر بعد تعديل المستخدم | كلمة المرور/التعطيل يُبطلان جلسات المستخدم (بالتصميم) | أعد تسجيل الدخول |

## 10) واجهة برمجة التطبيقات (مختصر)

كل المسارات تحت `/api/v1`. الأخطاء بالشكل `{"error":{"code":"...","message":"...","details":...}}`.

| المسار | الوصف | الصلاحية |
| --- | --- | --- |
| `GET /health` • `GET /ready` | فحص صحة/جاهزية (جاهزية تتضمن قاعدة البيانات والتخزين) | عام |
| `POST /auth/login` • `POST /auth/logout` | دخول/خروج | عام / جلسة |
| `GET /auth/session` | جلسة حالية + رمز CSRF | عام (401 بدون جلسة) |
| `POST /auth/password` | تغيير كلمة المرور الشخصية | جلسة |
| `GET/POST /users` • `PATCH /users/:id` • `POST /users/:id/password` | إدارة المستخدمين | مدير |
| `GET /departments` | قائمة الإدارات | جلسة |
| `POST /departments` • `PATCH/DELETE /departments/:id` | إدارة الإدارات | مدير |
| `GET /documents` | بحث/تصفية/ترتيب/ترقيم صفحات من الخادم | جلسة |
| `GET /documents/:id` | تفاصيل معاملة | جلسة |
| `POST /documents` • `PATCH /documents/:id` | تسجيل/تعديل معاملة | جلسة |
| `DELETE /documents/:id` • `POST /documents/:id/restore` | حذف منطقي/استعادة | مدير |
| `POST /documents/:id/files` | رفع مرفق (multipart) إلى التخزين المحلي | جلسة |
| `GET /files/:id/download` • `DELETE /files/:id` | تنزيل مرفق / حذفه | جلسة / مدير |
| `GET /stats/dashboard` • `GET /reports/summary` • `GET /reports/documents.csv` | إحصائيات وتقارير (CSV بـ BOM لدعم Excel العربي) | جلسة |
| `POST /imports/legacy` • `POST /imports/backup` • `GET /exports/backup` | ترحيل بيانات المتصفح، استيراد/تصدير نسخة JSON | مدير |
| `GET /audit` | سجل التدقيق | مدير |

## 11) الصلاحيات

| العملية | موظف الأرشيف | مدير النظام |
| --- | :---: | :---: |
| عرض/بحث/تصفية المعاملات والتقارير | ✔ | ✔ |
| تسجيل وتعديل المعاملات | ✔ | ✔ |
| رفع/تنزيل المرفقات | ✔ | ✔ |
| حذف مرفق | ✖ | ✔ |
| حذف معاملة (نقل للمحذوفات) واستعادتها | ✖ | ✔ |
| إدارة الإدارات (إضافة/تعديل/تعطيل) | ✖ | ✔ |
| إدارة المستخدمين (إنشاء/أدوار/كلمات مرور/تعطيل) | ✖ | ✔ |
| ترحيل بيانات المتصفح، النسخ الاحتياطي الاستيراد/التصدير | ✖ | ✔ |
| سجلّ التدقيق | ✖ | ✔ |

قواعد أساسية مطبَّقة على الخادم دائماً (إخفاء عناصر الواجهة تجميلي فقط):

- لا توجد حسابات أو كلمات مرور افتراضية؛ أول مدير يُنشأ بأمر CLI.
- كلمات المرور تُخزَّن بـ Argon2id، والتغيير/التعطيل يُبطل كل جلسات المستخدم.
- الجلسات عبر كوكي HTTP-only (`hlc_session`، Secure في الإنتاج) + رمز CSRF لكل الطلبات المتغيّرة.
- فحص Origin/Referer لكل الطلبات المتغيّرة، وحدود معدّل على الدخول والعمليات الحساسة.
- أخطاء عامة غير كاشفة لوجود الحسابات، وكل العمليات الحساسة تُسجَّل في سجل التدقيق
  (لا يمكن لأي مستخدم تعديله أو حذفه من التطبيق).

## 12) ترحيل بيانات النسخة التجريبية (localStorage)

الواجهة القديمة كانت تحفظ كل شيء في المتصفح تحت مفتاحي `hl_archive_data_v1` (المعاملات)
و`hl_archive_departments_v1` (الإدارات). لترحيلها:

1. سجّل الدخول كمدير من **نفس المتصفح** الذي يحتوي البيانات القديمة.
2. افتح «الإعدادات» → «استيراد بيانات النسخة التجريبية من المتصفح».
3. راجع العدّادات واضغط «ترحيل بيانات المتصفح إلى الخادم» ثم أكّد.

الخصائص: التحقق والتنظيف على الخادم، خريطة إدارات (قديمة → جديدة تُنشأ تلقائياً)،
كشف التكرار برقم المعاملة (لا استبدال صامت)، تقرير بالسجلات المرفوضة مع السبب،
استيراد متكرر آمن (idempotent)، ولا تُنقل محتويات المرفقات القديمة (تنبيه بذلك فقط).
تبقى نسخة المتصفح كما هي حتى تؤكد نجاح الترحيل، ثم يمكنك حذفها بزر «حذف نسخة المتصفح بعد النجاح».

كما يتوفر من صفحة الإعدادات **تصدير/استيراد نسخة JSON كاملة** (للمدير) بنفس قواعد التحقق.

## 13) الاختبارات والتحقق

### في CI (عند كل دفع إلى main أو طلب سحب)

- `npm ci` بالـ lockfile ثم `npm run typecheck` ثم كامل حزمة اختبارات الخادم على
  `postgres:18` مؤقتة (نفس ما تشغّله محلياً في القسم 2.3).
- `scripts/validate-compose.sh` للتحقق الآلي من ملفي Compose وحدود الشبكة والاستبعادات.
- بناء صورتَي `api` و`web`؛ النشر فقط بعد نجاح كل ما سبق (القسم 3).

### محلياً

```bash
cd backend && npm ci && npm run typecheck && npm test
./scripts/validate-compose.sh            # يتطلب docker compose v2 و jq
docker compose -f docker-compose.dev.yml build
```

### خلاصة جولة التحقق المنفَّذة فعلياً (آخر تحديث: 2026-10-19)

- الخادم: `npm ci` نجح، `npm run typecheck` نظيف، وحزمة الاختبارات كاملة:
  **59 اختباراً — 59 ناجحاً، 0 فاشل، 0 متجاهل** (PostgreSQL 18).
- `scripts/validate-compose.sh`: نجح — ملف الإنتاج بلا أي `build:`، وكل الخدمات بصور
  GHCR صحيحة (`api-latest`/`web-latest`)، و`api` = `migrate`، ولا منافذ منشورة لـ`db`/`api`،
  ومجلد المرفقات في `api` وحدها، و`web` بلا أي volume، وملف التطوير يبني محلياً.
- بناء الصور: صورتا `api` و`web` بُنيتا بنجاح من نفس سياقي CI، ووسوم OCI تتحقق
  (تمرير `VCS_REF`/`IMAGE_VERSION` عبر `--build-arg` أثبت أنها تُملأ في الصورة)،
  والحاويتان تعملان بمستخدم uid=1000.
- `angie -t`: إعداد Angie سليم؛ الواجهة تُخدم (index/css/js بحالة 200) من صورة web.
- E2E على ملف الإنتاج **بصور جاهزة بأسماء GHCR** (سحب فعلي لاحقاً بعد نشر CI):
  **35 فحصاً — 35 ناجحاً**: جاهزية `ready` بقيمتَي database/storage، `migrate` ينتهي 0،
  منافذ غير منشورة إلا الواجهة، ربط المرفقات في `api` وحدها، إنشاء أول مدير، دخول + CSRF،
  رفع 2MiB → ملف على قرص المضيف بملكية 1000:1000 وصلاحيات 640 وبصمة مطابقة
  (`storage_key` في قاعدة البيانات يطابق مسار القرص، واسم ملف المستخدم غير مستخدم في
  المسار)، تنزيل مطابق البصمة مع الترويسات الأمنية، 401 بلا جلسة، `/uploads/...` = 404،
  الاستمرارية بعد إعادة تشغيل `api`، ثم حذف الملف وسطر القاعدة وتنظيف المجلد.
- بيئة الاختبار كانت مضيفة مؤقتة منفصلة (وقاعدة بيانات ومجلدات اختبار) وأُزيلت كاملة
  بعد التحقق؛ لم تُمس أي خدمة إنتاجية أو بيانات حقيقية.

### نتيجة أول نشر فعلي إلى GHCR (2026-10-19)

- سير عمل GitHub Actions نجح كاملاً على الالتزام `4e6d425` (اختبارات + تحقق +
  بناء ونشر)، ونُشرت الوسوم: `api-latest` و`web-latest` و`api-sha-4e6d425`
  و`web-sha-4e6d425`.
- **السحب المجهول مُتحقق منه فعلياً**: الحزمة عامة، و`docker pull` للصورتين
  `api-latest` و`web-latest` نجح من مضيف اختبار بلا أي مصادقة (`docker login`)،
  وبلا أي بيانات دخول في ملف Docker المحلي.
- مسار التحديث جُرّب كاملاً على مضيف اختبار: `docker compose pull && docker compose up -d`
  استبدل الحاويتين بالصورتين المنشورتين فعلاً (وسوم OCI تحمل الالتزام نفسه)، وعملت
  `migrate` ثم توقفت بنجاح، وبقيت قاعدة البيانات والمرفقات كما هي دون أي فقدان.
- طلبات السحب تُبنى دون نشر (تحقّق ذلك عبر أول طلب سحب آلي: بُنيت الصورتان ولم تضف
  أي وسوم إلى GHCR).
- Dependabot يتابع تثبيتات الإجراءات وصورة `node` الأساسية؛ ولا يتابع صورة Angie لأن
  سجلّها المخصص (docker.angie.software) غير مدعوم فيه — تُرقّى نسخة Angie يدوياً.

## 14) ملاحظات وحدود معروفة

- **مُنفَّذ ومُختبر داخل هذا المستودع**: الخادم، قاعدة البيانات والترحيلات، المصادقة
  والصلاحيات، المرفقات على التخزين المحلي، التقارير، الترحيل والنسخ الاحتياطي، الاختبارات
  الآلية، صورة Angie وإعداداتها، سير عمل البناء والنشر إلى GHCR، سكربتات Compose و‎.env.example‎.
- **يوفّره مسؤول النشر (خارج نطاق المستودع)**: شهادة TLS والاسم العام والدخول من
  الإنترنت، القرص/الوحدة المخصّصة لمجلد المرفقات ونسخه الاحتياطية الدورية **مع** نسخ
  PostgreSQL الاحتياطي (الاثنان مطلوبان معاً لاستعادة كاملة)، المراقبة الخارجية،
  وإدارة المضيف وتحديثاته.
- الواجهة تخدم ملفاتها باسم الإصدار «1.0»؛ لا توجد بصمات ملفات، والتخزين المؤقت
  المضبوط قصير مع إعادة تحقق لتصل التحديثات.
- لا تُنقل محتويات المرفقات من النسخة التجريبية القديمة (لا يوجد تخزين مرفقات سابق)؛
  تُرحَّل البيانات النصية فقط.
- لا توجد أداة ترحيل تلقائية من S3: لم يعمل النظام إنتاجياً على S3 قط، وسجلات قديمة
  بمزوّد مختلف — إن ظهرت يوماً — يُرفض الوصول إليها برسالة واضحة وتُعالج يدوياً.
- الصور المنشورة عامة على GHCR بمصدرها (OCI source) مرتبط بالمستودع؛ لا تحتوي أي أسرار
  تشغيلية — كل الإعدادات تُحقن وقت التشغيل من `.env`.
- المعمارية أحادية العقدة (بلا توزيع/توسّع أفقي)؛ مناسبة لحجم استخدام إدارة واحدة.

## 15) الترخيص والحقوق

منظومة داخلية لهاتف ليبيا. جميع الحقوق محفوظة للمالك.
