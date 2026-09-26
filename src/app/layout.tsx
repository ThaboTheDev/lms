import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: { default: BRAND.shortName, template: `%s | ${BRAND.shortName}` },
  description: `Learning, records and administration for the ${BRAND.name}.`,
  icons: { icon: '/branding/msri-logo.png' },
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading the request makes every page render per request, which is what
  // lets each response carry its own CSP nonce (set in src/middleware.ts).
  // A page prerendered at build time would ship inline scripts no nonce covers.
  await headers();

  return (
    <html lang="en-ZA">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
