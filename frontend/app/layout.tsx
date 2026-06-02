import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jinoe",
  description: "Sign in or create an account",
};

const themeInitScript = `
(function() {
  try {
    var stored = window.localStorage.getItem("jinoe-theme");
    var preference = stored === "dark" ? "dark" : "light";
    var root = document.documentElement;
    root.dataset.themePreference = preference;
    root.dataset.theme = preference;
    root.classList.toggle("dark", preference === "dark");
    root.style.colorScheme = preference;
  } catch (_) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full scroll-smooth">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
