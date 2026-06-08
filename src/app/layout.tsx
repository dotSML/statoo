import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import './globals.css';

const geist = Geist({
  variable: '--font-geist',
  subsets: ['latin'],
});

const pageTitle = process.env.PAGE_TITLE || 'Status';
const pageDescription = process.env.PAGE_DESCRIPTION || 'Current service status and uptime';

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  robots: 'index, follow',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={geist.variable}>
      <body>{children}</body>
    </html>
  );
}
