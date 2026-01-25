# 2026-01-24: Course Enrollment & Reviews APIs

## Summary
Implemented course enrollment system and reviews API for the learning platform. Users can now enroll in courses, track their progress, and leave reviews.

## Changes Made

### New Models

#### Enrollment.js
```javascript
const lessonProgressSchema = {
    lessonId: String,
    moduleId: String,
    completed: Boolean (default: false),
    completedAt: Date,
    watchedDuration: Number (default: 0),  // seconds
    lastPosition: Number (default: 0)       // last video position
};

const enrollmentSchema = {
    user: ObjectId (ref: User),
    course: ObjectId (ref: Course),
    enrolledAt: Date,
    completedAt: Date,
    status: enum ['active', 'completed', 'cancelled'],
    progress: Number (0-100),
    completedLessons: [lessonProgressSchema],
    currentLesson: { moduleId, lessonId },
    lastAccessedAt: Date
};
```

#### Review.js
```javascript
const reviewSchema = {
    user: ObjectId (ref: User),
    course: ObjectId (ref: Course),
    rating: Number (1-5, required),
    comment: String (required, max 2000),
    isVerifiedPurchase: Boolean,
    helpful: {
        count: Number,
        users: [ObjectId]
    },
    reply: {
        content: String,
        repliedAt: Date,
        repliedBy: ObjectId (ref: User)
    },
    status: enum ['approved', 'pending', 'rejected']
};
// Unique index on [user, course]
```

### Updated Models

#### Course.js - Lesson Schema Updates
Added to lessonSchema:
```javascript
videoUrl: { type: String, default: '' },
documents: [{
    name: String (required),
    url: String (required),
    type: String (default: 'pdf'),
    size: Number (default: 0)
}]
```

### New Routes

#### enrollments.js
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | /my-courses | Yes | Get user's enrolled courses with course details |
| GET | /check/:courseId | Yes | Check if user is enrolled |
| POST | /:courseId | Yes | Enroll in a course |
| GET | /:courseId/progress | Yes | Get detailed enrollment progress |
| PUT | /:courseId/progress | Yes | Update lesson progress |
| DELETE | /:courseId | Yes | Unenroll from course |

#### reviews.js
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | /course/:courseId | No | Get reviews with rating distribution |
| GET | /my-review/:courseId | Yes | Get user's review for a course |
| POST | /:courseId | Yes | Create a review |
| PUT | /:reviewId | Yes | Update own review |
| DELETE | /:reviewId | Yes | Delete review (owner or admin) |
| POST | /:reviewId/helpful | Yes | Toggle helpful mark |
| POST | /:reviewId/reply | Admin | Admin reply to review |

### Server Updates

#### index.js
- Added `import enrollmentRoutes from './routes/enrollments.js'`
- Added `import reviewRoutes from './routes/reviews.js'`
- Registered routes: `/api/enrollments` and `/api/reviews`

## Bug Fixes

### Rating Distribution Aggregation
Fixed MongoDB aggregation not returning correct counts:

**Before (broken):**
```javascript
const ratingDistribution = await Review.aggregate([
    { $match: { course: require('mongoose').Types.ObjectId.createFromHexString(req.params.courseId), status: 'approved' } },
    ...
]);
```

**After (fixed):**
```javascript
import mongoose from 'mongoose';
// ...
const courseObjectId = new mongoose.Types.ObjectId(req.params.courseId);
const ratingDistribution = await Review.aggregate([
    { $match: { course: courseObjectId, status: 'approved' } },
    ...
]);
```

## API Response Examples

### GET /api/enrollments/my-courses
```json
[
    {
        "_id": "...",
        "course": {
            "_id": "...",
            "title": { "vi": "...", "en": "..." },
            "thumbnail": "...",
            "duration": 10,
            "modules": [...]
        },
        "progress": 45,
        "status": "active",
        "lastAccessedAt": "2026-01-24T..."
    }
]
```

### GET /api/reviews/course/:courseId
```json
{
    "success": true,
    "data": [...reviews],
    "ratingDistribution": {
        "1": 0,
        "2": 1,
        "3": 5,
        "4": 12,
        "5": 25
    },
    "pagination": {
        "total": 43,
        "page": 1,
        "limit": 10,
        "pages": 5
    }
}
```

## Files Changed
1. `server/models/Course.js` - Added videoUrl, documents to lesson schema
2. `server/models/Enrollment.js` - New file
3. `server/models/Review.js` - New file
4. `server/routes/enrollments.js` - New file
5. `server/routes/reviews.js` - New file
6. `server/index.js` - Registered new routes
