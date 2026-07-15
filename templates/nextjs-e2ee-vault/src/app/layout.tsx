import { Providers } from "./providers";

export const metadata = {
  title: "Tide E2EE Vault",
  description: "End-to-end encrypted vault powered by Tide",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "2rem", background: "#0a0a0a", color: "#ededed" }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
