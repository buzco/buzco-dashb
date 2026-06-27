import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en" className="h-full antialiased">
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
