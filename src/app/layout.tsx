import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const pageTitle = process.env.PAGE_TITLE || 'Status';
const pageDescription = process.env.PAGE_DESCRIPTION || 'Current service status and uptime';

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  robots: 'index, follow',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f6f7' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0c' },
  ],
};

// Resolves the theme before first paint: saved preference wins, then the
// system preference. Runs in <head> so there is no flash (see the Next.js
// "Preventing Flash" guide).
const themeInitScript = `(function(){try{var t=localStorage.getItem('statoo-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}document.documentElement.setAttribute('data-theme',t)}catch(e){}})()`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
