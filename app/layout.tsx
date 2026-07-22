import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Planificación de Insumos",
  description: "ERP de planificación de insumos para el fraccionamiento de bodega.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
