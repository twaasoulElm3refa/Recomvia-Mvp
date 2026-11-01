import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site-config";
import { ScanExperience } from "./scan-experience";
import { isPayPalPaymentsEnabled } from "@/lib/paypal/availability";

export const metadata: Metadata = { alternates: { canonical: SITE_URL } };
export const dynamic = "force-dynamic";

export default function Home() {
  return <ScanExperience paymentsEnabled={isPayPalPaymentsEnabled()} />;
}

