// Display formatting. Per the design system: wallet addresses are always
// truncated (first 4 + last 4), proof hashes (first 6 + last 4). Full values
// are only exposed on copy, never in a label.

export function truncateAddress(addr: string): string {
  if (!addr || addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export function truncateHash(hash: string): string {
  if (!hash) return hash;
  const h = hash.startsWith("0x") ? hash.slice(2) : hash;
  return `0x${h.slice(0, 6)}…${h.slice(-4)}`;
}

export function truncatePubkey(hex: string): string {
  if (!hex || hex.length <= 16) return hex;
  return `${hex.slice(0, 8)}…${hex.slice(-8)}`;
}

// ── Locale-aware formatting ──────────────────────────────────────────────────

/**
 * Format a number according to the current locale.
 * Uses Intl.NumberFormat for locale-aware thousands separators and decimal marks.
 */
export function formatNumber(
  value: number,
  locale: string = "en",
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

/**
 * Format a currency amount according to the current locale.
 * Uses USD by default; override with options.currency.
 */
export function formatCurrency(
  value: number,
  locale: string = "en",
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    ...options,
  }).format(value);
}

/**
 * Format a date according to the current locale.
 * Defaults to short date format (e.g. "Jan 15, 2024" in en, "15 ene 2024" in es).
 */
export function formatDate(
  date: Date | number,
  locale: string = "en",
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = typeof date === "number" ? new Date(date * 1000) : date;
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...options,
  }).format(d);
}

/**
 * Format a relative time (e.g. "3 days", "2 hours") according to the current locale.
 */
export function formatRelativeTime(
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
  locale: string = "en",
): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  return rtf.format(value, unit);
}

/**
 * Format a file/byte size according to the current locale.
 */
export function formatBytes(
  bytes: number,
  locale: string = "en",
  decimals: number = 1,
): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = parseFloat((bytes / Math.pow(k, i)).toFixed(decimals));
  return `${formatNumber(value, locale)} ${sizes[i]}`;
}

/**
 * Format a percentage according to the current locale.
 */
export function formatPercent(
  value: number,
  locale: string = "en",
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
    ...options,
  }).format(value / 100);
}
