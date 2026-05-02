import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Micah Voice",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU">
      <body>{children}</body>
    </html>
  );
}
