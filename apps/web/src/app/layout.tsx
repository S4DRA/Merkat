import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./account.css";
import "./chats.css";
import "./social-navigation.css";
import "./groups.css";
import { InstallAppProvider } from "../components/install-app";

export const metadata: Metadata = {
  title: "Merkat — Talk. Plan. Meet.",
  description: "A social space for real life. Merkat foundation preview.",
  applicationName: "Merkat",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icons/merkat-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [
      { url: "/icons/merkat-180.png", sizes: "180x180", type: "image/png" },
    ],
  },
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Merkat", statusBarStyle: "default" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F55105",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <InstallAppProvider>{children}</InstallAppProvider>
      </body>
    </html>
  );
}
