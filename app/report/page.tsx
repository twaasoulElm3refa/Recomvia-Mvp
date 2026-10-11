import type { Metadata } from "next";
import { requireAuthenticatedUser } from "@/app/auth";
import { getLatestScanForUser, getScanForUser } from "@/db/product";
import { ReportContent } from "./report-content";
export const dynamic = "force-dynamic";
export const runtime = "edge";
export const metadata: Metadata = {
  title: "Private visibility report",
  robots: { index: false, follow: false },
};
export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ scan?: string }>;
}) {
  const { scan: scanId } = await searchParams;
  const user = await requireAuthenticatedUser();
  const scan = scanId
    ? await getScanForUser(user.userId, scanId)
    : await getLatestScanForUser(user.userId);
  return <ReportContent scan={scan} displayName={user.displayName} />;
}
