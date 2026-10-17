import type { Metadata } from "next";
import { requireAuthenticatedUser } from "@/app/auth";
import { getEntitlementForUser } from "@/db/product";
import { FixAccessGate } from "./fix-access-gate";
import { FixCenterExperience } from "./fix-center-experience";

export const dynamic = "force-dynamic";
export const runtime = "edge";
export const metadata: Metadata = { title: "Private fix catalog", robots: { index: false, follow: false } };

export default async function FixCenterPage(){
  const user = await requireAuthenticatedUser();
  const entitlement = await getEntitlementForUser(user);
  if (!entitlement.canUseFixCredits) return <FixAccessGate />;
  return <FixCenterExperience/>;
}
