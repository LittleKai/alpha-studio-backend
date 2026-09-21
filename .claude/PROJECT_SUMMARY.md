# PROJECT SUMMARY - Alpha Studio Backend

**Last Updated:** 2026-09-22 · **Session:** 2

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
| Auth, users, roles | ✅ | `server/routes/auth.js`, `server/middleware/auth.js` | JWT 7 ngay |
| Content/course/job/partner/prompt | ✅ | `server/routes/`, `server/models/` | Noi dung `vi` bat buoc, `en` optional |
| Workflow, event library, AI skills | ✅ | `server/routes/workflow.js`, `eventLibrary.js`, `skills.js` | API cho frontend |
| Phan muc dich vu + bai dich vu co sections | ✅ | `server/routes/serviceCategories.js`, `models/ServiceCategory.js`, `models/contentSection.js`, `utils/contentSections.js` | Article co `serviceCategory`, `sections` (4 kind), `attachments` (tep B2, khong chua anh) |
| Binh luan bai viet | ✅ | `server/routes/comments.js`, `models/Comment.js` | `targetType` mo rong sang `article`; enum model va `TARGET_TYPES` cua route phai khop |
| Cloud Desktop + agents | ✅ | `server/routes/cloud.js`, models HostMachine/CloudSession | Contract cheo host/flow |
| CRM + analytics | ✅ | `server/routes/crm.js`, `analytics.js` | Co rate limit va test |
| B2 orphan/retention/migrations | ✅ | `server/routes/admin.js`, `server/retention/`, `server/migrations/` | DELETE doi chieu lai reference |
| Automated tests | ✅ | `test/*.test.js`, `server/**/*.test.*` | Node test runner |

## 3. Gia dinh dang giu

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
- [ ] GCLI preview model codes dang dung low-code fallback; khoi phuc khi upstream on dinh.

### Thap
- [ ] OpenAPI/Swagger chua co.
- [ ] Chua co ESLint/Prettier config.

