# Instructions for Claude Code

## CORE PRINCIPLE
Read PROJECT_SUMMARY.md FIRST, not the entire codebase.
Update documentation AFTER every change.

## MULTILINGUAL REQUIREMENT (IMPORTANT)
All user-facing text must support both Vietnamese (vi) and English (en):
- API response messages should be in Vietnamese by default
- Error messages should be clear and user-friendly in Vietnamese
- Consider adding language header support for future i18n
- Frontend handles translations via i18n context

---

## BEFORE ANY TASK

### 1. Read (in order):
```
.claude/PROJECT_SUMMARY.md     → Project state, architecture, active features
.claude/CONVENTIONS.md         → Coding patterns and styles
Specific files user mentioned  → Only if needed for implementation
```

### 2. DON'T Read:
- Entire `src/` folder
- All components to "understand project"
- Files already summarized in PROJECT_SUMMARY.md

---

## AFTER ANY TASK

### 1. Update PROJECT_SUMMARY.md

**Always update:**
- Top: `Last Updated` timestamp
- Section 4: Feature status
- Section 5: Mark completed TODOs, add new ones
- Section 7: Add to recent changes (keep last 3 only)

**Update if changed:**
- Section 2: New files or dependencies

### 2. Create History File

**Filename:** `.claude/history/YYYY-MM-DD_HH-MM.md`

Use template from `.claude/templates/change-log-template.md`

---

## ALPHA STUDIO BACKEND SPECIFIC RULES

### API Response Format
- Always return consistent JSON: `{ success: boolean, message: string, data?: any }`
- Error messages should be in Vietnamese (primary language)
- Use try/catch for all async operations

### API Response Messages (Multilingual)
When writing API responses, always provide user-friendly messages:
```javascript
// Good - Vietnamese message
res.status(400).json({ success: false, message: 'Số credits không hợp lệ' });

// Good - Clear error
res.status(404).json({ success: false, message: 'Không tìm thấy giao dịch' });
```

### Database
- Use Mongoose for all database operations
- Always add appropriate indexes for frequently queried fields
- Use `populate()` for referenced documents

### Authentication
- Use `authMiddleware` for protected routes
- Use `adminOnly` middleware for admin-only routes
- JWT token in Authorization header or httpOnly cookie

### Error Handling
- Catch Mongoose validation errors
- Handle duplicate key errors (code 11000)
- Log errors to console with context

---

## READING PRIORITY
```
1. ALWAYS → PROJECT_SUMMARY.md + CONVENTIONS.md 
2. IF NEEDED → Files mentioned in user request
3. RARELY → Other source files
```

---

## SPECIAL CASES

**"Review entire project"** → Exception: read all files, create/update full summary

**Summary outdated?** → Ask user before proceeding

**Major refactor** → Update Section 2 (Architecture) completely

**New feature** → Update Section 4 with new row, status

**Bug fix** → Add to history, update Section 5 if related TODO

---

## FILE STRUCTURE REMINDER
```
.claude/
├── PROJECT_SUMMARY.md    # Main project state
├── CONVENTIONS.md        # Coding patterns
├── INSTRUCTIONS_FOR_CLAUDE.md  # This file
├── history/              # Change logs
│   └── YYYY-MM-DD_HH-MM.md
└── templates/
    └── change-log-template.md
```
