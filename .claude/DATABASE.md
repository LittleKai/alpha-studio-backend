# Database Documentation - Alpha Studio

**Database:** MongoDB Atlas  
**Cluster:** Cluster0.c1mdcyv.mongodb.net  
**Database Name:** `alpha-studio`

---

## 📊 Connection Info

```env
MONGODB_URI=mongodb+srv://aduc5525:<password>@cluster0.c1mdcyv.mongodb.net/alpha-studio?retryWrites=true&w=majority&appName=Cluster0
```

---

## 🗂️ Collections (8 total)

| Collection | Purpose | Key Fields |
|------------|---------|------------|
| **users** | User accounts | email, password, role, subscription |
| **courses** | Course catalog | title (multilang), category, modules |
| **students** | Student profiles | userId, studentId, enrolledCourses, gpa |
| **partners** | Partner orgs | userId, companyName, opportunities |
| **projects** | Project management | userId, title, status, tasks |
| **studio_sessions** | AI editing sessions | userId, sessionId, originalImage |
| **transformations** | Image edits history | sessionId, type, prompt, outputImage |
| **api_usage** | API tracking | userId, endpoint, usage, billingPeriod |

---

## 🔧 Database Commands

```bash
# Test connection
npm run db:test

# Initialize database (create collections + indexes + sample data)
npm run db:init

```

---

## 👤 Sample Users

**Admin:**
- Email: `admin@alphastudio.com`
- Password: `admin123456`
- Role: admin
- Quota: 10,000 calls/month

**Student:**
- Email: `student@example.com`
- Password: `student123`
- Role: student
- Quota: 100 calls/month

---

## 📋 Quick Queries

```javascript
// Find user by email
db.users.findOne({ email: "admin@alphastudio.com" })

// Get user's studio sessions
db.studio_sessions.find({ userId: ObjectId("...") }).sort({ createdAt: -1 })

// Monthly API usage
db.api_usage.find({ userId: ObjectId("..."), billingPeriod: "2025-01" })
```

---

## 🔐 Security Notes

**Current Status:**
- ❌ Passwords in plain text (TODO: bcrypt)
- ❌ No JWT auth yet
- ✅ MongoDB uses SSL/TLS
- ✅ Database authentication enabled

**Next Steps:**
1. Hash passwords with bcrypt
2. Implement JWT authentication
3. Add input validation
4. Create backend API routes

---

**Last Updated:** 2025-01-17