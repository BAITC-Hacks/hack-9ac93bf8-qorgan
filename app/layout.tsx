import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Подбор подрядчиков | Qorgan",
  description: "Подбор event-подрядчиков по условиям заказа",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
