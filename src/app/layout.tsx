import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "GESTION SCOLAIRE EPP", template: "%s · GESTION SCOLAIRE EPP" },
  description: "Gestion des écoles primaires : élèves, notes, résultats, absences et états officiels.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
