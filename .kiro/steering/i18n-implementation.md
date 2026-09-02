---
inclusion: manual
name: i18n-implementation
description: i18n architecture and implementation strategy for StellarCred
---

# i18n Implementation Strategy for StellarCred

## Architecture Decision: next-intl

### Why next-intl over react-i18next?

**next-intl** is chosen because:
1. **Native Next.js 14 app router support** - Seamless integration with app router, middleware, and server components
2. **Type-safe** - Full TypeScript support with IDE autocomplete for translation keys
3. **Smaller bundle** - ~8KB vs react-i18next's ~15KB
4. **Dynamic localization** - Built-in support for number, date, time formatting per locale
5. **Middleware integration** - Automatic locale detection and URL handling
6. **Server-side rendering** - Works perfectly with Next.js 14 SSR without extra configuration
7. **No runtime dependency on i18next** - Cleaner dependency tree
8. **Active maintenance** - Well-maintained by the Next.js community

### Implementation Approach

#### 1. **Locale Structure**
```
frontend/public/locales/
├── en.json          # English (source language)
└── es.json          # Spanish (proof of i18n)
```

#### 2. **URL Strategy**
- Default locale: `/` → English
- Explicit locale paths: `/es/*` → Spanish
- Middleware handles locale detection from URL and preferences
- URL format: `/[locale]/page` or `/page` (default to en)

#### 3. **Configuration Files**
```
frontend/
├── i18n.config.ts          # i18n configuration (locales, defaults)
├── i18n/
│   └── request.ts          # Server-side i18n hook
├── public/locales/
│   ├── en.json
│   └── es.json
└── middleware.ts           # Updated for locale routing
```

#### 4. **Component Integration**

**Server Components:**
```typescript
import { useTranslations } from 'next-intl';

export default function Page() {
  const t = useTranslations();
  return <h1>{t('home.title')}</h1>;
}
```

**Client Components:**
```typescript
'use client';

import { useTranslations } from 'next-intl';

export function LanguageSwitcher() {
  const t = useTranslations();
  return <button>{t('common.selectLanguage')}</button>;
}
```

#### 5. **String Organization in JSON**

Organize translations hierarchically by feature/component:

```json
{
  "common": {
    "selectLanguage": "Select Language",
    "close": "Close",
    "loading": "Loading..."
  },
  "nav": {
    "home": "Home",
    "wallet": "Wallet",
    "verify": "Verify",
    "issuer": "Issuer",
    "apps": "Apps",
    "docs": "Docs",
    "developers": "Developers"
  },
  "home": {
    "hero.title": "Prove anything. Reveal nothing.",
    "hero.subtitle": "Zero-knowledge credentials on Stellar...",
    "hero.cta.demo": "See the demo",
    "hero.cta.credential": "Get a credential"
  },
  "errors": {
    "wrongNetwork": "Wrong network detected. Switch your wallet to {network}.",
    "missingEnvVars": "Missing environment variables: {vars}"
  },
  "formats": {
    "dateTime": {
      "short": "MMM d, yyyy",
      "long": "EEEE, MMMM d, yyyy"
    }
  }
}
```

#### 6. **Number & Date Formatting**

Create a formatting utility that leverages native Intl APIs per locale:

```typescript
// lib/i18n/format.ts
export function formatDate(date: Date, locale: string, format: 'short' | 'long') {
  const formatter = new Intl.DateTimeFormat(locale, {...options});
  return formatter.format(date);
}

export function formatNumber(num: number, locale: string, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(locale, options).format(num);
}

export function formatCurrency(num: number, locale: string, currency: string) {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(num);
}
```

#### 7. **Language Switcher**

Create a dropdown that:
- Shows current language
- Allows switching between en/es
- Persists choice to localStorage + cookie
- Updates URL pathname to switch locale
- Maintains current page path (e.g., `/holder` → `/es/holder`)

#### 8. **Middleware Changes**

Update Next.js middleware to:
- Detect locale from URL pathname
- Check localStorage/cookie for user preference
- Handle language switching redirects
- Add `Accept-Language` header support as fallback

#### 9. **Root Layout & Page Structure**

```
frontend/app/
├── [locale]/
│   ├── page.tsx              # Homepage
│   ├── holder/page.tsx
│   ├── verify/page.tsx
│   ├── apps/page.tsx
│   ├── developers/page.tsx
│   ├── docs/page.tsx
│   └── layout.tsx            # Locale layout wrapper
├── layout.tsx                # Root layout (providers, fonts)
└── ...existing routes...
```

Alternative: Keep flat structure with `usePathname()` hook to extract locale dynamically.

#### 10. **String Extraction Process**

1. **Identify all hardcoded strings** in components and pages
2. **Create translation keys** following naming convention: `section.subsection.key`
3. **Extract to JSON files** with English as source
4. **Translate to Spanish** (using native speaker or professional service)
5. **Replace strings in code** with `t()` function calls

#### 11. **Documentation for Adding New Locales**

Create `LOCALIZATION.md` in frontend/ with:
- Steps to add new locale (e.g., French)
- How to copy/modify JSON files
- String key naming conventions
- Testing checklist for completeness
- Tools for checking translation coverage

#### 12. **Accessibility & SEO**

- Set `lang` attribute on `<html>` element per route
- Use `hreflang` meta tags for SEO (optional but recommended)
- Ensure ARIA labels are translated
- Test language switcher keyboard navigation
- Verify screen reader announces language changes

---

## Implementation Steps

### Phase 1: Setup (Tasks 1-3)
- Install next-intl dependency
- Create i18n configuration
- Set up middleware for locale routing
- Create translation JSON structure with all strings

### Phase 2: Components (Tasks 4-6)
- Create language switcher component
- Update root layout with locale provider
- Add formatting utilities for numbers/dates
- Update existing components to use `t()`

### Phase 3: Testing & Documentation (Tasks 7-9)
- Verify language switching works across all pages
- Test date/number formatting per locale
- Create localization documentation
- Accessibility audit
- SEO meta tags

---

## Dependencies to Add

```json
{
  "next-intl": "^3.16.0"
}
```

---

## Migration Path

1. **Non-breaking** - Add i18n alongside existing code
2. **Gradual adoption** - Convert components incrementally
3. **Fallback** - English JSON as source of truth during transition
4. **Rollback-safe** - Minimal middleware changes, can disable with feature flag
