// Root layout — the actual layout lives at app/[locale]/layout.tsx so that
// next-intl can inject locale-scoped messages via NextIntlClientProvider.
// This root layout simply passes children through unchanged.
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
