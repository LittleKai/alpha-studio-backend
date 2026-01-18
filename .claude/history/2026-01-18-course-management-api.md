# Course Management API Implementation

**Date:** 2026-01-18
**Type:** Feature Implementation
**Author:** Claude Code

---

## Summary

Implemented a complete REST API for Course Management, including CRUD operations, publishing workflow, and statistics endpoint. All endpoints are protected with admin-only authorization.

---

## Changes Made

### New Files Created

1. **`server/models/Course.js`**
   - Mongoose schema with multilingual fields:
     - `title.vi`, `title.en`
     - `description.vi`, `description.en`
   - Nested schemas for modules and lessons
   - Virtual fields: `finalPrice`, `totalLessons`
   - Text indexes for search functionality
   - Fields: category, level, price, discount, status, thumbnail, etc.

2. **`server/routes/courses.js`**
   - GET `/` - List courses with pagination, filters, search
   - GET `/stats` - Aggregated statistics
   - GET `/:id` - Single course details
   - POST `/` - Create new course
   - PUT `/:id` - Update course
   - DELETE `/:id` - Delete course
   - PATCH `/:id/publish` - Publish course
   - PATCH `/:id/unpublish` - Unpublish course
   - PATCH `/:id/archive` - Archive course

### Modified Files

1. **`server/index.js`**
   - Added course routes import
   - Mounted at `/api/courses`
   - Added PATCH to CORS allowed methods

2. **`server/middleware/auth.js`**
   - Added `adminOnly` middleware
   - Checks `req.user.role === 'admin'`
   - Returns 403 for non-admin users

---

## API Endpoints

### List Courses
```
GET /api/courses
Query params: page, limit, status, category, level, search, sort
Response: { success, data: { courses, pagination } }
```

### Get Statistics
```
GET /api/courses/stats
Response: { success, data: { totalCourses, publishedCourses, totalEnrollments, averageRating } }
```

### Create Course
```
POST /api/courses
Body: { title, description, category, level, price, discount, modules, ... }
Response: { success, data: course }
```

### Update Course
```
PUT /api/courses/:id
Body: { ...updated fields }
Response: { success, data: course }
```

### Delete Course
```
DELETE /api/courses/:id
Response: { success, message }
```

### Publishing Workflow
```
PATCH /api/courses/:id/publish    -> status: 'published', publishedAt: now
PATCH /api/courses/:id/unpublish  -> status: 'draft', publishedAt: null
PATCH /api/courses/:id/archive    -> status: 'archived'
```

---

## Course Schema

```javascript
{
  title: { vi: String, en: String },
  description: { vi: String, en: String },
  thumbnail: String,
  category: String,
  level: ['beginner', 'intermediate', 'advanced'],
  price: Number,
  discount: Number,
  status: ['draft', 'published', 'archived'],
  modules: [{
    title: { vi: String, en: String },
    lessons: [{
      title: { vi: String, en: String },
      duration: Number,
      videoUrl: String,
      isFree: Boolean
    }]
  }],
  enrollmentCount: Number,
  rating: Number,
  totalReviews: Number,
  instructor: { name: String, avatar: String },
  publishedAt: Date
}
```

---

## Technical Decisions

### Authorization
- All course endpoints require admin role
- Implemented via `adminOnly` middleware chain
- Route: `router.use(authMiddleware, adminOnly)`

### Search Implementation
- MongoDB text index on title and description fields
- Search query uses `$text: { $search }` operator
- Supports both Vietnamese and English content

### Pagination
- Default: 10 items per page
- Returns: `{ courses, pagination: { page, limit, total, pages } }`

### Virtual Fields
- `finalPrice`: Calculated from price and discount percentage
- `totalLessons`: Sum of all lessons across modules

---

## Bug Fixes

1. **CORS PATCH method blocked**
   - Added 'PATCH' to allowed methods array in CORS config
   - Methods: `['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']`

---

## Testing Notes

- Tested all CRUD operations via frontend
- Tested pagination with various page sizes
- Tested search functionality
- Tested publishing workflow transitions
- Tested admin-only access restriction
