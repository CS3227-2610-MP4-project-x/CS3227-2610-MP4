import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Developer Workspace",
  description: "A task workspace for software project teams.",
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
