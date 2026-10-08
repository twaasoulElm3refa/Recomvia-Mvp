import type { Metadata } from "next";
import { PolicyPage, type PolicyCopy } from "@/app/components/policy-page";
import { SITE_URL } from "@/lib/articles";

export const metadata: Metadata = { title: { absolute: "Recomvia Beta Billing Policy" }, description: "Current payment, subscription, cancellation, refund, and Fix Credit status for the Recomvia private beta.", alternates: { canonical: `${SITE_URL}/billing-policy` } };

const copy: Record<"en" | "ar", PolicyCopy> = {
  en: {
    metadata: { title: "Recomvia Beta Billing Policy", description: "Current payment, subscription, cancellation, refund, and Fix Credit status for the Recomvia private beta." }, eyebrow: "Commercial transparency", title: "Billing, Cancellation & Credits", intro: "No payment is collected and no Fix Credits are issued in the current private beta.", effective: "Effective 21 September 2026 · Private beta",
    sections: [
      { title: "Current status", paragraphs: ["The prices displayed for Starter, Essential, Growth, Pro, Agency, credit packs, and expert services are validation hypotheses. Checkout, subscriptions, renewals, and credit purchases are disabled until live operating costs and safeguards have been verified."] },
      { title: "Before billing opens", paragraphs: ["Recomvia will publish exact plan limits, billing intervals, included prompts and surfaces, overage treatment, tax handling, cancellation timing, refund eligibility, credit validity, and the legal merchant identity before accepting payment."] },
      { title: "Planned credit principle", paragraphs: ["Purchased Fix Credits will be recorded in an append-only ledger and tied to a specific action. A failed action must release or reverse its reservation. Cancellation of a subscription will not silently confiscate purchased credits, although Fix Center access can require an active Essential or higher plan under the published validity rules."] },
      { title: "No accidental charge", paragraphs: [{ before: "Buttons on the private-beta pricing and Fix Center pages either join the beta, request human contact, or preview a catalog item. They do not create a purchase. If you receive an unexpected payment request claiming to be Recomvia, report it through the ", link: "contact page", after: "." }] },
    ],
  },
  ar: {
    metadata: { title: "سياسة الفوترة للإصدار التجريبي من Recomvia", description: "الحالة الحالية للدفع والاشتراك والإلغاء والاسترداد وFix Credits في الإصدار التجريبي الخاص من Recomvia." }, eyebrow: "شفافية تجارية", title: "الفوترة والإلغاء والنقاط", intro: "لا تُحصّل أي مدفوعات ولا تُصدر أي Fix Credits في الإصدار التجريبي الخاص الحالي.", effective: "سارية من 21 سبتمبر 2026 · إصدار تجريبي خاص",
    sections: [
      { title: "الحالة الحالية", paragraphs: ["الأسعار المعروضة لخطط Starter وEssential وGrowth وPro وAgency، وحزم النقاط، وخدمات الخبراء هي فرضيات للتحقق. ويظل الدفع والاشتراكات والتجديدات وشراء النقاط معطلًا إلى أن يجري التحقق من تكاليف التشغيل الفعلية والضمانات."] },
      { title: "قبل فتح الفوترة", paragraphs: ["ستنشر Recomvia قبل قبول أي مدفوعات الحدود الدقيقة للخطط، وفترات الفوترة، والأسئلة والأسطح المشمولة، ومعالجة الاستخدام الزائد، والتعامل الضريبي، وتوقيت الإلغاء، وأهلية الاسترداد، وصلاحية النقاط، والهوية القانونية للجهة التجارية."] },
      { title: "المبدأ المخطط للنقاط", paragraphs: ["ستُسجل Fix Credits المشتراة في سجل لا يقبل إلا الإضافة، وستُربط بعملية محددة. ويجب أن تحرر العملية الفاشلة حجزها أو تعكسه. ولن يؤدي إلغاء الاشتراك إلى مصادرة النقاط المشتراة بصمت، مع أن الوصول إلى مركز الإصلاح قد يتطلب خطة Essential نشطة أو خطة أعلى وفق قواعد الصلاحية المنشورة."] },
      { title: "لا رسوم عرضية", paragraphs: [{ before: "تتيح الأزرار في صفحتي أسعار الإصدار التجريبي الخاص ومركز الإصلاح الانضمام إلى الإصدار التجريبي أو طلب تواصل بشري أو معاينة عنصر في الكتالوج. وهي لا تنشئ عملية شراء. وإذا تلقيت طلب دفع غير متوقع يزعم أنه من Recomvia، فأبلغ عنه عبر ", link: "صفحة الاتصال", after: "." }] },
    ],
  },
};

export default function BillingPolicyPage() { return <PolicyPage copy={copy} />; }
