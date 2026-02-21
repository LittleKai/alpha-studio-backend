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

## 🗂️ Collections (10 total)

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
| **hostmachines** | Cloud host machines | name, machineId, agentUrl, secret, status, specs |
| **cloudsessions** | Cloud desktop sessions | userId, hostMachineId, containerId, noVncUrl, status |

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

---

## 📝 Article Schema (articles collection)

```javascript
{
  title: { vi: String (required), en: String (required) },
  slug: String (unique, auto-generated from title.vi),
  excerpt: { vi: String, en: String },
  content: { vi: String, en: String },
  thumbnail: String,
  category: enum ['about', 'services'] (required),
  status: enum ['draft', 'published', 'archived'] (default: 'draft'),
  author: ObjectId (ref: User),
  order: Number (default: 0),
  isFeatured: Boolean (default: false),
  tags: [String],
  createdAt: Date,
  updatedAt: Date
}

// Indexes:
// - { category: 1, status: 1, order: 1 }
// - { slug: 1 } (unique)
// - Text index: title.vi, title.en, content.vi, content.en, tags
```

### 9. HostMachine Collection (hostmachines)
```javascript
{
  name: String (required),
  machineId: String (required, unique),
  agentUrl: String (required),
  secret: String (required),
  status: enum ['available', 'busy', 'offline'] (default: 'offline'),
  specs: {
    cpu: String,
    ram: String,
    gpu: String
  },
  maxContainers: Number (default: 5),
  currentContainers: Number (default: 0),
  lastPingAt: Date,
  enabled: Boolean (default: true),
  createdAt: Date,
  updatedAt: Date
}

// Indexes:
// - { status: 1, enabled: 1 }
// - { machineId: 1 } (unique)
```

### 10. CloudSession Collection (cloudsessions)
```javascript
{
  userId: ObjectId (ref: User, required),
  hostMachineId: ObjectId (ref: HostMachine, required),
  containerId: String (required),
  noVncUrl: String (required),
  status: enum ['active', 'ended'] (default: 'active'),
  startedAt: Date,
  endedAt: Date,
  endReason: enum ['user_disconnect', 'admin_force', 'machine_offline', 'error', null],
  createdAt: Date,
  updatedAt: Date
}

// Indexes:
// - { userId: 1, status: 1 }
// - { hostMachineId: 1, status: 1 }
// - { status: 1, startedAt: 1 }
```

**Last Updated:** 2026-02-18