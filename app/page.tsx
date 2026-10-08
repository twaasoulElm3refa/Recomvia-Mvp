import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site-config";
import { ScanExperience } from "./scan-experience";

export const metadata: Metadata = { alternates: { canonical: SITE_URL } };

export default function Home() {
  return <ScanExperience />;
}

