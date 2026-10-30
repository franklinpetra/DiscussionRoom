import type { Metadata } from "next";
import "./globals.css";

const DESCRIPTION =
  "A private workspace for independent AI perspectives, thoughtful discussion, and useful takeaways.";

export const metadata: Metadata = {
  // Link previews need absolute addresses; this is the site's live address.
  metadataBase: new URL("https://theroom.click"),
  title: "Discussion · ideas worth discussing",
  description: DESCRIPTION,
  // The preview picture itself comes from opengraph-image.jpg beside each page.
  openGraph: { type: "website", siteName: "Discussion", title: "Discussion", description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: "Discussion", description: DESCRIPTION },
  icons: {
    icon: [
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-48x48.png", sizes: "48x48", type: "image/png" },
      { url: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html data-scroll-behavior="smooth" lang="en">
      <body>{children}</body>
    </html>
  );
}
