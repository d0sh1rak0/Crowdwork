import type { Metadata } from "next";
import {
  Bricolage_Grotesque,
  IBM_Plex_Mono,
  Instrument_Sans,
} from "next/font/google";
import { Toaster } from "sonner";
import { BeforeUnloadGuard } from "@/components/BeforeUnloadGuard";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

const instrument = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Crowdwork — Write the talk. Rehearse the stage.",
  description:
    "Turn a PDF deck into a spoken script and rehearse it with timing, voice tracking, and AI coaching.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${instrument.variable} ${plexMono.variable} h-full`}
    >
      <body className="min-h-full font-body antialiased">
        <BeforeUnloadGuard />
        {children}
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            className:
              "!bg-surface !text-text !border !border-border !font-body",
          }}
        />
      </body>
    </html>
  );
}
