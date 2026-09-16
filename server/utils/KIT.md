# Backend Shared Kit

## Co gi trong day

| File | Vai tro | Khi dung |
|---|---|---|
| `authRole.js` | Doc optional bearer token de nhan dien mod/admin tren public route | Import `checkIsMod`; khong chep helper vao route |

## Copy hay load chung

**Load chung.** Backend dang deploy lien tuc; sua auth-role behavior phai ap dung dong nhat cho moi route.

## LUAT PROMOTE

Helper khong gan mot route va da copy o it nhat hai file phai chuyen vao `server/utils/` trong cung task. Giu validation/error mapping dac thu o caller. Khong promote code chua chay test hoac syntax check.
