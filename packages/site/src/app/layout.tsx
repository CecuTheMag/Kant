import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Inter } from "next/font/google";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { ScrollReveal } from "@/components/ScrollReveal";
import { TermsBanner } from "@/components/TermsBanner";
import { RELEASE, SITE } from "@/lib/config";
import "./globals.css";

// Apple devices render in the system SF font (listed first in the CSS stack),
// so Inter is only fetched on platforms that need it — no preload.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  preload: false,
});

const title = `${SITE.name} — Private, encrypted messaging with no one in the middle`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: title,
    template: `%s · ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: [
    "private messenger",
    "encrypted messaging app",
    "secure messaging",
    "end-to-end encrypted chat",
    "no phone number messenger",
    "peer-to-peer messenger",
    "serverless messenger",
    "Signal alternative",
    "WhatsApp alternative",
    "Telegram alternative",
    "self-hosted messaging",
  ],
  authors: [{ name: "The Kant Project", url: SITE.url }],
  creator: "The Kant Project",
  category: "technology",
  alternates: { canonical: "/" },
  openGraph: {
    title,
    description: SITE.description,
    url: SITE.url,
    siteName: SITE.name,
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description: SITE.description,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  icons: {
    icon: [{ url: "/favicon.png", type: "image/png" }],
    apple: [{ url: "/logo.png" }],
  },
  formatDetection: { telephone: false, email: false, address: false },
  appleWebApp: { title: SITE.name, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
  colorScheme: "light",
};

const structuredData = [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "The Kant Project",
    url: SITE.url,
    logo: `${SITE.url}/logo.png`,
    sameAs: [SITE.githubUrl, SITE.discordUrl],
  },
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE.name,
    url: SITE.url,
  },
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE.name,
    applicationCategory: "CommunicationApplication",
    operatingSystem: "Android, Linux",
    softwareVersion: RELEASE.version,
    description: SITE.description,
    url: SITE.url,
    downloadUrl: `${SITE.url}/download`,
    image: `${SITE.url}/logo.png`,
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    featureList: [
      "End-to-end encryption",
      "No phone number or email required",
      "Peer-to-peer delivery with no server-side message storage",
      "Encrypted group chats and file transfer",
      "Optional onion routing",
      "Self-hostable relay",
    ],
  },
];

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        <Nav />
        <main id="main">{children}</main>
        <Footer />
        <ScrollReveal />
        <TermsBanner />
        <Analytics />
      </body>
    </html>
  );
}
