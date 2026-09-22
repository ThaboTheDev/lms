import type { Metadata } from 'next';
import { IBM_Plex_Sans, IBM_Plex_Serif } from 'next/font/google';
import './globals.css';

const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
  display: 'swap',
});

const serif = IBM_Plex_Serif({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Institutional LMS', template: '%s | Institutional LMS' },
  description: 'Academic delivery, records and administration for higher learning.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-ZA" className={`${sans.variable} ${serif.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
