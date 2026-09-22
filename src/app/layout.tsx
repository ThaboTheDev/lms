import type { Metadata } from 'next';
import './globals.css';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: { default: BRAND.shortName, template: `%s | ${BRAND.shortName}` },
  description: `Learning, records and administration for the ${BRAND.name}.`,
  icons: { icon: '/branding/msri-logo.png' },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-ZA">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
