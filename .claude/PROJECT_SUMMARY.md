# PROJECT SUMMARY - Alpha Studio Backend

**Last Updated:** 2026-10-26 · **Session:** 18

> Trang thai hien tai, khong phai changelog. Sau moi task: cap nhat ngay/session; doi bang trang thai va TODO; cap nhat `DATABASE.md` khi schema doi. Bug quan trong vao `IMPORTANT_FIXED_BUGS.md`. Ban v1 nam trong `archive/PROJECT_SUMMARY_v1.md` va khong duoc dung lam huong dan hien tai.

**Giữ gọn (file này nạp mỗi session):** ô `Details`/`Notes` ≤ ~120 ký tự — nói *cái gì*, không kể chi tiết nội bộ. *Cơ chế + vì sao* ⇒ `CONVENTIONS.md`; bẫy ⇒ `IMPORTANT_FIXED_BUGS.md`; chi tiết UI ⇒ không ghi (code + git đã có). Vượt ~6KB ⇒ dọn trước khi thêm.

## 1. Tong quan

- **Loai:** Node.js ESM, Express 5, Mongoose/MongoDB API.
- **Artifact:** service production/Fly.io app.
- **Bang chung xong:** `npm test`, `npm run check`, health/endpoint smoke voi env local/test.
- **Contract:** JSON `{ success, message, data }`; JWT auth; CORS multi-origin.
- **Storage:** MongoDB Atlas, Cloudinary, Backblaze B2.

## 2. Trang thai

| Hang muc | Trang thai | File chinh | Ghi chu |
|---|---|---|---|
| Auth, users, roles | 🔶 | `server/routes/auth.js`, `server/middleware/auth.js` | JWT version revocation; reset fields hidden; regression tests pending sandbox |
| Content/course/job/partner/prompt | ✅ | `server/routes/`, `server/models/` | Noi dung `vi` bat buoc, `en` optional |
| VietYaku release metadata | ✅ | `server/routes/vietyaku.js`, `test/vietyaku-release.test.js` | Suy ra link APK GitHub theo tag khi manifest B2 chỉ có ZIP Windows |
| Workflow, event library, AI skills | ✅ | `server/routes/workflow.js`, `eventLibrary.js`, `skills.js` | API cho frontend |
| Phan muc dich vu + bai dich vu co sections | ✅ | `server/routes/serviceCategories.js`, `models/ServiceCategory.js`, `models/contentSection.js`, `utils/contentSections.js` | Article có section song ngữ tùy chọn (`*En`), fallback vi; HOME và Nhà anh Thái ở danh mục CAD/kiến trúc với preview tân cổ điển |
| Flower Street article | ✅ | Article data | Published /services case study with 20 WebP Cloudinary images, 4 galleries, and a B2 SketchUp attachment |
| HOME + Nhà anh Thái articles | ✅ | Article data + skill sync scripts | HOME tách Blender/SketchUp; Nhà anh Thái: 11 render + ảnh BOM WebP, SKP B2; không đính kèm Excel |
| Lao Cai + image-to-3D articles | ✅ | Article data + `publish_image_only_articles.mjs` | Hai bài Việt–Anh, 9 + 4 ảnh WebP, không tệp; API/ảnh đạt, browser review chưa có |
| Binh luan bai viet | ✅ | `server/routes/comments.js`, `models/Comment.js` | `targetType` mo rong sang `article`; enum model va `TARGET_TYPES` cua route phai khop |
| Cloud Desktop + agents | ✅ | `server/routes/cloud.js`, models HostMachine/CloudSession | Contract cheo host/flow |
| CRM + analytics | ✅ | `server/routes/crm.js`, `analytics.js` | Co rate limit va test |
| Tool/file download tracking & streaming | ✅ | `server/routes/toolDownloads.js`, `server/routes/articles.js` | GET attachment download chỉ bài published, tự `$inc`; tên tải lấy basename gốc từ `fileKey` (bỏ tiền tố timestamp), tách khỏi nhãn biên tập; `versions` key đổi `.`→`_`; admin trả `serviceDownloads`; `downloadCount` select:false (ẩn khỏi API công khai) |
| B2 orphan/retention/migrations | ✅ | `server/routes/admin.js`, `server/retention/`, `server/migrations/` | DELETE đối chiếu cả Article attachments |
| Automated tests | ✅ | `test/*.test.js`, `server/**/*.test.*` | 257 tests + syntax check đạt; news publishing guard có regression |
| CRM Windows packaging | ✅ | `scripts/release-to-b2.js` | Remove all smoke-test .data before ZIP; CRM artifact guard rejects .data/.env |
| VocabFlip private FSRS state | ✅ | `server/models/Vocab.js`, `server/routes/vocab.js` | Optional FSRS fields persist; lazy legacy normalization; no DB backfill |
| XML sitemap | ✅ | `server/routes/sitemap.js`, `test/sitemap.test.js` | Chỉ public/indexable; bài thử/rỗng đã về draft, news còn 3 bài có mô tả |
| News publishing | ✅ | `server/models/Article.js`, `server/routes/articles.js` | Tin published cần nội dung vi/media; create/update/publish chạy validation; lỗi trả 400 |

## 3. Gia dinh dang giu

VocabFlip private-card contract: optional `lapses`, `stability`, `difficulty`,
`fsrs_state`, `fsrs_step` round-trip through create/batch/PUT/read. Omitted fields
preserve existing FSRS values on updates; explicit null clears nullable fields.
Old records read as zero lapses and null FSRS values, then normalize lazily in
the client on review. Deploy backend before clients; rollback ignores additive
fields without deleting them. No index change or database backfill is required.

| Gia dinh | Gia tri | Nguon |
|---|---|---|
| Env duoc nap truoc module doc env | `import 'dotenv/config'` dau `server/index.js` | bug env-load da xac minh |
| Production schema index khong tu tao | `autoIndex: false`; index qua migration/audit | DB config + migration plan |
| Frontend/agent parse response shape hien tai | `{ success, message, data }` | route/service contracts |
| B2 URL trong HTML la reference that | quet bang `extractB2KeysFromHtml` | storage orphan tests |

## 4. Cau truc

```text
server/index.js        entrypoint, startup, cron
server/routes/         HTTP boundaries
server/models/         Mongoose schemas
server/middleware/     auth, quota, rate limits
server/utils/          shared helpers + KIT.md
server/migrations/     index/data migrations
server/retention/      retention policy
test/                  integration/pure logic tests
```

## 5. Kien truc va refresh

`Client -> route/middleware -> model/service -> MongoDB/storage`; host/flow agents auth bang `x-agent-secret`.

| Sau khi ghi | Phai refresh/invalidate | Quen thi bi |
|---|---|---|
| Doi auth/role | Token/permission response va client state | Quyen cu hoac 401 bat ngo |
| Doi schema/index | `DATABASE.md` + migration/index audit | Production drift, query cham/TTL mat |
| Them B2 URL field/HTML source | `collectReferencedKeys()` + test | File dang dung bi xoa nham |
| Doi cloud/agent contract | Frontend/host/flow caller + test | Session/heartbeat treo |
| Doi cacheable list/filter | Invalidate cache tai mutation | Counter/list cu |

## 6. Phu thuoc ngoai

- MongoDB Atlas, Fly.io, Cloudinary, Backblaze B2, Casso, OpenClaw/GCLI.
- Secret chi o `.env`/Fly secrets; docs chi ghi ten bien.

## 7. Known Issues & TODOs

### Cao
- [ ] Input sanitization can duoc audit them tai cac public write route.
- [ ] Can nhac `MONGODB_MIN_POOL_SIZE=2` tren Fly neu cold database handshake con gay latency.

### Trung binh
- [ ] Forgot-password va email verification chua co.
- [ ] Auth security patch: run `test/auth-security.test.js`, full suite and endpoint smoke in an isolated sandbox.
- [ ] Registration remains enumerable while immediate token issuance is retained; requires email-verification flow.
- [x] Nâng cấp bot và backend model sang gemini-3.1-flash-lite (mặc định) và gemini-3.8-flash (假流式-agy-gemini-3.8-flash-low), thay thế gemini-2.5-flash và 3.0 sắp bị dừng. Đồng bộ venue.md toàn diện.

### Thap
- [ ] OpenAPI/Swagger chua co.
- [ ] Chua co ESLint/Prettier config.

- VocabFlip repair verification: mocked/local full suite 256 passed; syntax checks passed. Live Mongo/API smoke pending.
- CRM packaging verification: 256 tests and syntax checks pass; rebuilt ZIP is clean, bundled Node/SQLite boot twice successfully. No API deploy.
