import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./account.css";
import "./chats.css";
import "./social-navigation.css";
import "./groups.css";
import "./production.css";
import "./refinements.css";
import { InstallAppProvider } from "../components/install-app";
import { AppearanceProvider } from "../components/appearance";

export const metadata: Metadata = {
  title: "Merkat — Talk. Plan. Meet.",
  description:
    "Conversations, shared plans and good company. Talk. Plan. Meet.",
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
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var p=JSON.parse(localStorage.getItem('merkat.appearance.v1')||'{}');var d=p.theme==='DARK'||((p.theme!=='LIGHT')&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';document.documentElement.dataset.reduceMotion=String(p.reduceMotion===true);document.documentElement.dataset.largeText=String(p.largeText===true)}catch(e){}})()`,
          }}
        />
      </head>
      <body>
        <AppearanceProvider>
          <InstallAppProvider>{children}</InstallAppProvider>
        </AppearanceProvider>
      </body>
    </html>
  );
}
