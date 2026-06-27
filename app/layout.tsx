import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Google Sans Flex (self-hosted, optimized by next/font) — the brand's UI face.
const googleSans = localFont({
  src: [
    { path: "./fonts/GoogleSansFlex_120pt-Light.ttf", weight: "300", style: "normal" },
    { path: "./fonts/GoogleSansFlex_120pt-Regular.ttf", weight: "400", style: "normal" },
    { path: "./fonts/GoogleSansFlex_120pt-Medium.ttf", weight: "500", style: "normal" },
    { path: "./fonts/GoogleSansFlex_120pt-SemiBold.ttf", weight: "600", style: "normal" },
  ],
  variable: "--font-google-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Buzco Ops",
  description: "Internal ERP & inventory tool for Buzco — Gr8 Success.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${googleSans.variable} h-full antialiased`}>
      <head>
        <script
          // Apply saved theme before paint to avoid a flash. Default is dark
          // (no attribute); only light mode sets data-theme.
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('theme')==='light'){document.documentElement.setAttribute('data-theme','light')}}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
