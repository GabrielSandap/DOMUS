import "./globals.css";

export const metadata = {
  title: "DOMUS",
  description: "Controle local des ampoules Tapo",
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
