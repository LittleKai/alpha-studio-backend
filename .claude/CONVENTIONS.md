# Project Conventions

This document outlines the coding conventions and patterns used in Alpha Studio.

---

## File Naming

### Components
- **PascalCase** for component files: `StudioTool.tsx`, `ImageEditorCanvas.tsx`
- **Folder structure by feature**: `components/studio/`, `components/upload/`

### Other Files
- **camelCase** for utilities and services: `geminiService.ts`, `fileUtils.ts`
- **lowercase** for i18n files: `en.ts`, `vi.ts`, `zh.ts`
- **camelCase** for types and constants: `types.ts`, `constants.ts`

### Folders
- **lowercase** folder names: `components/`, `services/`, `utils/`, `i18n/`, `theme/`
- **Feature-based organization**: `components/studio/`, `components/dashboard/`

---

## Component Structure

### Functional Components Pattern
```tsx
import React, { useState, useCallback } from 'react';
import { useTranslation } from '../../i18n/context';

interface ComponentNameProps {
  propName: string;
  onAction: () => void;
}

export default function ComponentName({ propName, onAction }: ComponentNameProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<Type>(initialValue);

  const handleAction = useCallback(() => {
    // handler logic
  }, [dependencies]);

  return (
    <div className="...">
      {/* JSX */}
    </div>
  );
}
```

### Component Organization
1. Imports (React, hooks, components, types, utils)
2. Interface definitions (Props)
3. Component function with hooks at top
4. Event handlers (useCallback)
5. Return JSX

---

## Code Style

### TypeScript
- **Strict mode enabled**: All types must be explicit
- **Interface over Type**: Prefer `interface` for object shapes
- **Explicit return types**: Optional but recommended for complex functions
- **No unused variables**: `noUnusedLocals` and `noUnusedParameters` enabled

### Imports
```tsx
// 1. React and core libraries
import React, { useState, useCallback, useEffect } from 'react';

// 2. Third-party libraries
import { GoogleGenAI } from "@google/genai";

// 3. Internal services/utils
import { editImage } from '../../services/geminiService';
import { downloadImage } from '../../utils/fileUtils';

// 4. Components
import TransformationSelector from './TransformationSelector';
import ResultDisplay from './ResultDisplay';

// 5. Hooks/Contexts
import { useTranslation } from '../../i18n/context';
import { useTheme } from '../../theme/context';

// 6. Types
import type { GeneratedContent, Transformation } from '../../types';
```

### Path Aliases
- Use `@/` for absolute imports from `src/`
- Example: `import { useTranslation } from '@/i18n/context';`

---

## CSS/Styling Conventions

### CSS Custom Properties (Required)
Always use CSS variables for colors, spacing, etc:
```css
/* Colors */
var(--bg-primary)      /* Main background */
var(--bg-secondary)    /* Secondary background */
var(--bg-tertiary)     /* Tertiary background */
var(--bg-card)         /* Card background */
var(--bg-card-alpha)   /* Transparent card */

var(--text-primary)    /* Main text */
var(--text-secondary)  /* Secondary text */
var(--text-tertiary)   /* Muted text */
var(--text-on-accent)  /* Text on accent color */

var(--accent-primary)  /* Primary accent */
var(--accent-secondary)/* Secondary accent */
var(--accent-shadow)   /* Accent shadow */

var(--border-primary)  /* Main border */
var(--border-secondary)/* Secondary border */
```

### Class Naming
- **Utility-first inline**: Combine utilities in className
- **Custom classes**: For complex/reused patterns

### Common Patterns
```tsx
// Glass card effect
className="glass-card rounded-2xl p-6"

// Gradient background
className="bg-gradient-to-br from-[var(--accent-primary)] to-[var(--accent-secondary)]"

// Hover states
className="hover:bg-[var(--bg-secondary)] transition-colors"

// Text gradient
className="text-gradient"  // Defined in index.css
```

### Animation Classes
```css
.animate-fade-in    /* Fade in animation */
.animate-slide-up   /* Slide up animation */
.animate-scale-in   /* Scale in animation */
.animate-pulse      /* Pulse animation */
```

---

## i18n Conventions

### Translation Keys
- **Dot notation**: `section.subsection.key`
- **Hierarchical structure**: Match component hierarchy
- **Examples**:
  ```ts
  t('landing.hero.title1')
  t('studio.generate')
  t('transformations.effects.storyboard.title')
  ```

### Adding New Translations
1. Add to `vi.ts` first (primary language)
2. Add to `en.ts` and `zh.ts`
3. Use same key structure across all files

### Translation File Structure
```ts
export default {
  sectionName: {
    subsection: {
      key: "Translated text"
    }
  }
};
```

---

## State Management

### Context Pattern
```tsx
// Creating a context
const MyContext = createContext<MyContextType | undefined>(undefined);

export const MyProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, setState] = useState<Type>(initialValue);

  // Persist to localStorage if needed
  useEffect(() => {
    localStorage.setItem('key', state);
  }, [state]);

  return (
    <MyContext.Provider value={{ state, setState }}>
      {children}
    </MyContext.Provider>
  );
};

// Custom hook for consuming
export const useMyContext = (): MyContextType => {
  const context = useContext(MyContext);
  if (!context) {
    throw new Error('useMyContext must be used within MyProvider');
  }
  return context;
};
```

### Local State
- Use `useState` for component-local state
- Use `useCallback` for event handlers to prevent re-renders
- Destructure state updates: `const [value, setValue] = useState()`

---

## Type Definitions

### Interface Naming
- **PascalCase** with descriptive names
- **Props suffix** for component props: `ComponentNameProps`
- **Data suffix** for data types: `CourseData`, `UserProfile`

### Common Patterns
```ts
// Component props
interface ComponentNameProps {
  required: string;
  optional?: number;
  callback: (value: string) => void;
}

// Data types
interface EntityData {
  id: string;
  name: string;
  // ... other fields
}

// Enums/Union types
type Status = 'pending' | 'approved' | 'rejected';
type DepartmentType = 'all' | 'event_planner' | 'creative' | 'operation';
```

---

## API/Service Patterns

### Service Structure
```ts
// services/serviceName.ts

// Configuration
const config = { /* ... */ };

// Error handler
const handleApiError = (error: unknown): Promise<any> => {
  console.error("Error:", error);
  // ... error handling
  return Promise.reject(new Error(message));
};

// Main function
export async function apiFunction(params: ParamType): Promise<ReturnType> {
  try {
    // ... API logic
    return result;
  } catch (error) {
    return handleApiError(error);
  }
}
```

---

## Best Practices

### DO
- Use CSS Custom Properties for all colors
- Add translations to all 3 language files
- Use `useCallback` for event handlers
- Use `useTranslation()` for user-facing text
- Keep components focused and under 500 lines
- Use TypeScript interfaces for props

### DON'T
- Don't hardcode colors - use CSS variables
- Don't add text without translations
- Don't use inline styles (except for dynamic values)
- Don't create unnecessary abstractions
- Don't mix different state management patterns

---

## Git Conventions

### Commit Messages
- Use descriptive messages
- Format: `action: description`
- Examples:
  - `fix: vercel deploy`
  - `update: ui improvements`
  - `add: new transformation feature`

### Branch Strategy
- `main` - Production branch
- Feature branches for new work
