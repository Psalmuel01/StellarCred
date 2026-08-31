# Adding a New Locale to StellarCred

This guide explains how to add a new language translation to the StellarCred frontend.

## Architecture Overview

StellarCred uses [next-intl](https://next-intl.dev) for internationalization with Next.js App Router. The i18n setup includes:

- **Locale-based routing**: URLs are prefixed with the locale (e.g., `/en/verify`, `/es/verify`)
- **Message catalogs**: JSON files in `messages/` contain all translatable strings
- **Language switcher**: Users can switch languages via a dropdown in the navigation bar
- **Locale-aware formatting**: Numbers, dates, and currencies are formatted per locale

## Supported Locales

| Locale Code | Language | Message File |
|-------------|----------|--------------|
| `en`        | English  | `messages/en.json` |
| `es`        | Spanish  | `messages/es.json` |

The default locale is `en` (English). When a user visits `/`, they are redirected to `/en/`.

## Steps to Add a New Locale

### 1. Add the locale to the routing configuration

Edit `frontend/i18n/routing.ts` and add your new locale code:

```ts
export const locales = ["en", "es", "fr"] as const;  // Add "fr" for French
```

### 2. Create the message catalog

Copy the English catalog as a starting point:

```bash
cp messages/en.json messages/fr.json
```

Then translate all string values in the new file. The catalog is organized by namespace:

- `common` — shared UI text (buttons, labels, copyright)
- `nav` — navigation menu
- `landing` — homepage
- `holder` — wallet/credentials page
- `verify` — credential issuance page
- `issuer` — issuer admin page
- `apps` — demo protocols page
- `developers` — developer documentation page
- `docs` — in-app documentation
- `badge` — verification badge
- `notFound` — 404 page
- `errorPage` — error boundary
- `networkBanner` — network mismatch warning
- `configBanner` — configuration warning
- `format` — formatting templates
- `languageSwitcher` — language selector labels

### 3. Update the LanguageSwitcher labels

In `messages/fr.json`, ensure the `languageSwitcher` section includes the native name:

```json
{
  "languageSwitcher": {
    "label": "Langue",
    "en": "Anglais",
    "es": "Espagnol",
    "fr": "Français"
  }
}
```

### 4. Verify

Run the typecheck to ensure everything compiles:

```bash
cd frontend && npx tsc -b --noEmit
```

Then start the dev server and verify:
- The locale switcher shows your new language
- Switching to the new locale updates all visible text
- URLs are correctly prefixed (e.g., `/fr/verify`)
- Numbers and dates are formatted correctly for the locale

## How Translations Work

### In Client Components

Use the `useTranslations` hook:

```tsx
"use client";
import { useTranslations } from "next-intl";

export function MyComponent() {
  const t = useTranslations("landing");
  return <h1>{t("heroTitle1")}</h1>;
}
```

### In Server Components

Use `getTranslations` from `next-intl/server`:

```tsx
import { getTranslations } from "next-intl/server";

export default async function Page({ params }) {
  const t = await getTranslations({ locale: params.locale, namespace: "common" });
  return <h1>{t("appName")}</h1>;
}
```

### Interpolation

Use `{variable}` syntax in message values:

```json
{
  "holder": {
    "expiresIn": "expires in {days}d"
  }
}
```

```tsx
const t = useTranslations("holder");
<span>{t("expiresIn", { days: 7 })}</span>
```

### Plurals

Use `next-intl`'s ICU message format:

```json
{
  "holder": {
    "proofsExpired": "{count} proof {count, plural, one {has} other {have}} expired."
  }
}
```

## Locale-Aware Formatting

The project includes formatting helpers in `frontend/lib/format.ts`:

```tsx
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { useLocale } from "next-intl";

function PriceDisplay({ amount }: { amount: number }) {
  const locale = useLocale();
  return <span>{formatCurrency(amount, locale)}</span>;
  // en: "$50,000"   es: "$50.000"
}
```

Available formatters:
- `formatNumber(value, locale)` — locale-aware number formatting
- `formatCurrency(value, locale)` — currency formatting (USD)
- `formatDate(date, locale)` — locale-aware date formatting
- `formatRelativeTime(value, unit, locale)` — relative time (e.g., "3 days ago")
- `formatBytes(bytes, locale)` — file size formatting
- `formatPercent(value, locale)` — percentage formatting

## File Structure

```
frontend/
├── i18n/
│   ├── routing.ts          # Locale definitions and routing config
│   └── request.ts          # Server-side locale resolution
├── messages/
│   ├── en.json             # English translations
│   └── es.json             # Spanish translations
├── components/
│   ├── I18nProvider.tsx    # Client-side NextIntlClientProvider wrapper
│   └── LanguageSwitcher.tsx # Language dropdown component
├── lib/
│   └── format.ts           # Locale-aware formatting helpers
├── app/
│   ├── layout.tsx          # Root layout (pass-through)
│   └── [locale]/
│       ├── layout.tsx      # Locale-aware layout with I18nProvider
│       ├── page.tsx        # Homepage
│       ├── holder/         # Wallet page
│       ├── verify/         # Verification page
│       ├── issuer/         # Issuer page
│       ├── apps/           # Demo protocols page
│       ├── developers/     # Developer docs
│       ├── docs/           # In-app docs
│       └── badge/          # Verification badge
└── middleware.ts           # Locale detection + API route handling
```
