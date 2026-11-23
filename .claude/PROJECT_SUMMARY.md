# PROJECT SUMMARY — Alpha Studio Backend

**Last Updated:** 2026-11-24 · **Session:** 32 · **Setup baseline:** 2026-11-22 · **applied:** 2026-11-22 · **mode:** upgrade

> Trạng thái hiện tại, không phải changelog (`archive/PROJECT_SUMMARY_v1.md` hết hiệu lực). **Chỉ cập nhật file này khi trạng thái đổi:** `Last Updated` + `Session`, Trạng thái (`⏳/🚧/✅`), Giả định/Cấu trúc/Phụ thuộc, xoá TODO xong (không giữ `[x]`), sửa drift theo code. **Giữ gọn:** `Ghi chú` ≤ ~120 ký tự (*cái gì* + symbol chính; quy ước/bẫy/schema theo `AGENTS.md`). Vượt ~6KB ⇒ dọn trước khi thêm.

## 1. Tổng quan

- **Stack:** Node.js ESM (`>=18`), Express 5, Mongoose 8 (`npm`) → Fly.io (`alpha-studio-backend`).
- **Xong khi:** `npm run check`, `npm test`, health + smoke (local/test).
- **Contract & Storage:** JSON `{ success, message, data }`, JWT, CORS; MongoDB Atlas, Cloudinary, B2 (`.data/` local).

## 2. Trạng thái

| Hạng mục | TT | File chính | Ghi chú |
|---|---|---|---|
| Auth, users, roles | 🔶 | `server/routes/auth.js`, `server/middleware/auth.js` | `tokenVersion` revocation, ẩn reset fields; chờ smoke sandbox |
| CMS (Course/Job/Partner/Prompt), tin & dịch vụ | ✅ | `server/routes/{articles,serviceCategories}.js`, `server/utils/articleViews.js` | `vi` bắt buộc (`en` tùy chọn; publish thiếu trả 400); `contentSections` song ngữ; `/services` (Flower Street, HOME, Nhà anh Thái, Lào Cai, image-to-3D); backfill view transaction |
| Bình luận, xem & tải | ✅ | `server/routes/{comments,toolDownloads}.js`, `server/utils/viewCooldown.js` | `Comment` `article`; `viewCooldown` 6h giữ `updatedAt`; tải published `$inc`, `getAttachmentDownloadFilename`, `versions` `.`→`_`, `serviceDownloads`, ẩn `downloadCount` |
| VietYaku release | ✅ | `server/routes/vietyaku.js` | Suy link APK GitHub theo tag khi B2 chỉ có ZIP |
| Workflow, event, skills | ✅ | `server/routes/{workflow,eventLibrary,skills}.js` | Phân quyền 2 tầng project/doc; escape regex `searchUsers` |
| Cloud Desktop + agents | ✅ | `server/routes/cloud.js`, `server/models/{HostMachine,CloudSession}.js` | Contract chéo host/flow qua `x-agent-secret` |
| CRM & đóng gói | ✅ | `server/routes/crm.js`, `server/utils/crmRelease.js`, `scripts/release-to-b2.js` | `resolveCrmLatestRelease` đọc B2 `version.json?t=` trước `SystemSetting`; `crmCatalog`/`crmQuota`; ZIP chặn `.data`/`.env` |
| AI pricing & models | ✅ | `server/utils/{aiPricing,aiProvider,lumiCatalog}.js` | `gemini-3.1-flash-lite` (13/51 Cr), `gemini-3.8-flash` (38/318 Cr), trial 100 Cr, BYOK 0 Cr (`ai`, `interior`, `ledStudio`) |
| B2 orphan & retention | ✅ | `server/routes/admin.js`, `server/{retention,migrations}/` | `collectReferencedKeys`: Article, `APP_RELEASE_PREFIXES`, `LedStudioPreset.{b2Assets,galleryUrls}` |
| XML sitemap | ✅ | `server/routes/sitemap.js` | Public/indexable (gồm `/contact`, `/studio/led-studio`, bỏ `/studio/ai-skills/:slug`) |
| LumiStage Cloud/PRO | ✅ | `server/routes/ledStudio.js`, `server/utils/lumiProExporters.js`, `scripts/publish-stagepack.mjs` | Vé HMAC, PRO, Share, `stage_pack` B2 (`?parts=core,audio,video`, `PRO_REQUIRED`, `--dry-run`) |
| Automated tests | ✅ | `test/`, `server/` | 309 pass đủ deps (worktree thiếu deps: 77/105, 28 `ERR_MODULE_NOT_FOUND`); `npm run check` OK |

## 3. Giả định đang giữ

| Giả định | Giá trị | Nguồn |
|---|---|---|
| Env ESM | `import 'dotenv/config'` đầu `server/index.js` | Bẫy hoisting |
| Index prod | `autoIndex: false`; qua `db:m0:audit` / migration | `server/db/connection.js` |
| B2 trong HTML | Quét bằng `extractB2KeysFromHtml` | `test/storage-orphan-html.test.js` |
| VocabFlip FSRS | `lapses, stability, difficulty, fsrs_state, fsrs_step`: omit giữ, `null` xoá, bản cũ `0`/`null` (FE normalize); BE deploy trước, không index/backfill | `server/routes/vocab.js`, `test/vocab-fsrs.test.js` |

## 4. Cấu trúc

```text
server/index.js   entrypoint, startup, cron
server/{routes,models,middleware,utils}/  HTTP, schemas, auth, helpers + KIT.md
server/{migrations,retention}/  migrations & retention
scripts/ · test/  release/B2/M0 CLIs · node:test suites
```

## 5. Kiến trúc và refresh

`Client -> route/middleware -> model -> MongoDB/B2`; agents auth `x-agent-secret`.

| Sau khi ghi | Refresh / invalidate | Cơ chế | Hậu quả quên |
|---|---|---|---|
| Auth/role | Token/permission & client | `tokenVersion` + client | Quyền cũ / 401 |
| Schema/index | `DATABASE.md` + `db:m0:audit` | Thủ công | Drift, mất TTL/index |
| B2 field/HTML | `collectReferencedKeys()` + test | Thủ công + test | Xoá nhầm file sống |
| Cloud/agent API | FE + host/flow caller + test | Thủ công | Treo session |
| Cache/release | Invalidate / B2 trước DB | `resolveCrmLatestRelease` / tay | Bản cũ / lệch đếm |

## 6. Phụ thuộc ngoài

- MongoDB Atlas, Fly.io, Cloudinary, B2, Casso, OpenClaw, GCLI; secret chỉ ở `.env` / Fly secrets (xem `.env.example`).

## 7. Known Issues & TODOs

### Cao
- [ ] Dependency audit còn 2 advisory critical (ngoài diff).
- [ ] View backfill transaction: smoke trên MongoDB test trước deploy.
- [ ] Audit input sanitization ở public write routes.
- [ ] Cân nhắc `MONGODB_MIN_POOL_SIZE=2` trên Fly nếu cold handshake chậm.

### Trung bình
- [ ] Thiếu forgot-password & email verification (register còn enumerable).
- [ ] Auth patch: chạy `test/auth-security.test.js` + smoke trong sandbox đủ deps.
- [ ] VocabFlip FSRS (live Mongo smoke) & bài Lào Cai / image-to-3D (browser review) chờ kiểm tay.

### Thấp
- [ ] Chưa có OpenAPI/Swagger và ESLint/Prettier.
- [ ] `server/utils/lumiCatalog.js` (`getLicenseSecret`, fallback=1): bỏ fallback `JWT_SECRET` ở task code riêng.
