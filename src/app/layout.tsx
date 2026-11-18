import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Retrix | Retail Data Governance",
  description: "A multi-tenant retail data governance and management platform.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
