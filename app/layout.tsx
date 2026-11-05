import type { Metadata } from "next";
import {
  Hanken_Grotesk,
  Newsreader,
  Noto_Sans_Devanagari,
  Noto_Sans_Gujarati,
  Noto_Serif_Devanagari,
  Noto_Serif_Gujarati,
} from "next/font/google";
import type { ReactNode } from "react";
import { getLanguage } from "@/lib/language";
import "./globals.css";

const newsreader = Newsreader({ subsets: ["latin"], variable: "--font-newsreader" });
const hanken = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-hanken" });
// Only downloaded when Hindi or Gujarati text is on screen, so English pages stay light.
const hindiSans = Noto_Sans_Devanagari({ subsets: ["devanagari"], variable: "--font-hi-sans", preload: false });
const hindiSerif = Noto_Serif_Devanagari({ subsets: ["devanagari"], variable: "--font-hi-serif", preload: false });
const gujaratiSans = Noto_Sans_Gujarati({ subsets: ["gujarati"], variable: "--font-gu-sans", preload: false });
const gujaratiSerif = Noto_Serif_Gujarati({ subsets: ["gujarati"], variable: "--font-gu-serif", preload: false });

export const metadata: Metadata = {
  title: "Company A Homes",
  description: "Ask about our homes in Ahmedabad and book a site visit.",
};

/** The buyer's language for the whole page. Staff screens are English, and say so on their own wrapper. */
export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={await getLanguage()} className={`${newsreader.variable} ${hanken.variable} ${hindiSans.variable} ${hindiSerif.variable} ${gujaratiSans.variable} ${gujaratiSerif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
