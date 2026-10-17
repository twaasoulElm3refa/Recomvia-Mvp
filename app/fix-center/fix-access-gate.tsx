"use client";
import { LockKeyhole } from "lucide-react";
import { AppShell } from "@/app/components/app-shell";
import { NavigationLink as Link } from "@/app/components/navigation-link";
import { Button } from "@/components/ui/button";
import { useSiteLocale } from "@/hooks/use-site-locale";
import { planById } from "@/lib/plans";

export function FixAccessGate() {
  const ar = useSiteLocale() === "ar";
  const price = planById("essential")!.price.amount;
  return <AppShell title={ar ? "مركز الإصلاح" : "Fix Center"} description={ar ? "التحسينات ونقاط الإصلاح متاحة مع اشتراك شهري نشط." : "Optimization and Fix Credits require an active monthly subscription."}>
    <section className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-8 text-center">
      <LockKeyhole className="mx-auto size-9 text-blue-600" aria-hidden="true" />
      <h2 className="mt-5 text-2xl font-extrabold">{ar ? "يلزم اشتراك شهري نشط" : "An active monthly plan is required"}</h2>
      <p className="mt-4 text-sm leading-8 text-slate-600">{ar ? `تبدأ الباقات الشهرية من ${price}. تتيح Essential وGrowth وPro مركز الإصلاح وأهلية شراء النقاط، وتُشترى النقاط منفصلة. شراء تقرير Starter وحده لا يفتح مركز الإصلاح.` : `Monthly plans start at ${price}. Essential, Growth and Pro include Fix Center eligibility; credits are purchased separately. A Starter report alone does not unlock Fix Center.`}</p>
      <Button asChild className="mt-6 rounded-xl bg-blue-600"><Link href="/pricing#essential">{ar ? "مقارنة الباقات" : "Compare plans"}</Link></Button>
      <p className="mt-5 text-xs leading-6 text-slate-500">{ar ? "لم يُفتح التفعيل المدفوع بعد. لا يُخصم أي مبلغ من طلب الاهتمام." : "Paid activation is not open yet. An enquiry does not charge you."}</p>
    </section>
  </AppShell>;
}
