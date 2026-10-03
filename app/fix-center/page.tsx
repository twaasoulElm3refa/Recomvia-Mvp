import type { Metadata } from "next";
import { requireAuthenticatedUser } from "@/app/auth";
import { FixCenterExperience } from "./fix-center-experience";

export const dynamic = "force-dynamic";
export const runtime = "edge";
export const metadata: Metadata = { title: "Private fix catalog", robots: { index: false, follow: false } };

export default async function FixCenterPage(){
  await requireAuthenticatedUser();
  return <FixCenterExperience/>;
}
