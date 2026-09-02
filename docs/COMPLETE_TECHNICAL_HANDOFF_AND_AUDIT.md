# التسليم التقني الكامل والتدقيق المستقل — Remember

> **الغرض:** وثيقة أدلة لموديل AI أو مدقّق هندسي جديد كي يفحص المشروع مستقلاً ويبحث عن الفجوات. ما يلي يصف ما ظهر فعلياً في الملفات ونتائج التحقق المزوّدة، لا ما نأمل بناءه.
>
> **حدود الخصوصية:** حُذفت القيم السرية، البريد، معرّفات المستخدمين، النصوص الشخصية، وروابط الملفات الموقعة. أسماء متغيرات البيئة مذكورة بلا قيم.
>
> **حالة المجلد:** المجلد المحدد حالياً **لا يحتوي على `.git`**؛ لذلك لا توجد أي مطالبة عن `git status` أو الفرع أو الالتزامات.

---

## 1. الحالة التنفيذية

- المنتج PWA شخصية لحفظ أربع فئات: صورة، مستند، رابط، ملاحظة.
- Phase 1 منفذة برمجياً: مصادقة magic link، التقاط، مكتبة، بحث، تفاصيل، حذف، Web Share Target، تخزين خاص، RLS، وواجهة PWA.
- الاختبار اليدوي الكامل S10 ما زال غير موثق كمكتمل: تسجيل الدخول من البريد ثم الالتقاط/البحث/الفتح/الحذف في المتصفح.
- Phase 2 منفذة جزئياً وفعلياً:
  - وصف صور ثنائي اللغة + OCR عبر OpenRouter.
  - تضمينات `1536` بعد migration `0002`.
  - استرجاع هجين lexical + vector، دمج RRF، ثم `rankSearch` واعٍ بالنية.
- دليل حي مقدّم لهذه الجلسة:
  - migration `0002` نفذت من SQL Editor برسالة نجاح بلا صفوف.
  - backfill: **6 embedded، 0 skipped، 0 failed**.
  - `match_memories()` تحقق حياً.
  - اختبارات reranker العربية: `جزمة` أعادت صورتي الأحذية فقط؛ `حذاء اسود` و`شوز اسود` أعادتا صورة الحذاء الأسود فقط.
  - الخادم المحلي كان جاهزاً على المنفذ 3000 مع بيئة محلية.
  - typecheck قبل التوثيق كان exit 0؛ نتيجة ما بعد التحرير مسجلة في آخر الوثيقة.
- ليس منفذاً: استخراج PDF/DOCX، العناوين الآلية، `memory_metadata`، تنظيم/وسوم، تذكيرات، مشاركة عامة للذاكرة، تصدير، background sync، billing.

## 2. المكدس والتبعيات والأوامر الدقيقة

### التشغيل

- Node.js `>=20`، ESM (`"type": "module"`).
- Next.js `^14.2.15` App Router.
- React / React DOM `^18.3.1`.
- TypeScript `^5.6.3` بوضع strict.
- Tailwind CSS `^3.4.13` + PostCSS + Autoprefixer.
- Supabase: `@supabase/ssr ^0.5.2` و`@supabase/supabase-js ^2.45.4`.
- `sharp ^0.35.4` لتوليد الأيقونات فقط.
- ESLint/Prettier موجودان كتبعيات تطوير.

### scripts من `package.json`

| الأمر | الوظيفة |
|---|---|
| `npm run dev` | `next dev` |
| `npm run build` | `next build` |
| `npm start` | `next start` |
| `npm run lint` | `next lint` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run icons` | توليد PNG من SVG |
| `npm run verify:backend` | تحقق حي من RLS/Storage/lexical search |
| `npm run format` | Prettier على المشروع |

لا توجد test runner أو وحدة اختبارات في `package.json`؛ معظم التحقق سكربتات Node حية/تشخيصية.

## 3. خريطة الملفات الفعلية وغرضها

```text
Remember/
├─ AGENTS.md                         تعليمات الاستئناف والحماية
├─ README.md                         مقدمة؛ حالته قديمة مقارنة بالتنفيذ الحالي
├─ package.json                      الاعتماديات والأوامر
├─ next.config.mjs                   إعداد Next
├─ tailwind.config.ts                نظام الألوان/القياسات
├─ tsconfig.json                     TypeScript
├─ docs/
│  ├─ PROJECT_STATUS.md              الحالة الحالية + تاريخ الجلسات
│  ├─ SUPABASE_SETUP.md              runbook provisioning وسجل S1..S11
│  ├─ ARCHITECTURE.md                تصميم قديم جزئياً قبل AI الدلالي
│  ├─ DATABASE.md                    يصف 0001 ويحتاج مزامنة 0002
│  ├─ DECISIONS.md                   ADR-001..007؛ ADR-002/007 أصبحا تاريخيين جزئياً
│  ├─ ROADMAP.md                     قديم بخصوص embeddings
│  └─ COMPLETE_TECHNICAL_HANDOFF_AND_AUDIT.md  هذه الوثيقة
├─ supabase/
│  ├─ migrations/0001_initial_foundation.sql    الجداول/RLS/FTS/Storage
│  ├─ migrations/0002_semantic_search.sql       pgvector/embedding/HNSW/RPC
│  └─ README.md                      إعداد 0001؛ يحتاج ذكر 0002
├─ src/
│  ├─ middleware.ts                  ربط middleware ومطابقة المسارات
│  ├─ app/
│  │  ├─ layout.tsx                  metadata/PWA/SW
│  │  ├─ globals.css                 قواعد CSS الأساسية
│  │  ├─ page.tsx                    المكتبة والبحث والالتقاط
│  │  ├─ sign-in/page.tsx            شاشة الدخول
│  │  ├─ auth/callback/route.ts       PKCE أو token_hash
│  │  ├─ memory/[id]/page.tsx         التفاصيل والحذف
│  │  ├─ offline/page.tsx             fallback ثابت
│  │  ├─ share/route.ts               استقبال Web Share Target
│  │  └─ actions/
│  │     ├─ auth.ts                   signOut
│  │     ├─ memories.ts               create/delete/load more
│  │     └─ enrich.ts                 OCR/description/embedding للصورة
│  ├─ components/
│  │  ├─ auth/                        نموذج الدخول وزر الخروج
│  │  ├─ capture/CaptureButton.tsx    modal لأنواع الالتقاط الأربعة
│  │  ├─ memories/                    card/list/delete
│  │  ├─ search/                      بحث URL-synced بمهلة 300ms
│  │  ├─ pwa/                         تسجيل service worker
│  │  └─ ui/                          Button/SearchField/TextField
│  ├─ lib/
│  │  ├─ config.ts                    limits وAI config وstorage path
│  │  ├─ ai/types.ts                 واجهة AIService
│  │  ├─ ai/index.ts                 provider resolution/no-op
│  │  ├─ ai/providers/openrouter.ts   vision/embed/rerank
│  │  ├─ memories/queries.ts          list/get/hybrid search/sign URLs
│  │  ├─ memories/validation.ts       URL/MIME/size/file-name
│  │  ├─ memories/signatures.ts       magic bytes
│  │  ├─ supabase/                    client/server/middleware
│  │  ├─ analytics/index.ts           no-op بلا محتوى
│  │  └─ format.ts                    تنسيق التاريخ والحجم
│  └─ types/database.ts               أنواع يدوية؛ لا تشمل embedding
├─ public/
│  ├─ manifest.webmanifest            install/share_target
│  ├─ sw.js                           network-first + static SWR
│  └─ icons/                          SVG masters وPNG generated
└─ scripts/
   ├─ provision-supabase.mjs          provisioning 0001 عبر Management API
   ├─ apply-migration.mjs             تطبيق migration محددة إدارياً
   ├─ verify-backend.mjs              40 assertion مع مستخدمين مؤقتين
   ├─ backfill-enrich.mjs             إثراء صور قديمة
   ├─ backfill-embeddings.mjs         تضمين الصفوف الناقصة أو الكل
   ├─ verify-semantic.mjs             embedding + RPC تشخيصي
   ├─ verify-hybrid.mjs               mirror قديم جزئياً للاسترجاع/RRF
   ├─ test-search-reranker.mjs         اختبار حي للـ judge
   ├─ test-openrouter.mjs             OCR connectivity
   ├─ test-embeddings.mjs             embedding connectivity/dimensions
   ├─ search-check.mjs                lexical predicate فقط
   ├─ diagnose-search.mjs             counts بلا محتوى، لكن نصه يقول lexical فقط
   ├─ diagnose-shoes.mjs              يطبع محتوى الصور؛ حساس ولا يُشغّل في سجل مشترك
   ├─ check-owner.mjs                 يطبع بريد/UUID؛ حساس
   ├─ map-owners.mjs                  يطبع بريد ورابط دخول؛ شديد الحساسية
   ├─ dev-signin-link.mjs             يولد رابط دخول ككلمة مرور
   ├─ test-auth-otp.mjs               تشخيص إرسال magic link
   └─ generate-icons.mjs              rasterization
```

## 4. تدفقات الطلب والبيانات وقت التشغيل

### 4.1 المصادقة

1. `SignInForm` يستدعي `signInWithOtp` من المتصفح ويرسل callback محلي المنشأ.
2. `/auth/callback` يقبل `code` لـPKCE أو `token_hash + type` لـOTP/admin link.
3. `next` لا يقبل إلا مساراً نسبياً لا يبدأ `//` لتقليل open redirect.
4. `src/middleware.ts` يستدعي `updateSession`؛ يُجدد cookies عبر `@supabase/ssr` ويفحص `getUser()`.
5. غير المسجل يوجّه إلى `/sign-in`; `/sign-in` و`/auth/*` و`/offline` عامة.
6. Postgres RLS هو حاجز التفويض الحقيقي؛ middleware حاجز UX فقط.
7. trigger `handle_new_user` ينشئ profile عند إنشاء مستخدم auth.

### 4.2 التقاط ملاحظة

- `createMemory`: يقرأ المستخدم من session، يشترط نصاً، يشتق عنواناً من أول سطر بحد 80 حرفاً، ويدخل `memories`.
- `search_vector` يولد تلقائياً؛ **لا ينشأ embedding للملاحظات الجديدة في هذا المسار**. هذه فجوة فعلية: backfill منفصل مطلوب أو مسار embedding عام.

### 4.3 التقاط رابط

- `normalizeUrl` يسمح فقط `http/https` ويضيف `https://` عند غياب scheme.
- العنوان hostname فقط؛ لا fetch ولا preview.
- **لا embedding جديد للرابط** داخل `createMemory`.

### 4.4 التقاط صورة

1. تحقق session.
2. `verifyUpload`: allow-list + size (10MB) + magic bytes.
3. UUID جديد، اسم آمن، ومسار `{user}/{memory}/{file}`.
4. رفع Storage أولاً.
5. إدخال `memories` ثم `memory_files`; rollback عند فشل DB.
6. الواجهة تطلق `enrichImageMemory` بعد النجاح ولا تنتظره ضمن تجربة الحفظ.
7. enrichment يجلب الذاكرة/RLS ويولد رابطاً موقعاً، ثم provider يجلب bytes على الخادم ويحوّلها base64.
8. الوصف وOCR يعملان بالتوازي؛ ملاحظة المستخدم تحفظ أولاً، ثم النتائج الفريدة.
9. النص المركب يُضمّن ويُخزن في `embedding`; أي فشل AI صامت ولا يفشل الالتقاط.

### 4.5 التقاط مستند

- نفس رفع الصورة لكن حد 25MB وأنواع PDF/TXT/MD/DOC/DOCX.
- لا `extractText` ولا embedding تلقائي؛ الملاحظة الاختيارية فقط قابلة للبحث lexical.

### 4.6 القراءة والتخزين

- `listMemories`: newest first، الصفحة 24، يجلب صفاً إضافياً لمعرفة `hasMore`.
- أول ملف فقط يستخدم للعرض.
- `createSignedUrl` صالح ساعة؛ bucket غير عام.

### 4.7 البحث

- `SearchBar` يضع `?q=` بعد debounce 300ms؛ الصفحة Server Component.
- `searchMemories` ينفذ المسار الكامل في القسم 7.
- عند AI disabled/failure: semantic فارغ، والنتيجة النهائية lexical فقط.

### 4.8 التفاصيل والحذف

- `getMemory(id)` RLS-scoped و`maybeSingle`; غير الموجود/غير المملوك يصبح 404.
- العرض نوعي: image، رابط فتح document، رابط خارجي، أو note/caption.
- الحذف يجمع مسارات Storage، يحذف DB (cascade لـ`memory_files`) ثم يحذف objects.
- خطر: فشل حذف Storage بعد نجاح DB لا يعاد للمستخدم وقد يترك object يتيم.

### 4.9 المشاركة

- المقصود الحالي **استقبال مشاركة من نظام التشغيل إلى Remember**، وليس نشر ذاكرة للآخرين.
- manifest يرسل multipart إلى `POST /share`.
- الأولوية: أول ملف، ثم URL، ثم text note. الملفات الإضافية والعنوان والنص المرافق للملف لا تُحفظ.
- غير المسجل يوجّه إلى sign-in؛ لا توجد آلية لاستكمال payload بعد الدخول.

### 4.10 PWA/offline

- service worker يسجل بعد `load`.
- precache: `/offline`، manifest، icons؛ لا user HTML/data.
- navigation: network-first ثم `/offline`.
- static assets: stale-while-revalidate.
- POST/cross-origin passthrough؛ لا queue/background sync، ولا قراءة offline للذكريات.

## 5. قاعدة البيانات كما تنص migrations

### 5.1 `0001_initial_foundation.sql`

#### Extensions/functions/triggers

- `pgcrypto` لـ`gen_random_uuid()`.
- `set_updated_at()` قبل UPDATE على `profiles` و`memories`.
- `handle_new_user()` SECURITY DEFINER مع `search_path=public`، trigger بعد INSERT على `auth.users`.

#### `profiles`

- `id uuid PK FK auth.users ON DELETE CASCADE`
- `display_name text NULL`
- `created_at timestamptz NOT NULL default now()`
- `updated_at timestamptz NOT NULL default now()`
- RLS: أربع policies select/insert/update/delete على `id=auth.uid()`.

#### `memories`

- `id uuid PK default gen_random_uuid()`
- `user_id uuid NOT NULL FK auth.users ON DELETE CASCADE`
- `type text NOT NULL CHECK image|document|link|note`
- `title text NULL`, `text_content text NULL`, `url text NULL`
- `search_vector tsvector GENERATED STORED` من title/text/url باستعمال dictionary `english`
- `created_at`, `updated_at` timestamptz NOT NULL default now()
- indexes: GIN `memories_search_vector_idx`; btree `(user_id, created_at desc)`.
- RLS: أربع policies على `user_id=auth.uid()`.

#### `memory_files`

- `id uuid PK default gen_random_uuid()`
- `memory_id uuid NOT NULL FK memories ON DELETE CASCADE`
- `user_id uuid NOT NULL FK auth.users ON DELETE CASCADE`
- `storage_path text NOT NULL`, `file_name text NOT NULL`
- `file_type text NULL`, `file_size bigint NULL`, `created_at timestamptz NOT NULL`.
- indexes على `memory_id` وعلى `user_id`.
- أربع RLS policies على `user_id=auth.uid()`.

#### Storage

- bucket `memories`, `public=false`.
- أربع policies على `storage.objects` داخل bucket وبشرط أن أول path segment يساوي `auth.uid()`.
- العدد المتوقع من السياسات في 0001: 16 (12 للجداول + 4 للـStorage).

### 5.2 `0002_semantic_search.sql`

- extension `vector`.
- `memories.embedding vector(1536) NULL`.
- HNSW index `memories_embedding_hnsw_idx` مع cosine ops، `m=16`, `ef_construction=64`.
- `match_memories(query_embedding vector(1536), match_count int=24, similarity_threshold float=0.0)`.
- تعيد `id, similarity` حيث similarity = `1 - cosine distance`، مرتبة بالأقرب.
- `STABLE`, `SECURITY INVOKER`, `search_path=public`; RLS للمتصل يبقى فعالاً.

### 5.3 حالة التطبيق

- 0001 موثق سابقاً كمطبق ومتحقق RLS/bucket/index.
- 0002: المستخدم أفاد أن SQL Editor أعاد نجاحاً، وRPC تحقق حياً.
- backfill الحالي المبلغ: 6/6 مضمّنة بلا skip/failure.
- لم ينفذ هذا التدقيق استعلام catalog مستقل جديد؛ هذه نقطة تحقق مطلوبة في قائمة التدقيق.

## 6. معمارية AI والخصوصية

### التفعيل والنماذج

- default: no-op إذا provider معطل أو key غائب.
- Chat/Vision/Reranker: `OPENROUTER_MODEL`، default بالكود `google/gemini-2.5-flash`.
- Embeddings: `OPENROUTER_EMBEDDING_MODEL`، default `openai/text-embedding-3-small`، 1536 بعداً.
- base API ثابت في الكود؛ timeout موحد **30,000ms** لكل method.

### prompts

- OCR: استخراج كل النص كما هو وبترتيب القراءة، بلا تعليق.
- وصف: سطر إنجليزي وسطر عربي بنفس المعنى، أشياء/ألوان/نصوص/علامات، و5–10 keywords باللغتين.
- reranker: يفهم اللغات والعربية العامية والمرادفات/التهجئة؛ يرفض الترابط الضعيف والعبث وغياب الصفة المطلوبة؛ يعيد JSON فقط `{ "ids": [...] }` من IDs المعطاة.

### البيانات الخارجة إلى OpenRouter

- للصور: bytes كاملة كـbase64 data URL مرتين حالياً، مرة للوصف ومرة للـOCR؛ الرابط الموقع نفسه لا يرسل للمزود.
- للتضمين: query search كاملة أو searchable text للذاكرة.
- للـreranker: query + لكل مرشح `id`, `type`, أول 160 حرفاً من title، 900 من text، 240 من URL.
- لا يرسل user UUID صراحة في candidate، لكن memory UUID يرسل؛ وقد تحتوي الأدلة على بيانات شخصية أو URL. هذا حد ثقة خارجي صريح.

### الفشل والـfallback

- capture محفوظ قبل AI؛ enrichment يبتلع الأخطاء.
- فشل semantic embedding/RPC يعيد قائمة semantic فارغة.
- فشل reranker/JSON/timeout يعيد **lexical candidates فقط**، لا fused semantic.
- IDs الخارجة من الموديل تصفّى إلى allowed set وتزال التكرارات.

## 7. خوارزمية البحث الدلالي خطوة بخطوة

1. trim؛ query فارغة تعيد timeline.
2. tokenization بـUnicode `\p{L}\p{N}`؛ punctuation-only تعيد فارغاً.
3. lexical predicate:
   - prefix FTS: كل term بصيغة `term:*` مع AND.
   - AND-of-ORs `ilike` عبر title/url/text_content.
4. بالتوازي: lexical IDs وembedding للـquery ثم RPC.
5. **حجم pool = 100 لكل مسار**.
6. **semantic retrieval floor = 0.1** في الكود الحالي؛ هذه عتبة recall واسعة وليست قرار العرض.
7. RRF على القائمتين: `score += 1/(60 + rank)`؛ **k=60**.
8. تحميل الأدلة لكل fused ID من الجداول تحت RLS.
9. إرسال المرشحين إلى `rankSearch` بالحدود: title 160، text 900، URL 240؛ لا يوجد cap ثانٍ غير اتحاد poolين (نظرياً حتى 200 candidate).
10. parse strict JSON بعد إزالة markdown fences، تصفية IDs، ترتيب الموديل هو النهائي.
11. pagination بعد الحكم، page size 24.

### مخاطر محددة

- latency: embedding ثم DB ثم reranker متسلسلة؛ timeout منفصل 30s لكل AI call، وقد تصبح تجربة البحث بطيئة جداً.
- cost/token size: حتى 200 × evidence limits، prompt ضخم واحتمال تجاوز context/model limits.
- precision: judge احتمالي؛ لا schema mode أو temperature أو max tokens مثبتة.
- recall: pool 100 يحد النتائج؛ pagination لا تتجاوز القائمة المحكومة.
- floor 0.1 قد يجلب noise كثيراً ويزيد تكلفة judge.
- fallback lexical محافظ لكنه يفقد semantic-only hits بالكامل عند فشل judge.
- كل ضغطة بعد debounce قد تطلق embedding + rerank؛ لا cache/cancel/rate limit.
- `verify-hybrid.mjs` ما زال يستخدم threshold **0.2** ويزعم التطابق؛ drift مؤكد.
- `verify-backend.mjs` يتحقق من lexical/RLS فقط، لا pipeline semantic/reranker الكامل.

## 8. جولة الواجهة والنظام البصري

### Sign-in

- شاشة مركزية ضيقة بعرض أقصى 40rem، عنوان كبير، وصف هادئ، email field وزر بعرض كامل.
- حالات sending/sent/error؛ بعد النجاح تظهر رسالة فحص البريد وخيار بريد مختلف.

### Home

- ترحيب واسم مشتق من الجزء السابق لـ`@` في أعلى الصفحة، عنوان Remember وزر خروج.
- search field، زر accent `+ Remember something`، ثم Recent أو Results.
- grid عمود واحد ثم عمودان على `sm`; الصور aspect-video؛ البطاقات بحواف 2xl وظل خفيف.

### Capture sheet

- bottom sheet على الجوال وmodal وسط الشاشة على الأكبر، overlay أسود شفاف.
- اختيار Photo/Document/Link/Note؛ forms مخصصة، note اختياري للملف؛ loading/error/back.
- لا focus trap صريح ولا Escape handler ظاهر؛ يستحق تدقيق accessibility.

### Detail

- Back، النوع والتاريخ، العنوان، ثم محتوى حسب النوع، caption، وخط فاصل قبل delete.
- المستند/الرابط يفتحان tab جديداً مع `noopener noreferrer`.

### Empty/offline

- empty state دافئ للذاكرة أو البحث.
- offline يصرح بأن الاتصال مطلوب ولا يعرض ذاكرة مخبأة، مع Try again.

### الهوية البصرية

- خلفية warm off-white `#faf9f7`، surface أبيض، نص near-black دافئ.
- accent teal-green `#2f6d5f`، hover أغمق، accent-soft هادئ.
- حدود beige منخفضة التباين، shadow صغير، زوايا 0.875–1.5rem.
- system font، mobile-first، مسافات سخية، لا gradients/neon.
- `<html lang="en">` رغم دعم المحتوى العربي؛ لا `dir` ديناميكي. العربية تظهر عبر browser bidi لكن localization غير منفذ.

## 9. نموذج الأمن وحدود التهديد

### ضمانات موجودة

- RLS على كل جدول مستخدم؛ `SECURITY INVOKER` للـRPC.
- bucket خاص وسياسات prefix per user.
- client يستخدم anon key؛ service role server/scripts فقط.
- session يتحقق بـ`getUser()` وليس مجرد cookie محلية.
- upload size/MIME/magic bytes؛ path separators تزال.
- URL يسمح http/https فقط؛ links تعرض كنص React escaped.
- redirect `next` نسبي فقط.
- signed URLs قصيرة نسبياً (ساعة) وتولد عند الطلب.
- analytics no-op ونوعه يمنع content الحر.
- SW لا يخزن authenticated HTML.

### حدود وثغرات محتملة

- service-role scripts تتجاوز RLS وبعضها يطبع بريد/UUID/content أو login link؛ تشغيل محلي حصراً وعدم مشاركة logs.
- AI يرسل bytes/text/query/evidence إلى مزود خارجي عند التفعيل؛ "privacy-first" ليست معالجة محلية.
- لا malware scanning؛ magic bytes لا تكفي لفحص مستند ضار.
- DOCX يتحقق كـZIP فقط، لا يتأكد من بنية Office؛ text يفحص أول 16 byte فقط.
- `safeFileName` يستخدم `\w` غير Unicode وقد يشوه أسماء عربية.
- لا quotas/rate limiting ظاهرة على upload/search/AI.
- لا CSP موثقة في الملفات المفحوصة.
- signed URL في browser يمكن نسخه ويظل صالحاً حتى انتهاء TTL.
- حذف DB يسبق Storage cleanup؛ orphan ممكن عند فشل storage remove.
- middleware يفشل مفتوحاً عند غياب env، وإن كانت العمليات نفسها تفشل/RLS تحمي backend.

## 10. متغيرات البيئة — أسماء فقط

### Runtime

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AI_PROVIDER`
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`
- `OPENROUTER_EMBEDDING_MODEL`
- `OPENROUTER_SITE_URL`
- `NODE_ENV`

### Admin/diagnostic مؤقتة أو اختيارية

- `SUPABASE_ACCESS_TOKEN` — PAT مؤقت لتطبيق DDL؛ يحذف ويُلغى فوراً.
- `SUPABASE_PROJECT_REF`
- `REMEMBER_SITE_URL`
- `APP_ORIGIN`

لم تُقرأ أو تُنسخ أي قيمة في هذه الوثيقة.

## 11. أدلة التحقق والسكربتات

- `verify-backend.mjs`: موثق بنتيجة سابقة 40 passed/0 failed؛ ينشئ مستخدمين مؤقتين، يختبر profiles/RLS/Storage/private URL/signed bytes/delete/lexical Arabic/injection ثم ينظف.
- `test-openrouter.mjs`: اتصال vision/OCR ببيانات اختبار عامة.
- `test-embeddings.mjs`: اتصال embeddings ويتوقع 1536.
- `backfill-enrich.mjs`: يكتب وصف/OCR للصور القديمة؛ قد يطبع preview من الذاكرة، فلا تحفظ مخرجاته في سجل مشترك.
- `backfill-embeddings.mjs`: idempotent للـNULL افتراضياً؛ `--all` يعيد الحساب.
- `verify-semantic.mjs`: read-only لكنه يستخدم service role ويطبع previews؛ لا يثبت RLS للـRPC لأنه يتجاوزها.
- `test-search-reranker.mjs`: read-only على البيانات لكنه يرسل كل المرشحين إلى المزود ويطبع عناوين/IDs.
- `verify-hybrid.mjs`: تشخيصي **غير مطابق حالياً** بسبب threshold 0.2 وغياب reranker النهائي.
- نتيجة reranker الحية العربية موثقة في القسم 1 دون كشف محتوى شخصي.

## 12. العلل المعروفة والمصلحة

### أصلحت سابقاً ومتحقق منها

- middleware كان في root مع `src/` فلم يعمل؛ نقل إلى `src/middleware.ts`.
- البحث لم ير كلمات داخل URL/file-name؛ أضيف substring pass.
- tokenizer ASCII أسقط العربية؛ استبدل بـUnicode.
- `/offline` كان خلف auth؛ أضيف للمسارات العامة.
- صور قديمة بلا enrichment ووصف English-only؛ أضيف backfill ووصف ثنائي اللغة.
- vector noise كان يعرض عناصر مرتبطة سطحياً؛ أضيف intent-aware `rankSearch` وfallback lexical محافظ.

### أخطاء/عيوب مرجحة حالياً

1. لا embedding تلقائي للملاحظات والروابط والمستندات الجديدة؛ semantic coverage يتدهور بعد backfill.
2. مشاركة صورة من OS لا تطلق `enrichImageMemory` لأن `/share` يستدعي `createMemory` فقط؛ الصور المشتركة لا تُثرى آلياً.
3. non-awaited enrichment ليست job queue ولا retry؛ إغلاق الصفحة/تعطل request قد يترك الصورة دون إثراء.
4. فشل update داخل `enrichImageMemory` لا يفحص `error` ويُبتلع.
5. فشل Storage delete بعد DB delete لا يبلغ عنه.
6. سكربت `verify-hybrid` drift: 0.2 مقابل 0.1 ويغيب reranker.
7. `diagnose-search` ما زال يعلن أن البحث lexical فقط؛ رسالة قديمة.
8. أنواع DB اليدوية لا تشمل `embedding` ومصدرها comment يشير إلى 0001 فقط.
9. وثائق README/ARCHITECTURE/DATABASE/DECISIONS/ROADMAP/supabase README قديمة مقارنة بالواقع.
10. reranker بلا output schema/temperature/max_tokens، واحتمال JSON غير صالح/تكلفة عالية.
11. أكثر من ملف واحد في share يهمل؛ shared caption/title يهمل عند file precedence.
12. pagination/search محصورة في candidate pool ولا يوجد stable DB rank tie-break موثق خارج insertion order.
13. `html lang=en` وتجربة عربية بلا localization/RTL مقصود.
14. لا اختبارات UI/E2E/accessibility/unit ظاهرة.

## 13. الديون والقيود والمخاطر

- أنواع Supabase غير مولدة ولا مربوطة generic.
- لا queue للـAI، لا observability أو metrics أو retries.
- لا cache للتضمينات query أو reranker.
- enrichment يرسل الصورة مرتين ويستهلك bandwidth/cost.
- document extraction وlink preview غائبان.
- FTS dictionary إنجليزي؛ العربية تعتمد substring/embedding.
- لا migration ledger محلي أو CLI metadata ظاهر؛ إثبات 0002 الحالي من المستخدم/live scripts.
- service worker يدوي وبسيط، لا background sync أو offline data.
- service role موجود لتشخيصات/admin مع blast radius كامل.
- التاريخ في docs غير متسق؛ يجب إبقاء PROJECT_STATUS وهذه الوثيقة مرجعاً حتى المزامنة.

## 14. قائمة تدقيق مستقلة مرتبة بالأولوية

### P0 — صحة/خصوصية

- [ ] `src/lib/memories/queries.ts`: اختبر RPC عبر session لمستخدمين، لا service role، وأثبت عدم تسرب semantic IDs.
- [ ] `src/app/actions/enrich.ts`: افحص error من update؛ اختبر انقطاع provider وDB.
- [ ] `src/app/actions/memories.ts`: عالج/سجل فشل Storage cleanup بعد delete بلا كشف بيانات.
- [ ] `src/app/share/route.ts`: أثبت auth وpayload limits، ثم قرر إثراء الصور المشتركة وحفظ caption.
- [ ] `openrouter.ts`: threat review للبيانات المرسلة، URL/text truncation، prompt injection داخل candidate evidence، وretention policy الخارجية.
- [ ] شغّل catalog SQL للتحقق من extension/column/index/function owner/security وRLS grants.

### P1 — البحث

- [ ] tests ثابتة لـtokenize/buildSearchFilter/RRF باستخدام fixtures بلا بيانات حقيقية.
- [ ] E2E بالعربية للمرادفات، الهمزات، اللون، nonsense، mixed Arabic/English.
- [ ] malformed JSON، IDs مخترعة، duplicate IDs، timeout، 429/5xx، AI disabled.
- [ ] قس p50/p95 وtokens/cost عند 1/24/100/200 مرشح.
- [ ] ضع cap واضحاً للـreranker أو pre-pruning، وschema JSON إن كان API يدعمه.
- [ ] اختبر pagination >24 و>100 وتغيّر البيانات بين الصفحات.
- [ ] أصلح `verify-hybrid.mjs` إلى 0.1 وأضف reranker أو أعد تسميته retrieval-only.
- [ ] أضف embedding عند إنشاء note/link/document أو worker عام؛ اختبر dimension=1536.

### P1 — capture/storage

- [ ] unit tests لكل magic signature والـspoofed MIME والحجم الحدّي.
- [ ] DOCX: تحقق من ZIP entries الصحيحة، لا مجرد `PK`.
- [ ] أسماء ملفات عربية/متكررة/200+ حرف؛ راجع `safeFileName`.
- [ ] اختبر rollback في كل نقطة فشل وorphan scan دوري.
- [ ] اختبر ملفات share متعددة والنص المصاحب.

### P2 — UI/PWA/accessibility

- [ ] keyboard focus trap/Escape/return focus للـmodal.
- [ ] labels، contrast، screen reader، reduced motion، touch targets.
- [ ] RTL/Bidi والعناوين/URLs العربية، و`lang/dir`.
- [ ] installability وshare target على أجهزة فعلية.
- [ ] offline cold start/upgrade/cache invalidation؛ لا user HTML في cache.

### P2 — التوثيق/التشغيل

- [ ] حدّث ARCHITECTURE/DATABASE/DECISIONS/ROADMAP/README/supabase README.
- [ ] ولّد Supabase types وأضف embedding/RPC signatures.
- [ ] أضف CI فعلياً؛ غياب `.git` يعني لا يمكن استنتاج CI الحالي من هذا المجلد.
- [ ] راجع scripts الحساسة واجعل default output redacted.
- [ ] وثق/نفذ S10 وS11 دون تسجيل البريد أو روابط الدخول.

## 15. الإعداد والتشغيل والاختبار

```bash
npm install
node_modules/.bin/tsc --noEmit
npm run dev
```

- أنشئ `.env.local` من template محلياً واملأ الأسماء المطلوبة بلا نشر القيم.
- طبق migrations بالترتيب `0001` ثم `0002` على بيئة جديدة.
- أكد private bucket وAuth callback.
- عند تفعيل AI، أكد model embedding يخرج 1536.
- backfill عند الحاجة:

```bash
node scripts/backfill-enrich.mjs
node scripts/backfill-embeddings.mjs
```

- تحقق آمن نسبياً:

```bash
npm run typecheck
npm run build
npm run verify:backend
node scripts/test-embeddings.mjs
```

السكربتات الحية تتطلب backend/keys وقد تنشئ مستخدمين مؤقتين أو ترسل بيانات إلى AI؛ اقرأ رأس كل سكربت قبل التشغيل، ولا تنسخ output الحساس.

## 16. نقطة الاستئناف الدقيقة

1. لا تعد تطبيق 0002 بلا فحص؛ الحالة المبلغ عنها: مطبقة وRPC يعمل و6 صفوف backfilled.
2. شغّل typecheck المسجل أدناه، ثم أكمل S10 يدوياً وسجل النتيجة دون هوية أو محتوى.
3. أول عمل برمجي موصى به: إصلاح semantic coverage للأنواع غير الصورية وصور `/share` عبر مسار enrichment/embedding durable، مع tests.
4. بالتوازي أصلح drift في `verify-hybrid.mjs` ورسائل التشخيص القديمة.
5. بعدها اضبط reranker للـlatency/cost/structured output، ثم نفذ قائمة P0/P1.
6. أكد S11: PAT provisioning ملغى. لا توجد حاجة runtime له.

## 17. نتيجة TypeScript بعد التوثيق

- نفّذ `node_modules/.bin/tsc --noEmit` بعد إنشاء/تحديث الوثيقتين.
- النتيجة: **EXIT=0**، بلا أي أخطاء في المخرجات (مخرجات فارغة). التغييرات كانت توثيقية فقط ولم تمس أي كود مصدري أو ملف مستقر محمي، لذا بقي typecheck نظيفاً.
