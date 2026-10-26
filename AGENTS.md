# منظومة الأرشيف الإلكتروني — دليل الوكلاء والتشغيل الفني (AGENTS.md)

> هذا الملف هو المرجع التقني الشامل ودليل الوكلاء والمطورين لإدارة وتشغيل وتطوير منظومة الأرشيف الإلكتروني — هاتف ليبيا.

---

## 0) بروتوكول حل المسائل ودورة العمل للوكلاء (Agent Issue Resolution SOP)

عند العمل على أي مسألة (Issue) أو مهمة تطويرية في هذا المستودع، يجب الالتزام التام بالخطوات التالية بالترتيب:

### 1. الفروع (Branching)
- لكل مسألة فرع خاص بها يُنشأ انطلاقاً من أحدث نسخة لـ `main`:
  - لإصلاح الأخطاء: `fix/issue-<number>-<short-description>`
  - للميزات الجديدة: `feature/issue-<number>-<short-description>`
  - للتحسينات وإعادة الهيكلة: `refactor/...`

### 2. الالتزامات (Commits)
- اعتماد أسلوب Conventional Commits باللغة الإنجليزية أو العربية الواضحة، مع الإشارة لرقم المسألة:
  - مثال: `fix(ui): update attachment hint and remove no-file text (#18)`
- هوية الالتزام المعتمدة:
  ```bash
  git config user.name "MohandL3G"
  git config user.email "43265809+MohandL3G@users.noreply.github.com"
  ```

### 3. الدفع وطلب السحب (Push & Pull Request)
- دفع الفرع إلى المستودع البعيد: `git push -u origin <branch-name>`
- فتح طلب سحب (PR) موجه إلى `main` مع ربط المسألة في الوصف (مثل `Closes #18`).

### 4. سير العمل والبناء (CI & Image Publishing)
- سير عمل GitHub Actions المعتمد: `.github/workflows/publish-images.yml`
- تُبنى وتُنشر الصور تلقائياً إلى حزمة المستودع في GHCR:
  - صورة الواجهة: `ghcr.io/hlc-tripoli/archive-hlc:web-sha-<short-sha>`
  - صورة الخادم: `ghcr.io/hlc-tripoli/archive-hlc:api-sha-<short-sha>`
- عند الحاجة لنشر الصور قبل الدمج لاختبار الفرع، يُشغَّل سير العمل يدوياً عبر `workflow_dispatch`:
  ```bash
  gh workflow run publish-images.yml --ref <branch-name>
  ```

### 5. النشر والاختبار على بيئة الاختبار (CT 101)
- بيئة الاختبار تعمل على الحاوية **`CT 101`** (`master` / `10.31.0.138:8080`) تحت مسار Compose:
  `/root/compose/archive-hlc/` (مشروع `archive-hlc-test`).
- يتم تحديث وسم الصورة في ملف `.env` (`ARCHIVE_WEB_IMAGE` أو `ARCHIVE_API_IMAGE`).
- سحب الصور وإعادة تشغيل المكدس:
  ```bash
  docker compose pull && docker compose up -d
  ```
- **التحقق الآلي عبر Playwright:**
  - يتم تسجيل الدخول بحساب الاختبار: `admin` / `Ms@199903`
  - اختبار التغييرات والتحقق منها مباشرة على المتصفح وتوثيق لقطات الشاشة قبل وبعد التعديل.
- **إدارة التخزين المؤقت للأصول الثابتة (Cache Busting):**
  - ملف `index.html` يُقدَّم دائماً برأس `Cache-Control: no-cache` ولا يُخزّن على وسيط Cloudflare.
  - ملفات CSS و JS تُخزّن مؤقتاً على حافة Cloudflare والمتصفحات. عند إجراء أي تعديل على `js/script.js` أو `css/style.css`، يجب تحديث وسيط الإصدار في `index.html` (مثل `?v=1.0.x`) لضمان وصول التحديث فوراً لجميع المستخدمين دون الحاجة لمسح الذاكرة المؤقتة يدوياً.

### 6. الدمج وإغلاق المسألة (Merge & Close)
- لا يُدمج طلب السحب (PR) إلى `main` إلا بعد نجاح النشر والاختبار الفعلي على بيئة CT 101.
- بعد الدمج، يتم إغلاق المسألة وتحديث الذاكرة الدائمة (Supermemory).

---

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
GitHub Actions builds and publishes both images to `ghcr.io/hlc-tripoli/archive-hlc`;
production hosts only need the standalone `docker-compose.yml` plus a configured `.env`
file and pull prebuilt images. All application data lives on the server; the browser
keeps only the theme preference and optional legacy demo data awaiting migration.

**Department isolation (English summary, issue #10):** administrators are global and may
remain unassigned; every employee must have exactly one active department to use
operational APIs. The server reloads the user's role, active flag, department, and
department status from PostgreSQL on every authenticated request, so stale sessions
cannot widen access. Employees can only list, read, create, update, attach files to, or
export documents in their current department; cross-department IDs return `404`, and
filters, search, sorting, pagination, `includeDeleted`, reports, dashboard, and CSV are
always combined with the server-side department scope. Unassigned employees receive
`403 department_required`, and employees whose department is inactive receive
`403 department_inactive`, both with clear Arabic messages. Migration
`0003_user_department.sql` is additive and nullable: it does not auto-assign legacy users
or documents, so legacy documents without a department remain visible to administrators
only. Department deletion is blocked while users or documents reference it, and
deactivation is blocked while active employees are assigned.

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
- **قاعدة البيانات**: `backend/migrations/0001_init.sql` و`0002_employee_number.sql`
  و`0003_user_department.sql` و`0004_document_sequence_number.sql` — تُدار بمرحّل خاص
  (`src/db/migrate.ts`) يتحقق من بصمات الملفات (SHA-256) ويرفض أي تعديل على ترحيل
  مطبَّق (الترحيلات غير قابلة للتعديل بعد تطبيقها).
- **عزل الإدارات**: الموظف مرتبط بإدارة واحدة نشطة، وكل قراءة/كتابة للمعاملات
  والمرفقات والتقارير والتصدير تُقيَّد بها من قاعدة البيانات في كل طلب؛ المدير عام
  وغير ملزم بإدارة. التفاصيل في القسم 11.2.
- **التخزين**: مزوّد محلي (`LocalFilesystemStorageProvider`) يكتب المرفقات تحت
  `UPLOADS_DIR` (افتراضياً `/data/uploads` داخل الحاوية، مربوط بمجلد دائم على المضيف)،
  خلف واجهة `StorageProvider` تبقى بقية طبقات التطبيق مستقلة عن آلية التخزين.
  قاعدة البيانات تحتفظ بالمفاتيح النسبية والأحجام والبصمات فقط، ولا تُخزَّن أي ملفات
  ثنائية في PostgreSQL.
- **الصور**: صورتان منفصلتان يُنشئهما سير عمل واحد وينشرهما إلى GHCR:
  `ghcr.io/hlc-tripoli/archive-hlc:api-*` (خادم Fastify من `backend/Dockerfile`) و
  `ghcr.io/hlc-tripoli/archive-hlc:web-*` (Angie + الملفات الثابتة من
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
│   └── test/                   # اختبارات آلية (node:test) — 01..10
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
# أدوات تحسين المرفقات مطلوبة لاختبارات PDF/الصور (Debian/Ubuntu):
sudo apt-get install -y --no-install-recommends qpdf libjpeg-turbo-progs poppler-utils
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
| `ghcr.io/hlc-tripoli/archive-hlc:api-latest` / `web-latest` | أحدث بناء ناجح على `main` |
| `ghcr.io/hlc-tripoli/archive-hlc:api-sha-<short-sha>` / `web-sha-<short-sha>` | التزام محدد — للتثبيت الدقيق |
| `ghcr.io/hlc-tripoli/archive-hlc:api-v1.2.3` / `web-v1.2.3` | وسم إصدار (`v*`) |

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
docker pull ghcr.io/hlc-tripoli/archive-hlc:api-latest
docker pull ghcr.io/hlc-tripoli/archive-hlc:web-latest
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
| `PROCESSING_TMP_DIR` | مجلد العمل المؤقت لتحسين المرفقات (افتراضي `/tmp/archive-hlc` داخل الصورة). لا يُشارك مع التخزين الدائم ويُنظَّف تلقائياً. |
| `OPTIMIZE_TIMEOUT_SECONDS` | سقف زمن تحسين المرفق الواحد بالثواني (1..300، افتراضي 20). عند التجاوز يُحفظ الأصل. |
| `OPTIMIZE_CONCURRENCY` | أقصى عدد عمليات تحسين متزامنة (1..8، افتراضي 2). |
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
- الترحيل `0002_employee_number.sql` إضافي بالكامل: يضيف عمود `employee_number`
  الاختياري إلى `users` مع قيد الطول/التشذيب وفهرس فريد على `lower(employee_number)`
  للقيم غير الفارغة. الحسابات القائمة تبقى بقيمة `NULL` ولا يُولَّد لها أي رقم أو
  يُعدَّل أي صف قائم.

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

### 6.3 تحسين المرفقات قبل التخزين (PDF والصور)

يُطبَّق التحسين أثناء الرفع نفسه، بعد التحقق من النوع/الحجم وقبل حساب البصمة النهائية
وحفظ الكائن. القاعدة الأساسية: **الأصل هو المرجع**. لا تُستبدل البايتات الأصلية إلا إذا
أنتج المحسّن ملفاً صالحاً، أصغر حجماً، واجتاز فحوص السلامة وعدم تغيّر المحتوى/الخصائص.
أي فشل أو مهلة أو نقص في الأدوات يعني حفظ الأصل كما هو دون أي خطأ للمستخدم.

#### ما الذي يُحسَّن؟

| النوع | الأداة | الطريقة | ما يُحفظ |
| --- | --- | --- | --- |
| PDF | `qpdf` 11.3.0 | `--object-streams=generate --recompress-flate --compression-level=9` — تحسين هيكلي بلا فقدان، بلا rasterization أو downsampling | عدد الصفحات وترتيبها وأبعادها ودورانها، النصوص والخطوط والصور، الروابط والتعليقات والعلامات المرتبطة، حقول النماذج، معلومات المستند وتواريخ الإنشاء/التعديل |
| JPEG | `jpegtran` (libjpeg-turbo 2.1.5) | `-copy all -optimize` — إعادة ترميز Huffman فقط، **بلا فقدان وبلا إعادة ضغط lossy** | البكسلات مطابقة تماماً، EXIF/IPTC/XMP، ملف ICC، Orientation، تواريخ الالتقاط، وكل مقاطع APP/COM |
| PNG | `sharp` 0.35.5 (libvips) | إعادة ترميز PNG بلا فقدان (`compressionLevel: 9`, `adaptiveFiltering`, بلا palette) | البكسلات والشفافية، الأبعاد، ICC/EXIF/XMP، Orientation، الكثافة |
| WebP | `sharp` 0.35.5 | `lossless: true, effort: 6` (تُتخطى الملفات المتحركة) | البكسلات والشفافية، الأبعاد، ICC/EXIF/XMP |
| TIFF | `sharp` 0.35.5 | `deflate` بلا فقدان مع predictor أفقي، لصور 8-bit sRGB/رمادية فقط | البكسلات، الأبعاد، الشفافية إن وُجدت؛ تُتخطى TIFF متعددة الصفحات أو 16-bit أو CMYK |
| GIF / BMP | — | لا يوجد مسار بلا فقدان آمن للأول (palette/animation) والثاني غير مدعوم للكتابة في sharp | تبقى **بايتاً بايتاً** كما وردت |
| Office / TXT / CSV وغيرها | — | لا تُلمس إطلاقاً | بايتات مطابقة تماماً |

#### ضوابط الأمان والتحقق

- **PDF**: يُفحص باستخدام `qpdf --check`، وتُقارن الصفحات (العدد، `MediaBox`، `CropBox`،
  `Rotate`، `UserUnit`)، وعدد التعليقات، والمخططات (bookmarks)، وقاموس `/Info`
  (العنوان/المنشئ/تواريخ الإنشاء والتعديل) بين الأصل والمرشّح. ملفات PDF الموقّعة رقمياً
  (وجود `/ByteRange` أو `/Sig`) أو المشفّرة تُحفظ كما هي لأن إعادة الكتابة قد تُبطل
  التوقيع أو التشفير.
- **JPEG**: وُجد أن `jpegtran` يغيّر جداول Huffman فقط؛ لذلك تُقارن كل مقاطع APP/COM
  بايتاً بايتاً، وتُقارن أبعاد/Orientation/ICC/EXIF دلالياً، وتُقارن البكسلات الخام.
  لا تُستخدم إعادة ضغط lossy ولا إعداد جودة (مثل 85) إطلاقاً في هذا المسار.
- **الصور الأخرى**: تُقارن الأبعاد، نوع الصيغة، وجود قناة ألفا، مساحة الألوان،
  Orientation، الكثافة، ICC/XMP وEXIF (حقلاً بحقل عبر `exif-reader`)، ثم تُقارن
  البكسلات الخام RGBA. أي اختلاف يعني رفض المرشّح والاحتفاظ بالأصل.
- **القيود**: حد أعلى 20 مليون بكسل للصورة الواحدة؛ ما فوقه لا يُحسَّن (حماية من
  decompression bombs). مهلة كل أداة والتحقق النهائي محدودة بـ`OPTIMIZE_TIMEOUT_SECONDS`
  (افتراضي 20 ثانية)، وعدد العمليات المتزامنة `OPTIMIZE_CONCURRENCY` (افتراضي 2).
- **ملفات مؤقتة**: تُنشأ تحت `PROCESSING_TMP_DIR` بمجلد فريد `0700` لكل رفع، ويُحذف
  دائماً في `finally` (نجاح، فشل، مهلة، ملف تالف، انقطاع العميل، تجاوز الحجم، فشل
  التخزين أو قاعدة البيانات). لا تُحمَّل الملفات كاملة في الذاكرة، ويُفرض حد الحجم أثناء
  التدفّق نفسه.
- **الاتساق**: بعد اختيار البايتات النهائية يُعاد حساب SHA-256 والحجم منها، ويُخزَّن
  الكائن ثم يُسجَّل سطر واحد في `document_files`. إذا فشل الإدراج بعد نجاح التخزين يُحذف
  الكائن (تعويض). اسم الملف الأصلي ونوع MIME لا يتغيران.
- **الوقت**: `created_at` يمثل **بداية حدث الرفع** ويُسجَّل صراحةً، لا وقت انتهاء التحسين،
  ولا يُشتق من `mtime` للملف المؤقت أو المخزَّن. لا يُنشأ سجل ثانٍ ولا يُعدَّل سجل قائم.
- **الخصوصية**: لا تُعاد مخرجات qpdf/jpegtran أو مسارات الملفات في استجابات API. تُسجَّل
  أسباب مختصرة فقط (مثل `timeout`, `pdf_signed`, `image_pixels_changed`).

#### الأدوات وإصداراتها

الأدوات مثبّتة في **مرحلة التشغيل** النهائية لصورة API (وليس مرحلة البناء فقط):

- `qpdf=11.3.0-1+deb12u1` و`libjpeg-turbo-progs=1:2.1.5-2` من Debian bookworm.
- `sharp@0.35.5` و`exif-reader@2.0.3` مثبّتان في `package-lock.json`.
- الصورة تعمل بمستخدم `node` غير الجذري؛ `/tmp/archive-hlc` مملوك له بصلاحية `0700`.

#### استكشاف الأخطاء

- إذا غابت `qpdf` أو `jpegtran` أو فشلت، يُحفظ الأصل ويظهر في السجل سبب مختصر
  `tool_unavailable`/`optimizer_error` — الرفع ينجح دائماً. تحقق داخل الحاوية:
  `docker compose exec api qpdf --version` و`docker compose exec api jpegtran -version`.
- إذا لم يظهر أي تحسين في السجل، فغالباً لا يوجد مكسب آمن (`not_smaller`) أو النوع غير
  مدعوم (`unsupported_type`)؛ هذا سلوك مقصود وليس خطأ.
- إذا امتلأ القرص، يفشل إنشاء المجلد المؤقت ويُعاد خطأ خادم واضح دون كتابة سجل أو كائن.
  راقب مساحة `/tmp` و`PROCESSING_TMP_DIR`؛ الملفات المؤقتة لا تبقى بعد الطلب.
- ملفات PDF الموقّعة/المشفّرة تبقى بحجمها الأصلي عمداً؛ هذا ليس عطلاً.

**English summary (attachment optimization):** PDFs are structurally optimized with
qpdf 11.3 (object streams + flate recompression, no rasterization or downsampling) and
validated with `qpdf --check` plus page/geometry/rotation/annotation/outline/Info
comparisons. Signed or encrypted PDFs are stored unchanged. JPEGs use lossless
`jpegtran -copy all -optimize` (no lossy recompression, no quality setting); EXIF/IPTC/XMP,
ICC, orientation and pixels are verified unchanged. PNG, WebP and 8-bit sRGB/grayscale TIFF
are re-encoded losslessly with sharp 0.35.5, preserving alpha and metadata, and accepted only
after a raw RGBA pixel comparison. GIF/BMP, Office, text, CSV and all other types remain
byte-for-byte unchanged. Each request uses a private 0700 temporary directory, bounded to
20 megapixels and a configurable timeout/concurrency. A candidate is stored only when it is
valid, smaller and passes preservation checks; otherwise the original bytes are kept.
`created_at` remains the upload start time, and final size/SHA-256 always describe the exact
stored/downloaded bytes. Runtime tools are pinned in `backend/Dockerfile` and run as the
non-root `node` user.

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
ARCHIVE_API_IMAGE=ghcr.io/hlc-tripoli/archive-hlc:api-sha-ab12cd3
ARCHIVE_WEB_IMAGE=ghcr.io/hlc-tripoli/archive-hlc:web-sha-ab12cd3
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
| «الرقم الوظيفي مستخدم بالفعل لحساب آخر» | رقم مكرر (المقارنة بلا حساسية لحالة الأحرف) | اختر رقماً آخر، أو حرّر الحساب الذي يملك الرقم أولاً |
| تعذّر الدخول برقم وظيفي صحيح | الرقم يطابق أيضاً اسم مستخدم لحساب آخر (معرّف غامض) | استخدم معرّفاً غير متعارض أو عدّل الرقم/اسم المستخدم؛ راجع سجل التدقيق (`ambiguous_identifier`) |

## 10) واجهة برمجة التطبيقات (مختصر)

كل المسارات تحت `/api/v1`. الأخطاء بالشكل `{"error":{"code":"...","message":"...","details":...}}`.

| المسار | الوصف | الصلاحية |
| --- | --- | --- |
| `GET /health` • `GET /ready` | فحص صحة/جاهزية (جاهزية تتضمن قاعدة البيانات والتخزين) | عام |
| `POST /auth/login` • `POST /auth/logout` | دخول (اسم مستخدم أو رقم وظيفي) / خروج | عام / جلسة |
| `GET /auth/session` | جلسة حالية + رمز CSRF | عام (401 بدون جلسة) |
| `POST /auth/password` | تغيير كلمة المرور الشخصية | جلسة |
| `GET/POST /users` • `PATCH /users/:id` • `POST /users/:id/password` | إدارة المستخدمين (يتضمن الرقم الوظيفي، الاسم الكامل، تعيين الإدارة، والبحث) | مدير |
| `GET /departments` | قائمة الإدارات: المدير يرى الجميع، والموظف يرى إدارته النشطة فقط | جلسة |
| `POST /departments` • `PATCH/DELETE /departments/:id` | إدارة الإدارات (الحذف/التعطيل محميّان بمراجع المستخدمين والمستندات) | مدير |
| `GET /documents` | بحث/تصفية/ترتيب/ترقيم صفحات من الخادم، مقيّد بإدارة الموظف تلقائياً؛ يقبل `sort=sequenceNumber` | جلسة |
| `GET /documents/:id` | تفاصيل مراسلة ضمن نطاق الإدارة؛ غير الموجودة/الخارجية `404` | جلسة |
| `POST /documents` • `PATCH /documents/:id` | تسجيل/تعديل مراسلة؛ الخادم يفرض إدارة الموظف الحالية، و`type` مطلوب عند الإنشاء فقط | جلسة |
| `DELETE /documents/:id` • `POST /documents/:id/restore` | حذف منطقي/استعادة | مدير |
| `POST /documents/:id/files` | رفع مرفق (multipart) إلى التخزين المحلي ضمن نطاق الإدارة | جلسة |
| `GET /files/:id/download` • `GET /files/:id/view` | تنزيل مرفق / عرضه داخل المتصفح للأنواع السلبية المسموحة فقط، وبنفس فحوص النطاق | جلسة |
| `DELETE /files/:id` | حذف مرفق من التخزين وقاعدة البيانات مع تدقيق؛ الموظف داخل إدارته وعلى مستند قابل للتعديل، والمدير عالمي | جلسة |
| `GET /stats/dashboard` • `GET /reports/summary` • `GET /reports/documents.csv` | إحصائيات وتقارير مقيّدة بإدارة الموظف (CSV بـ BOM لدعم Excel العربي) | جلسة |
| `POST /imports/legacy` • `POST /imports/backup` • `GET /exports/backup` | ترحيل بيانات المتصفح، استيراد/تصدير نسخة JSON | مدير |
| `GET /audit` | سجل التدقيق | مدير |

## 11) الصلاحيات

| العملية | موظف الأرشيف | مدير النظام |
| --- | :---: | :---: |
| عرض/بحث/تصفية المعاملات والتقارير | ✔ داخل إدارته النشطة فقط | ✔ عالمي |
| تسجيل وتعديل المعاملات | ✔ داخل إدارته فقط | ✔ عالمي |
| رفع/تنزيل المرفقات | ✔ لمعاملات إدارته فقط | ✔ عالمي |
| حذف مرفق | ✔ على مستند قابل للتعديل داخل إدارته النشطة فقط | ✔ عالمي |
| حذف معاملة (نقل للمحذوفات) واستعادتها | ✖ | ✔ |
| إدارة الإدارات (إضافة/تعديل/تعطيل) | ✖ | ✔ |
| إدارة المستخدمين (إنشاء/أدوار/أرقام وظيفية/تعيين إدارة/كلمات مرور/تعطيل) | ✖ | ✔ |
| ترحيل بيانات المتصفح، النسخ الاحتياطي الاستيراد/التصدير | ✖ | ✔ |
| سجلّ التدقيق | ✖ | ✔ |

قواعد أساسية مطبَّقة على الخادم دائماً (إخفاء عناصر الواجهة تجميلي فقط):

- لا توجد حسابات أو كلمات مرور افتراضية؛ أول مدير يُنشأ بأمر CLI.
- كلمات المرور تُخزَّن بـ Argon2id، والتغيير/التعطيل يُبطل كل جلسات المستخدم.
- الجلسات عبر كوكي HTTP-only (`hlc_session`، Secure في الإنتاج) + رمز CSRF لكل الطلبات المتغيّرة.
- فحص Origin/Referer لكل الطلبات المتغيّرة، وحدود معدّل على الدخول والعمليات الحساسة.
- أخطاء عامة غير كاشفة لوجود الحسابات، وكل العمليات الحساسة تُسجَّل في سجل التدقيق
  (لا يمكن لأي مستخدم تعديله أو حذفه من التطبيق).
- تسجيل الدخول يقبل اسم المستخدم أو الرقم الوظيفي (بلا حساسية لحالة الأحرف، مع تشذيب
  الفراغات الطرفية)، ويُنشئ الجلسة نفسها بهوية الحساب القانونية (`user id` و`username`).
- إذا طابق المعرّف اسم مستخدم لحساب ورقم وظيفي لحساب آخر، يُرفض الدخول بالرسالة العامة
  نفسها بدل اختيار أحد الحسابين.
- **الإدارة مصدر الحقيقة لا الجلسة**: يُعاد قراءة دور المستخدم وحالة تفعيله و`department_id`
  وحالة الإدارة من PostgreSQL في كل طلب محمي؛ لا تُخزَّن هذه القيم في الكوكي ولا يُقبل
  أي `departmentId` من العميل لتوسيع النطاق. تغيير الإدارة يسري في الطلب التالي دون
  إعادة تسجيل دخول، وتغيير كلمة المرور/التعطيل يُبطل الجلسات (سلوك منفصل مقصود).
- **الموظف بلا إدارة نشطة لا يرى بيانات تشغيلية**: تسجيل الدخول يبقى متاحاً كي يستطيع
  تغيير كلمة المرور أو مراجعة الإعدادات، لكن كل مسارات المعاملات والمرفقات والإحصاءات
  والتقارير والتصدير تُرجع `403 department_required` أو `403 department_inactive`
  برسالة عربية واضحة، بما في ذلك عند تمرير مرشِّحات أو معرّفات غير صالحة.
- **العزل مطبَّق في SQL والخدمات، وليس في المسارات فقط**: استعلامات القوائم والتفاصيل
  والتعديل والمرفقات والتقارير والتصدير كلها تربط `department_id` بإدارة الموظف
  الحالية؛ ولذلك لا يوسّع النطاقَ تمريرُ `departmentId` آخر، ولا البحث، ولا الترتيب،
  ولا الترقيم، ولا `includeDeleted`. معاملة إدارة أخرى تُعالَج كغير موجودة (`404`)
  لعدم كشف وجودها.
- **إدارة الحسابات**: الموظف يجب أن يُعيَّن إلى إدارة موجودة ونشطة عند الإنشاء أو عند
  تحويل مدير إلى موظف؛ مدير النظام قد يبقى بلا إدارة ويظل عالمياً. لا يمكن إفراغ إدارة
  موظف قائم، وتُسجَّل تغييرات التعيين في سجل التدقيق.
- **دورة حياة الإدارة**: لا تُحذف إدارة ما دام أي مستخدم أو مستند (حتى المحذوف منطقياً)
  يشير إليها، ولا تُعطَّل ما دام موظف نشط معيَّن عليها. بعد نقل الارتباطات أو تعطيل
  الحسابات تصبح العمليات مسموحة.
- **الترحيل لا يخمّن**: `0003_user_department.sql` إضافي فقط ويضيف عموداً قابلاً لـ`NULL`
  وفهرساً؛ لا ينشئ إدارة افتراضية ولا يعيّن المستخدمين أو المستندات القديمة تلقائياً.
  المستندات القديمة بلا إدارة تبقى مرئية للمدير فقط إلى أن يعالجها يدوياً.
- **الترحيل 0004 إضافي أيضاً**: يضيف `documents.sequence_number text NULL` مع قيد
  طول (1..100) وفهارس بحث/ترتيب؛ لا يملأ القيم ولا يعدّل أي صف قديم. يبقى `status`
  التاريخي في قاعدة البيانات كما هو مع أن قيمته الافتراضية `new` تُستخدم عند الإدراج،
  بينما أُوقف الحقل من الواجهة والاستجابات العامة والتصدير.

### 11.1) الرقم الوظيفي وتسجيل الدخول

**قواعد البيانات**

- الرقم الوظيفي **اختياري** ويُخزَّن كنص لا كرقم، حفاظاً على الأصفار البادئة (`001245`)
  والقيم الأبجدية الرقمية (`EMP-A17`, `abc-009`).
- يُزيل الخادم الفراغات الطرفية قبل الحفظ؛ القيم الفارغة أو الفراغات فقط تُخزَّن `NULL`
  ولا تتحول أبداً إلى النص `"null"` أو `"undefined"`.
- الحد الأقصى 64 حرفاً بعد التشذيب؛ القيم الأطول تُرفض برسالة عربية واضحة
  (`employee_number_too_long`)، ومحارف التحكّم تُرفض أيضاً.
- التفرّد غير حسّاس لحالة الأحرف، ومفروض بفهرس فريد في PostgreSQL على
  `lower(employee_number)` للقيم غير الفارغة — وليس بفحص مسبق فقط، لذا تصمد الكتابات
  المتزامنة. التكرار يُرجع `409 duplicate_employee_number` مع رسالة
  «الرقم الوظيفي مستخدم بالفعل لحساب آخر.».
- البحث في إدارة المستخدمين يشمل اسم المستخدم والاسم الكامل والرقم الوظيفي، ويعمل مع
  ترشيح الدور/الحالة وترقيم الصفحات.

**إدارة الحسابات (للمدير فقط)**

- حقل «الرقم الوظيفي (اختياري)» في نافذتي الإضافة والتعديل، وعمود «الرقم الوظيفي» في
  جدول المستخدمين يعرض «غير محدد» عند غيابه.
- ترك الحقل فارغاً عند التعديل يمسح الرقم (يُرسل `null`/سلسلة فارغة ويُطبَّع إلى `NULL`).
- تعديل حقل آخر لا يمسّ الرقم الوظيفي، وتُسجَّل قيمته في تفاصيل أحداث
  `user.created`/`user.updated` في سجل التدقيق دون أي كلمات مرور أو بصمات.

**تسجيل الدخول**

- واجهة الدخول تعرض «الرقم الوظيفي أو اسم المستخدم» وتقبل كليهما.
- الواجهة ترسل `{"identifier":"...","password":"..."}`؛ ويبقى
  `{"username":"...","password":"..."}` مدعوماً للعملاء القدامى. إرسال الحقلين بقيمتين
  مختلفتين يُرفض بـ `400 identifier_mismatch` بدلاً من اختيار حساب غير مقصود.
- المعرّف الغامض (اسم مستخدم لحساب = رقم وظيفي لحساب آخر) يُرفض بـ `401` والرسالة
  العامة نفسها. لا تكشف الاستجابات وجود الحساب أو نوع الفشل.
- تتواصل حماية Argon2id، وحدود معدّل الدخول، وكوكي الجلسة `HttpOnly`/`Secure`، وCSRF،
  وفحص Origin، وتعطيل الحسابات، وإبطال الجلسات، وأحداث التدقيق دون أي تخفيف.

**الترحيل**

- الحسابات القائمة بعد تطبيق `0002_employee_number.sql` تبقى بلا رقم وظيفي (`NULL`)،
  ولا تُفقد كلمات المرور أو الأدوار أو الجلسات أو حالات التفعيل.

**English summary**: the employee number is an optional string up to 64 characters,
trimmed before storage (empty/whitespace becomes `NULL`); leading zeroes and alphanumeric
values are preserved, and uniqueness is case-insensitive via a PostgreSQL unique index
(duplicate → `409 duplicate_employee_number`). Administrators can create, edit, clear and
search by it; the users list shows “غير محدد” when unset. Login accepts the new
`identifier` field (username or employee number) while legacy clients can keep sending
`username`; conflicting fields are rejected with `400 identifier_mismatch`, and an
identifier matching two different accounts is rejected with the same generic 401 used for
all login failures. Existing accounts migrate with `NULL` and are otherwise untouched.

### 11.2) عزل الإدارات (المسألة #10)

**النموذج**

- `departments` موجودة مسبقاً؛ أضاف الترحيل `0003_user_department.sql` العمود
  `users.department_id uuid NULL REFERENCES departments(id) ON DELETE RESTRICT` والفهرس
  `users_department_idx`. الترحيل إضافي فقط ولا يعدّل أي صف.
- المدير (`admin`) **عام**: يرى ويعدّل كل الإدارات والمستندات، ويجوز أن يبقى
  `department_id = NULL`.
- الموظف (`employee`) يحتاج **إدارة واحدة موجودة ونشطة** للوصول التشغيلي. لا تُقبل
  إدارة أخرى ولا `null` في إنشاء/تعديل مستنداته، ويفرض الخادم إدارته الحالية حتى لو
  أرسل العميل قيمة مختلفة.
- لا تُقبل المعاملات القديمة (`department_id = NULL`) من الموظف؛ تبقى للمدير فقط.

**الاستجابة للطلبات**

- `403 department_required` — الموظف بلا إدارة، مع رسالة «لم يتم تعيينك إلى أي إدارة…».
- `403 department_inactive` — الإدارة موجودة لكنها معطّلة، مع اسم الإدارة في الرسالة.
- `403 department_forbidden` — محاولة موظف إنشاء/نقل معاملة إلى إدارة أخرى أو إزالتها
  من إدارته، أو إرسال `departmentId` مختلف.
- `404` — معاملة/ملف إدارة أخرى عند الطلب المباشر، أو مستند محذوف منطقياً للموظف.
- القوائم والبحث والترقيم والإحصاءات والتقارير وCSV تعيد نتائج الإدارة الحالية فقط،
  وإذا أضيف مرشِّح إدارة أخرى تكون النتيجة فارغة بدل توسيع النطاق.

**إدارة المستخدمين والإدارات**

- واجهة المدير تعرض عمود «الإدارة» في جدول المستخدمين، وحقلاً إلزامياً للموظف في
  نافذة الإضافة/التعديل، وتعرض الإدارات المعطّلة معلَّمة `(معطّلة)` مع منع اختيارها
  كإدارة نشطة عند الحفظ.
- الطلب `PATCH /users/:id` يتحقق من الدور الناتج: إذا كان `employee` فلا بد من إدارة
  نشطة موجودة، ويُسجَّل التعيين/التغيير في `audit_log` مع `revokedSessions` واسم الإدارة.
- حذف إدارة مرتبطة بمستخدمين أو مستندات يُرفض برسالة عربية واضحة، وتعطيل إدارة فيها
  موظفون نشطون يُرفض كذلك. الإدارة المعطّلة لا تظهر لموظفيها في القوائم التشغيلية.

**الواجهة**

- إخفاء صفحات الإدارات/المستخدمين/التدقيق وأزرارها عن الموظف، وإظهار إشعار وصول
  عربي واضح له عند غياب الإدارة أو تعطّلها، مع تعطيل أزرار الإنشاء والتصدير.
- حقل «الإدارة المختصة» في نموذج المراسلة يظهر للمدير فقط؛ الموظف لا يراه ولا يرسل
  `departmentId` إطلاقاً، ويشتق الخادم إدارته النشطة من قاعدة البيانات. فلتر الأرشيف
  يبقى مقفلاً على إدارة الموظف، وتُعرض الإدارة الحالية في الشريط العلوي والإعدادات.
  الواجهة تعيد قراءة الجلسة قبل تحميل البيانات التشغيلية، لكن الحماية الفعلية تبقى في
  الخادم دائماً.

**English summary (department isolation):** `users.department_id` is nullable for
backward compatibility and admin accounts, but the API requires every `employee` to have
an existing active department. Admins remain global and may be unassigned. The session
lookup joins `departments` and refreshes role/active/department state from PostgreSQL on
every protected request; client-supplied department IDs never widen access. Employees can
only access documents and attachments in their current department, and list/search/sort/
pagination/`includeDeleted`/dashboard/reports/CSV are all scoped in SQL. Cross-department
detail/update/attachment requests return `404`; a mismatched department payload returns
`403 department_forbidden`. Unassigned and inactive-department employees can still log in
but receive `403 department_required` / `403 department_inactive` with Arabic messages
until an administrator fixes the assignment. Department deletion is blocked by any user or
document reference, and deactivation is blocked while active employees remain assigned.
The additive `0003_user_department.sql` migration does not auto-assign legacy users or
documents; legacy unassigned documents stay administrator-only until handled explicitly.

### 11.3) المراسلات: المصطلحات ورقم التسلسل ودورة العمل والمرفقات (المسألة #15)

**المصطلحات المعتمدة في كل الشاشات والجداول والتفاصيل والتقارير وCSV والرسائل:**

| الحقل في قاعدة البيانات/API | التسمية الظاهرة |
| --- | --- |
| `reference` | الرقم الاشاري |
| `title` | موضوع الرسالة |
| `date` | تاريخ الرسالة |
| `sender` | من |
| `recipient` | إلى |

**رقم التسلسل:** حقل نصي اختياري (`sequenceNumber`) يُخزَّن في
`documents.sequence_number` ويحافظ على الأصفار البادئة والحروف (مثل `0012/A`).
تُشذَّب الفراغات الطرفية، والفراغ فقط يُخزَّن `NULL`، والحد الأقصى 100 حرف بعد
التشذيب، ولا توجد أي توليد تلقائي أو قيد تفرّد. يظهر في الإنشاء/التعديل/القائمة/
التفاصيل/البحث/الترتيب/CSV ونسخ JSON، وتظل السجلات والنسخ القديمة بلا الحقل
تعمل بقيمة `NULL`.

**دورة العمل:** أُزيل زر «+ تسجيل معاملة» من لوحة التحكم وحقل «نوع المعاملة» من
النموذج. زر «+ إضافة وارد» ينشئ `incoming` فقط، وزر «+ إضافة صادر» ينشئ `outgoing`
فقط، كنيّة إنشاء صريحة من القسم. عند التعديل لا ترسل الواجهة `type` إطلاقاً، فيبقى
النوع المخزَّن دون تغيير، ويظل الخادم يتحقق من القيمة المسموحة.

**إيقاف الحالة:** أُزيلت «حالة المعاملة» من النموذج والجداول والتفاصيل ومرشِّح
الأرشيف ولوحة التحكم والتقارير وCSV واستجابات JSON العامة. يبقى العمود
`status` وقيمه التاريخية في قاعدة البيانات، وتُستخدم قيمة `new` الافتراضية عند
الإدراج فقط؛ ما زال الحذف/الاستعادة المنطقيان وسجل التدقيق يعملان كما هما.
يقبل الخادم `status` في المدخلات القديمة للتوافق لكنه يتجاهلها ولا يعيدها.

**المرفقات:** في وضع الإنشاء يمكن اختيار عدة ملفات وإلغاء أي منها قبل الحفظ، ثم
تُرفع تلقائياً بعد إنشاء المراسلة مع بيان حالة/تقدم لكل ملف وتقرير نجاح/فشل جزئي
وإمكانية إعادة المحاولة دون تكرار الناجح. في وضع التعديل يبدأ الرفع فور الاختيار،
وتدعم الدفعات المتتالية، ويُمنع الحذف/الحفظ المتعارض أثناء الرفع. المرفقات المحفوظة
تعرض «عرض» للأنواع السلبية فقط (PDF/JPEG/PNG/WebP/GIF/BMP) و«تنزيل» دائماً و«حذف»
بحسب الصلاحية. مسار العرض `GET /files/:id/view` يستخدم نفس فحوص المصادقة والإدارة
والمستند المحذوف ومزوّد التخزين، ويرسل MIME المخزَّن و`inline` و`Cache-Control:
private, no-store` و`X-Content-Type-Options: nosniff`، ويسجّل `file.viewed`؛
ولا يعرض HTML/CSV/Office/النصوص أبداً داخل المتصفح.

**English summary (correspondence workflow):** visible labels are now
`الرقم الاشاري` / `موضوع الرسالة` / `تاريخ الرسالة` / `من` / `إلى` while the API
field names stay unchanged. The additive `0004` migration adds an optional, trimmed
`sequence_number` text column (1–100 chars, no auto-numbering or uniqueness) that
preserves leading zeros and letters and is supported in create/edit/list/detail/search/
sort/CSV/JSON backup; legacy rows and old backups are `NULL`-tolerant. The dashboard
create button and the type selector are gone: incoming/outgoing dedicated buttons set an
explicit create intent, edit never sends `type`, and the server still validates the enum.
The department field is admin-only in the form; employees are assigned/preserved by the
server. The user-facing status field, filters, dashboard KPI, reports and exports are
retired while historical DB values remain intact. Attachments are queued/cancelled before
save, uploaded automatically after creation or immediately on edit selection, with
per-file status and partial-failure retry, guarded deletion, and an authenticated inline
`/files/:id/view` route limited to passive PDF/image MIME types.

## 12) ترحيل بيانات النسخة التجريبية (localStorage)

الواجهة القديمة كانت تحفظ كل شيء في المتصفح تحت مفتاحي `hl_archive_data_v1` (المعاملات)
و`hl_archive_departments_v1` (الإدارات). لترحيلها:

1. سجّل الدخول كمدير من **نفس المتصفح** الذي يحتوي البيانات القديمة.
2. افتح «الإعدادات» → «استيراد بيانات النسخة التجريبية من المتصفح».
3. راجع العدّادات واضغط «ترحيل بيانات المتصفح إلى الخادم» ثم أكّد.

الخصائص: التحقق والتنظيف على الخادم، خريطة إدارات (قديمة → جديدة تُنشأ تلقائياً)،
كشف التكرار بالرقم الاشاري (لا استبدال صامت)، تقرير بالسجلات المرفوضة مع السبب،
استيراد متكرر آمن (idempotent)، ولا تُنقل محتويات المرفقات القديمة (تنبيه بذلك فقط).
تبقى نسخة المتصفح كما هي حتى تؤكد نجاح الترحيل، ثم يمكنك حذفها بزر «حذف نسخة المتصفح بعد النجاح».

كما يتوفر من صفحة الإعدادات **تصدير/استيراد نسخة JSON كاملة** (للمدير) بنفس قواعد التحقق.

## 13) الاختبارات والتحقق

### في CI (عند كل دفع إلى main أو طلب سحب)

- `npm ci` بالـ lockfile ثم `npm run typecheck` ثم كامل حزمة اختبارات الخادم على
  `postgres:18` مؤقتة (نفس ما تشغّله محلياً في القسم 2.3). تُثبَّت قبلها أدوات
  `qpdf` و`libjpeg-turbo-progs` و`poppler-utils` لاختبارات التحسين الحقيقية.
- `scripts/validate-compose.sh` للتحقق الآلي من ملفي Compose وحدود الشبكة والاستبعادات.
- بناء صورتَي `api` و`web`؛ النشر فقط بعد نجاح كل ما سبق (القسم 3).

### محلياً

```bash
cd backend && npm ci && npm run typecheck && npm test
./scripts/validate-compose.sh            # يتطلب docker compose v2 و jq
docker compose -f docker-compose.dev.yml build
```

### جولة التحقق للمسألة #10 (2026-10-21)

- `npm run typecheck`: نظيف. حزمة اختبارات الخادم كاملة: **81 اختباراً — 81 ناجحاً،
  0 فاشل، 0 متجاهل** على PostgreSQL 18 مؤقتة، وتشمل ملفاً أمنياً جديداً
  (`09-department-isolation.test.ts`) بفحوص: العزل عبر القوائم/البحث/الترتيب/الترقيم/
  `includeDeleted`، والتفاصيل/التعديل/المرفقات عبر الإدارات، ورفض `departmentId`
  المزوَّر، وموظف بلا إدارة، وإدارة معطّلة، وتحديث الجلسة بعد تغيير التعيين، وإحصاءات
  ولوحة تحكم وتقارير وCSV، ونقاط الإدارة المحظورة، وتدقيق تغيير إدارة المستخدم.
- ترحيل Clean install وترقية من مخطط ما قبل `0003` كلاهما مغطّى، مع التحقق من بقاء
  المستخدمين/المستندات/الملفات بلا تعيين تلقائي، ومن قيد `ON DELETE RESTRICT`
  والفهرس `users_department_idx`.
- `npm run build` و`node --check` لملفات الواجهة: نجحا. بناء بيئة تطوير معزولة
  (`archive-hlc-dev`، منفذ `18080`، مشروع وحجم ومجلدات منفصلة) نجح، و`/api/v1/health`
  و`/api/v1/ready` يعيدان `ok` مع `database=true` و`storage=true`.
- Playwright على البيئة المعزولة: **91 فحصاً — 91 ناجحاً** (84 فحصاً أساسياً في ثلاث
  جلسات: موظف إدارة 35، مدير عام 26، وموظف بلا إدارة/إدارة معطّلة 23، إضافة إلى
  7 فحوص تركيز لإعادة تعيين الإدارة أثناء الجلسة). شملت: RTL،
  المكتب/الجوال، السمتين، إخفاء نواحي الإدارة، قفل فلتر الإدارة، إنشاء معاملة بإدارة
  مفروضة، إخفاء المحذوفة عن الموظف وإظهارها للمدير، إحصاءات/تقارير/CSV مقيّدة،
  رفض 403/404 عبر API من سياق المتصفح، إشعارات الحجب العربية، وتعافي الجلسة القائمة
  فور تعيين الإدارة أو تفعيلها دون إعادة تسجيل دخول. لم تظهر أخطاء JavaScript غير
  متوقعة؛ سُجّلت فقط استجابات 401/403 المتوقعة لحالات الفشل المقصودة.

### جولة التحقق للمسألة #9 (2026-10-22) — تحسين المرفقات وتخطيط الإدارة

- `npm run typecheck` و`npm run build`: نظيفان. حزمة اختبارات الخادم كاملة:
  **94 اختباراً — 94 ناجحاً، 0 فاشل، 0 متجاهل** على PostgreSQL 18 مؤقتة، منها
  **13 اختباراً جديداً** في `10-attachment-optimization.test.ts` تغطّي: تحسين JPEG
  بلا فقدان مع EXIF/ICC/Orientation، وPNG الشفاف، وWebP/TIFF، وPDF عربي متعدد
  الصفحات بدوران وروابط، وعدم وجود مكسب، والملفات غير المدعومة (TXT/CSV/DOCX/GIF)
  بايتاً بايتاً، وفشل/مهلة/فقدان الأداة/مخرجات تالفة/أكبر من الأصل، وPDF الموقّع
  والمشفّر، وانقطاع العميل، وفشل التخزين وقاعدة البيانات مع التنظيف والتعويض،
  وتجاوز الحجم، وثبات `created_at` عند بداية الرفع، وعزل الإدارات.
- **اختبار صورة الإنتاج الفعلية** (`node:24-bookworm-slim` النهائية، مستخدم `node`):
  `qpdf 11.3.0` و`jpegtran` (libjpeg-turbo 2.1.5) موجودان، و`/tmp/archive-hlc`
  بصلاحية `0700`، ونجحت 8 حالات حقيقية داخل الحاوية: JPEG `96,042→88,150`،
  PNG `368,820→1,632`، WebP `1,538→1,456`، TIFF `921,838→9,834`،
  PDF `239,492→233,064`، مع ترك PDF الموقّع والمشفّر وTXT كما هي، ونجاح التحقق
  المستقل في كل حالة.
- **Playwright على بيئة تطوير معزولة** (مشروع `archive-hlc-opt-dev`، منفذ `8091`،
  مجلدات وحجم وقاعدة منفصلة تماماً؛ أُزيلت بعد الجولة): تخطيط بطاقة الإدارة في
  المكتب والجوال (عرض 390px) وفي السمتين الفاتحة والداكنة — الاسم في سطر مستقل،
  والعدد تحته، والأسماء الطويلة تلتف بلا تجاوز أفقي، واتجاه RTL سليم. رفع 5 مرفقات
  عبر الواجهة (PDF/JPEG/PNG/WebP/CSV)، ثم تنزيلها: الأحجام والبصمات تطابق
  `document_files` حرفياً، وMIME و`Content-Disposition` صحيحان، وأبعاد الصور
  المنزّلة سليمة. رفع ملف PNG تالف في وضع التعديل بقي 25 بايت كما هو، وبقيت
  أوقات المرفقات القديمة دون تغيير. لم تظهر أخطاء JavaScript غير متوقعة؛ فقط
  401 المتوقعة قبل تسجيل الدخول ومحاولة دخول فاشلة مقصودة، ومجلد العمل المؤقت
  بقي فارغاً بعد كل الطلبات.

### جولة التحقق للمسألة #15 (2026-10-23) — المصطلحات ورقم التسلسل والمرفقات

- `npm run typecheck` و`npm run build`: نظيفان. حزمة اختبارات الخادم كاملة:
  **97 اختباراً — 97 ناجحاً، 0 فاشل، 0 متجاهل** على PostgreSQL 18 مؤقتة، مع تغطية
  جديدة لترحيل `0004` على مخطط نظيف وعلى قاعدة تحتوي مستخدماً وإدارة ومستنداً ومرفقاً،
  ورقم التسلسل (أصفار بادئة/حروف/تشذيب/فراغ→NULL/حد الطول/بحث/ترتيب/سجل قديم)،
  وإخفاء `status` من الاستجابات والتقارير وCSV مع قبوله للتوافق، ومسار العرض
  `view` وترويساته وسجل تدقيقه ورفض CSV/النصوص، وصلاحيات حذف المرفقات للموظف
  داخل إدارته ورفض الإدارات الأخرى والمستندات المحذوفة، وتصدير/استيراد النسخ
  القديمة بلا `sequenceNumber`.
- Playwright على بيئة تطوير معزولة: يغطي المصطلحات، غياب زر الإنشاء العام وحقل
  النوع والحالة، تدفقَي الوارد/الصادر، إخفاء حقل الإدارة عن الموظف، رقم التسلسل
  في الإنشاء/التعديل/البحث/الترتيب/CSV، رفع عدة مرفقات وإلغاء ما قبل الحفظ،
  الرفع التلقائي بعد الإنشاء وفي التعديل، الفشل الجزئي، العرض/التنزيل/الحذف،
  ورفض الوصول عبر الإدارات، مع RTL والجوال والسمتين.

### خلاصة جولة تحقق سابقة (آخر تحديث: 2026-10-20)

- الخادم: `npm ci` نجح، `npm run typecheck` نظيف، وحزمة الاختبارات كاملة:
  **70 اختباراً — 70 ناجحاً، 0 فاشل، 0 متجاهل** (PostgreSQL 18)، ومنها اختبارات
  ترحيل الرقم الوظيفي، والتفرّد المتزامن، وتعديل/مسح الرقم، والبحث والترقيم،
  وتسجيل الدخول بالرقم الوظيفي والتوافق مع `username` ورصد التعارض.
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
- E2E للرقم الوظيفي على بيئة تطوير معزولة (مشروع وحجم ومنفذ `18080` منفصلة، أُزيلت
  كاملة بعد الاختبار): **30 فحصاً — 30 ناجحاً** عبر Playwright، شملت: الوسم والعنصر
  النائب الجديدين، RTL، التنقّل بلوحة المفاتيح، عرضَي المكتب والمحمول، السمتين الفاتحة
  والداكنة، الدخول باسم المستخدم وبالرقم `001245` (مع المسافات) وبالرقم `EMP-A17`
  (بحالة أحرف مختلفة)، إنشاء/عرض/بحث/تعديل/مسح الأرقام، رفض التكرار، تعطيل الحساب،
  رفض المعرّف الغامض، ورفض صلاحيات الموظف (403)، مع مراجعة سجل التدقيق والكونسول
  (لا أخطاء JavaScript غير متوقعة؛ فقط 401/403/409 المتوقعة من حالات الفشل المقصودة).

### نتيجة نشر الرقم الوظيفي (2026-10-20)

- سير عمل GitHub Actions رقم `39395002873` نجح كاملاً على الالتزام `1fb23ed`:
  اختبارات الخادم **70/70** وفحص الأنواع وتحقق Compose، ثم بُنيت الصورتان
  ونُشرتا. الوسوم المنشورة: `api-sha-1fb23ed` و`web-sha-1fb23ed` (إلى جانب
  `api-latest`/`web-latest`)، وبصمتاهما:
  `api@sha256:6fc8b432…` و`web@sha256:f73b8e75…`.
- نُشرت الصورتان المثبَّتتان على الالتزام نفسه في حزمة النشر الفعلية
  (`archive-hlc-test`)، بعد نسخ `.env` احتياطياً خارج المستودع. طبّق `migrate`
  الترحيل `0002_employee_number.sql` مرة واحدة ثم انتهى بالرمز 0.
- بعد الترحيل: بقيت البيانات كما هي (3 مستخدمين، مستندان، ملفان، قسم واحد)،
  وأصبح الحسابات الثلاثة القائمة بلا رقم وظيفي (`NULL`) دون أي تعديل آخر. الحاويات
  الثلاث `healthy`، و`/api/v1/ready` يعيد `database=true` و`storage=true`، والواجهة
  والملفات الثابتة الجديدة تُخدم بنجاح.
- فحص إنتاجي للقراءة فقط بعد النشر: وسم الدخول «الرقم الوظيفي أو اسم المستخدم»،
  ودخول المدير القائم، وعمود «الرقم الوظيفي» في جدول المستخدمين مع «غير محدد» للحسابات
  القائمة، وحقل اختياري (غير مطلوب، بحد 64) في نافذة الإضافة، ثم خروج. لم يُنشأ أو
  يُعدَّل أي سجل إنتاجي، ولم تظهر أخطاء JavaScript غير متوقعة.
- نُسخت قاعدة البيانات احتياطياً قبل الترحيل خارج المستودع بصلاحيات `600`، وتحقّقت
  النسخة فعلياً عبر `pg_restore --list` (82 مدخلاً) قبل المتابعة.

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
- «رقم التسلسل» حقل نصي اختياري بلا توليد تلقائي أو تفرّد؛ لا يمنع تكرار القيم،
  والقرار الإداري هو مصدر ترقيمها. القيم القديمة تبقى `NULL` حتى تُعبَّأ يدوياً.
- حالة المستند متقاعدة من الواجهة والـAPI العام، لكن العمود التاريخي باقٍ في
  قاعدة البيانات؛ لا تُستخدم للفلترة أو العرض في النسخة الحالية. يظل الحذف
  المنطقي (`deleted_at`) هو آلية إخفاء/استعادة السجلات.
- تحسين المرفقات **أفضل جهد** وليس ضماناً: إذا لم يوجد مكسب آمن يبقى الأصل. تُترك
  عمداً دون تحسين: PDF الموقّع/المشفّر، وGIF/BMP (لا مسار بلا فقدان آمن)، وصور
  TIFF متعددة الصفحات أو 16-bit أو CMYK، والصور فوق 20 مليون بكسل. هذا سلوك مقصود
  وليس عطلاً؛ راجع القسم 6.3.

## 15) الترخيص والحقوق

منظومة داخلية لهاتف ليبيا. جميع الحقوق محفوظة للمالك.
