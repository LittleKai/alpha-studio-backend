# Alpha Studio Backend - Agent Router

Express/MongoDB API deploy tren Fly.io cho Alpha Studio va cac client lien quan.

## Doc theo viec

Luon doc `.claude/PROJECT_SUMMARY.md`.

| Task | Doc bat buoc |
|---|---|
| Route, middleware, service | `.claude/CONVENTIONS.md` |
| Model, schema, migration | `.claude/DATABASE.md` |
| Loi im lang, storage, env | `.claude/IMPORTANT_FIXED_BUGS.md` |
| Van hanh chi tiet cu | `.claude/INSTRUCTIONS_FOR_CLAUDE.md` |
| Truoc khi giao | `.claude/SMOKE_TEST_CHECKLIST.md` |

Khong doc toan bo `server/`, `node_modules/`, build output hay `.claude/archive/` chi de hieu project.

## Luat bat bien

- Response giu shape `{ success, message, data }`; validate input tai boundary.
- Khong doi MongoDB schema neu user khong yeu cau ro; doi schema phai cap nhat `DATABASE.md`.
- Secret chi doc tu env; khong log token, password, connection string hay auth header.
- Field B2 moi phai vao orphan-reference collector; rich HTML phai duoc quet URL.
- Sua routes/models/middleware/business logic phai co test `node --test`.
- Contract cheo phai cap nhat va verify client lien quan.

## VERIFY - artifact service/container

1. Chay `npm test`; chay `npm run check` neu script ton tai.
2. Khoi dong service voi env test/local; health check va endpoint bi tac dong phai tra dung status/shape.
3. Mutation phai kiem du lieu ghi, retry/idempotency va response consumer.
4. Task chi sua docs duoc mien runtime; van phai kiem path, placeholder, secret va diff.

## Sau moi task

Cap nhat `.claude/PROJECT_SUMMARY.md`; khong bien summary thanh changelog.
