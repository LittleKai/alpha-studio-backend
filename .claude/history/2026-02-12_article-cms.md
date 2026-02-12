# 2026-02-12: Article CMS for About & Services Pages

## Changes Made

### New Files Created
- `server/models/Article.js` - Article model with bilingual support
  - Fields: title (vi/en), slug (auto-gen), excerpt (vi/en), content (vi/en), thumbnail, category, status, author, order, isFeatured, tags
  - Category enum: 'about', 'services'
  - Status enum: 'draft', 'published', 'archived'
  - Auto-generates slug from Vietnamese title on save
  - Indexes: category+status+order, slug (unique), text search
- `server/routes/articles.js` - Full REST API for articles
  - Public: GET / (list published, filter by category), GET /:slug (detail)
  - Admin/Mod: GET /admin/list, POST /, PUT /:id, DELETE /:id, PATCH /:id/publish, PATCH /:id/unpublish
  - Uses authMiddleware + modOnly for write operations
  - Route ordering: /admin/list defined before /:slug to prevent catch-all conflict

### Modified Files
- `server/index.js` - Added article routes import and registration (`/api/articles`)

## Technical Notes
- Uses `modOnly` middleware (allows both admin and mod roles)
- Slug auto-generation: normalizes Vietnamese diacritics + appends timestamp base36 for uniqueness
- Admin list route uses regex search (not text index) to support partial matching
- Public list uses $text search for full-text matching
- Route ordering critical: Express matches routes in order, so `/admin/list` must come before `/:slug`
