import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "AutoED CRM", description: "Admissions and parent-relationship platform for K-12 schools" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
