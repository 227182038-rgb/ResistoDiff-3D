import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ResistoDiff-3D | AMR Mutational Escape Prediction Platform",
  description: "Multi-Scale Structural Physics & Geometric Deep Learning Framework for Predicting Antimicrobial Resistance Mutational Escape Trajectories and De Novo Counter-Inhibitor Design.",
  keywords: ["ResistoDiff", "AMR", "antimicrobial resistance", "EGNN", "SE(3)", "diffusion model", "protein engineering", "drug discovery"],
  authors: [{ name: "ResistoDiff-3D Research Team" }],
  openGraph: {
    title: "ResistoDiff-3D",
    description: "Predicting Antimicrobial Resistance Mutational Escape Trajectories",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
