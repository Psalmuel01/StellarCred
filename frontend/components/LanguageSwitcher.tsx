"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter, usePathname } from "@/i18n/routing";
import { locales, type Locale } from "@/i18n/routing";
import { IconLanguage } from "@tabler/icons-react";

const LANGUAGE_LABELS: Record<Locale, { en: string; es: string }> = {
  en: { en: "English", es: "Inglés" },
  es: { en: "Spanish", es: "Español" },
};

export function LanguageSwitcher() {
  const t = useTranslations("languageSwitcher");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  function onSelectChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const nextLocale = event.target.value as Locale;
    router.replace(pathname, { locale: nextLocale });
  }

  return (
    <div
      className="row"
      style={{ gap: "0.35rem", alignItems: "center" }}
    >
      <IconLanguage size={14} stroke={1.8} color="var(--faint)" />
      <select
        aria-label={t("label")}
        value={locale}
        onChange={onSelectChange}
        style={{
          padding: "0.25rem 0.5rem",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border)",
          background: "var(--bg-raised)",
          color: "var(--text)",
          fontSize: "0.75rem",
          cursor: "pointer",
          outline: "none",
          lineHeight: 1.4,
        }}
      >
        {locales.map((loc) => (
          <option key={loc} value={loc}>
            {LANGUAGE_LABELS[loc][locale as Locale]}
          </option>
        ))}
      </select>
    </div>
  );
}
