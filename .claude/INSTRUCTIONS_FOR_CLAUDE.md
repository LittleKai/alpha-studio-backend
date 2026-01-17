# Instructions for Claude Code

## CORE PRINCIPLE
Read PROJECT_SUMMARY.md FIRST, not the entire codebase.
Update documentation AFTER every change.

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

## ALPHA STUDIO SPECIFIC RULES

### Styling
- ALWAYS use CSS Custom Properties (see CONVENTIONS.md)
- NEVER hardcode colors - use `var(--bg-primary)`, etc.
- Use `glass-card` class for card effects

### i18n
- Add translations to ALL 3 files: `en.ts`, `vi.ts`, `zh.ts`
- Use `t('section.key')` pattern
- Vietnamese is the primary language

### Components
- Keep under 500 lines
- Use `useTranslation()` for all user-facing text
- Use `useTheme()` for theme-aware components

### API
- All AI calls go through `geminiService.ts`
- Environment variable: `VITE_GEMINI_API_KEY`

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
