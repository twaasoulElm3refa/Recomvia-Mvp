import type { Metadata } from "next";
import { PolicyPage, type PolicyCopy } from "@/app/components/policy-page";
import { SITE_URL } from "@/lib/articles";

export const metadata: Metadata = { title: { absolute: "Recomvia Beta Billing Policy" }, description: "Current payment, subscription, cancellation, refund, and Fix Credit status for the Recomvia private beta.", alternates: { canonical: `${SITE_URL}/billing-policy` } };

const copy: Record<"en" | "ar", PolicyCopy> = {
  en: {
    metadata: { title: "Recomvia Beta Billing Policy", description: "Current payment, subscription, cancellation, refund, and Fix Credit status for the Recomvia private beta." }, eyebrow: "Commercial transparency", title: "Billing, Cancellation & Credits", intro: "PayPal Sandbox checkout is available for plan testing. Fix Credits are not yet sold.", effective: "Effective 15 October 2026 · Private beta",
    sections: [
      { title: "Current status", paragraphs: ["The plan catalog is Free (one analysis), Starter ($4.99 once for one saved initial report), Essential ($24/month for one project), Growth ($49/month for very advanced analysis of one project), and Pro ($99/month for three projects, each with full Growth features). Starter checkout requires a specific saved report. Monthly plans use the Subscriptions page and require an explicit checkout action. PayPal Sandbox transactions are tests, not live charges; Fix Credits are not yet sold."] },
      { title: "Before live billing", paragraphs: ["Recomvia will publish exact plan limits, billing intervals, included prompts and surfaces, overage treatment, tax handling, cancellation timing, refund eligibility, credit validity, and the legal merchant identity before accepting live payment."] },
      { title: "Planned credit principle", paragraphs: ["Purchased Fix Credits will be recorded in an append-only ledger and tied to a specific action. A failed action must release or reverse its reservation. Cancellation of a subscription will not silently confiscate purchased credits, and purchasing or using credits requires an active Essential, Growth or Pro subscription. Credits are additional purchases, and human services are separately priced. Validity terms will be published before sale."] },
      { title: "Checkout requires your action", paragraphs: [{ before: "Viewing a plan does not start checkout. A Starter report purchase or monthly subscription begins only when you choose its checkout button. If you receive an unexpected payment request claiming to be Recomvia, report it through the ", link: "contact page", after: "." }] },
    ],
  },
  ar: {
    metadata: { title: "سياسة الفوترة للإصدار التجريبي من Recomvia", description: "الحالة الحالية للدفع والاشتراك والإلغاء والاسترداد وFix Credits في الإصدار التجريبي الخاص من Recomvia." }, eyebrow: "شفافية تجارية", title: "الفوترة والإلغاء والنقاط", intro: "يتوفر الدفع التجريبي عبر PayPal Sandbox لاختبار الباقات. لم يبدأ بيع نقاط الإصلاح بعد.", effective: "سارية من 15 أكتوبر 2026 · إصدار تجريبي خاص",
    sections: [
      { title: "الحالة الحالية", paragraphs: ["الباقات هي Free لتحليل واحد، وStarter بسعر 4.99 دولار مرة واحدة لتقرير مبدئي محفوظ، وEssential بسعر 24 دولارًا شهريًا لمشروع واحد، وGrowth بسعر 49 دولارًا شهريًا لمشروع واحد، وPro بسعر 99 دولارًا شهريًا لثلاثة مشروعات. يتطلب شراء Starter تقريرًا محفوظًا محددًا. تُعرض الباقات الشهرية في صفحة الاشتراكات ولا يبدأ الدفع إلا بالنقر على زر الاشتراك. معاملات PayPal Sandbox تجريبية وليست رسومًا حقيقية؛ ولم يبدأ بيع نقاط الإصلاح بعد."] },
      { title: "قبل بدء الفوترة الفعلية", paragraphs: ["ستنشر Recomvia قبل قبول أي مدفوعات فعلية الحدود الدقيقة للخطط، وفترات الفوترة، والأسئلة والأسطح المشمولة، ومعالجة الاستخدام الزائد، والتعامل الضريبي، وتوقيت الإلغاء، وأهلية الاسترداد، وصلاحية النقاط، والهوية القانونية للجهة التجارية."] },
      { title: "المبدأ المخطط للنقاط", paragraphs: ["ستُسجل Fix Credits المشتراة في سجل لا يقبل إلا الإضافة، وستُربط بعملية محددة. ويجب أن تحرر العملية الفاشلة حجزها أو تعكسه. ولن يؤدي إلغاء الاشتراك إلى مصادرة النقاط المشتراة بصمت، ويشترط شراء النقاط أو استخدامها اشتراك Essential أو Growth أو Pro نشطًا. النقاط مشتريات إضافية والخدمات البشرية تُسعّر منفصلة، وتُنشر شروط الصلاحية قبل البيع."] },
      { title: "بدء الدفع يتطلب إجراءً منك", paragraphs: [{ before: "عرض الباقة لا يبدأ الدفع. تبدأ عملية شراء تقرير Starter أو الاشتراك الشهري فقط عند اختيار زر الدفع الخاص به. وإذا تلقيت طلب دفع غير متوقع يزعم أنه من Recomvia، فأبلغ عنه عبر ", link: "صفحة الاتصال", after: "." }] },
    ],
  },
};

export default function BillingPolicyPage() { return <PolicyPage copy={copy} />; }
