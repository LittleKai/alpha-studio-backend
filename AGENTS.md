# Alpha Studio Backend — Agent Router (Codex, Antigravity & Claude Code)

Express 5 / MongoDB API (Node.js ESM) deploy trên Fly.io cho Alpha Studio và các client liên quan.

Text files are UTF-8 without BOM. In PowerShell read them with
`Get-Content -Encoding UTF8`; plain `Get-Content` under `-NoProfile` garbles
Vietnamese, and writing that text back corrupts the file.

## 📖 ĐỌC THEO VIỆC

Luôn đọc `.claude/PROJECT_SUMMARY.md` trước mọi việc.

| Task đụng tới | Đọc bắt buộc |
|---|---|
| Lỗi im lặng, thứ tự nạp env ESM, storage/orphan B2, enum/view/release cache | `.claude/IMPORTANT_FIXED_BUGS.md` |
| Route, middleware, service, helper dùng chung | `.claude/CONVENTIONS.md` + `server/utils/KIT.md` |
| Model, schema, index, migration | `.claude/DATABASE.md` |
| Vận hành chi tiết cũ | `.claude/INSTRUCTIONS_FOR_CLAUDE.md` |
| Trước khi giao / promote deploy Fly.io | `.claude/SMOKE_TEST_CHECKLIST.md` |

*Lưu ý worktree/clone mới:* `.gitignore` hiện chặn `.claude/` (chỉ `.claude/PROJECT_SUMMARY.md` được Git track); nếu các file `.claude/*.md` còn lại vắng mặt trên worktree, đối chiếu từ checkout gốc của repo hoặc báo rõ phạm vi thiếu, không tạo file giả.

**KHÔNG đọc:**

- ❌ Toàn bộ `server/`, `test/` hay `scripts/` chỉ để "hiểu dự án"
- ❌ File đã được tóm tắt đủ trong `.claude/PROJECT_SUMMARY.md`
- ❌ `node_modules/`, `dist/`, `build/`, `coverage/`, `.data/`
- ❌ `.claude/archive/` và `.claude/history/` — lịch sử đã hết hiệu lực (chỉ mở để biết *vì sao*, không làm theo)

## Luật bất biến & Contract vận hành

- Response giữ shape `{ success, message, data }`; validate input tại boundary và đọc tập giá trị hợp lệ từ `enum` của Mongoose model thay vì chép mảng hard-code ở route.
- Không đổi MongoDB schema nếu user không yêu cầu rõ; đổi schema/index phải cập nhật `.claude/DATABASE.md` và chạy qua migration/audit (`autoIndex: false` trên production).
- Field B2 mới phải vào `collectReferencedKeys()`; trường rich HTML upload lên B2 phải được `extractB2KeysFromHtml()` quét.
- Sửa routes/models/middleware/business logic phải có test `node --test`.
- Contract chéo (Frontend `alpha-studio`, `alpha-crm`, `led-stage-studio`, `VietYaku`, Host/Flow agents qua `x-agent-secret`, Casso webhook, LumiStage HMAC ticket, manifest tĩnh `version.json`/`stage_pack` trên B2) phải giữ tương thích ngược và verify cả phía consumer; khi chạm sang repo ngoài, đọc `AGENTS.md` + tài liệu định tuyến của repo đích trước.
- Giữ nguyên package manager (`npm`), Node ESM entrypoint và đường dẫn script trong `package.json` / `.github/workflows/fly-deploy.yml`; dữ liệu chạy thử và manifest migration đặt trong `.data/` (đã gitignore).
- Trước thao tác xoá/migrate hàng loạt (`DELETE /api/admin/storage/orphaned`, `db:init`, `db:m0:migrate`, `db:m0:rollback`), kiểm môi trường đích (cấm seed/ghi đè mù lên `MONGODB_URI` production), chạy dry-run trước và giữ manifest `.data/migrations/*.jsonl`. Khi request/job timeout chưa rõ kết quả, đối chiếu trạng thái/idempotency trước khi gửi lại thao tác ghi.

## 🔒 BẢO MẬT

- Không ghi API key, token, password, HMAC secret hay connection string thật vào bất kỳ file nào được Git theo dõi (kể cả test fixture, fallback code, comment, markdown); chỉ dùng placeholder `<YOUR_API_KEY>`.
- Secret chỉ đọc từ `.env` (đã gitignore) hoặc Fly.io secrets sau `import 'dotenv/config'` ở đầu `server/index.js` (hoặc đọc lazy trong hàm); `.env.example` chỉ ghi tên biến code thật sự đọc và placeholder.
- Không log token, password, `MONGODB_URI`, `Authorization`, `x-agent-secret`, `x-api-token` hay webhook secret kể cả trong log debug tạm.

## 🧪 VERIFY — artifact service/container

Artifact bàn giao là Express/MongoDB API chạy độc lập (container Fly.io / Node process). Tách kết quả kiểm cú pháp/unit test, runtime local và smoke trên deploy thật; ghi rõ lệnh, exit code và phần chưa kiểm được (ví dụ thiếu `node_modules` hoặc DB thật trong worktree cô lập):

1. Chạy `npm run check` và `npm test` — kết quả phải thuộc lần chạy này.
2. Khởi động service với env test/local; `GET /api/health` và endpoint bị tác động phải trả đúng HTTP status và shape `{ success, message, data }`; trước khi promote production đối chiếu `.claude/SMOKE_TEST_CHECKLIST.md`.
3. Mutation phải kiểm dữ liệu ghi thực tế, retry/idempotency (transaction/unique key) và phía đọc consumer.
4. Task chỉ sửa docs được miễn khởi động runtime; vẫn bắt buộc kiểm path/link, placeholder, secret, encoding UTF-8 không BOM và `git diff`.

## ✍️ SAU MỖI TASK

Cập nhật `.claude/PROJECT_SUMMARY.md` theo luật ở đầu file đó (không biến summary thành changelog). Tri thức dùng lại cho các phiên sau nâng lên đúng chỗ: lỗi im lặng dễ tái phát → `.claude/IMPORTANT_FIXED_BUGS.md` (kèm dòng `Bảng bẫy`; rút văn xuôi sang `.claude/archive/` khi đã có test/guard tự động); quy ước có ≥2 ví dụ thật → `.claude/CONVENTIONS.md`; schema đổi → `.claude/DATABASE.md`; helper dùng ở ≥2 file → `server/utils/` theo `server/utils/KIT.md`.
