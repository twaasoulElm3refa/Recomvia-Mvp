import type { Metadata } from "next";
import { PolicyPage, type PolicyCopy } from "@/app/components/policy-page";
import { SITE_URL } from "@/lib/articles";

export const metadata: Metadata = { title: { absolute: "Recomvia Privacy & Beta Data Notice" }, description: "What Recomvia collects and why during the private beta.", alternates: { canonical: `${SITE_URL}/privacy` } };

const copy: Record<"en" | "ar", PolicyCopy> = {
  en: {
    metadata: { title: "Recomvia Privacy & Beta Data Notice", description: "What Recomvia collects and why during the private beta." }, eyebrow: "Trust center", title: "Privacy & Beta Data Notice", intro: "This notice describes the data used by the current private beta. It will be replaced by market-specific production terms before public paid launch.", effective: "Effective 21 September 2026 · Private beta",
    sections: [
      { title: "Data we use", paragraphs: ["When you sign in, the hosting platform can provide a stable user identifier, email address, and optional display name. When you request a scan, Recomvia stores the website address, chosen language and country, fetched public-page evidence, results, timestamps, methodology version, and operational request counts.", "Support requests can include your name, email, question, source page, status, and the human reply. A private ticket access key may be stored in your browser so the same browser can retrieve the response."] },
      { title: "Why we use it", paragraphs: ["We use this information to provide and secure the beta, save account-owned reports, reuse recent scans, diagnose failures, measure operating cost, prevent abuse, and answer support requests. Recomvia does not sell personal data."] },
      { title: "Website scanning", paragraphs: ["Only submit public websites that you are authorized to analyze. The current scanner retrieves the submitted public page, robots.txt, and an available XML sitemap. It does not bypass authentication, paywalls, or access controls, and it does not claim to test consumer AI answers."] },
      { title: "Retention and deletion", paragraphs: [{ before: "Private-beta records are retained while they are needed to operate and evaluate the beta. Before public launch, Recomvia will publish and enforce a production retention schedule covering account data, reports, evidence, support records, backups, and cost logs. You may request access or deletion through the ", link: "contact page", after: "." }] },
      { title: "Service providers and security", paragraphs: ["Recomvia uses infrastructure and service providers necessary to host the application, store records, authenticate visitors, and operate support. Access to customer reports is checked on the server against the signed-in user’s organization. No online service can promise absolute security; material incidents will be investigated and handled under the production incident policy before public launch."] },
      { title: "Changes", paragraphs: ["This notice is versioned for the private beta. Material changes will be shown with a new effective date. Paid service, external analytics, advertising trackers, new AI providers, or direct website modification will not be activated silently; the relevant notice and consent flow will be updated first."] },
    ],
  },
  ar: {
    metadata: { title: "إشعار الخصوصية وبيانات الإصدار التجريبي من Recomvia", description: "ما البيانات التي تجمعها Recomvia خلال الإصدار التجريبي الخاص ولماذا تجمعها." }, eyebrow: "مركز الثقة", title: "إشعار الخصوصية وبيانات الإصدار التجريبي", intro: "يصف هذا الإشعار البيانات المستخدمة في الإصدار التجريبي الخاص الحالي. وسيُستبدل بشروط إنتاج خاصة بكل سوق قبل الإطلاق العام المدفوع.", effective: "ساري من 21 سبتمبر 2026 · إصدار تجريبي خاص",
    sections: [
      { title: "البيانات التي نستخدمها", paragraphs: ["عند تسجيل الدخول، قد تزودنا منصة الاستضافة بمعرّف مستخدم ثابت وعنوان بريد إلكتروني واسم عرض اختياري. وعندما تطلب فحصًا، تحفظ Recomvia عنوان الموقع واللغة والبلد المختارين وأدلة الصفحات العامة التي جُلبت والنتائج والطوابع الزمنية وإصدار المنهجية وعدد طلبات التشغيل.", "قد تتضمن طلبات الدعم اسمك وبريدك الإلكتروني وسؤالك والصفحة المصدر والحالة والرد البشري. وقد يُحفظ مفتاح وصول خاص بالتذكرة في متصفحك كي يستطيع المتصفح نفسه استرداد الرد."] },
      { title: "لماذا نستخدمها", paragraphs: ["نستخدم هذه المعلومات لتقديم الإصدار التجريبي وتأمينه، وحفظ التقارير المملوكة للحساب، وإعادة استخدام الفحوص الحديثة، وتشخيص الأعطال، وقياس تكلفة التشغيل، ومنع إساءة الاستخدام، والرد على طلبات الدعم. لا تبيع Recomvia البيانات الشخصية."] },
      { title: "فحص المواقع", paragraphs: ["لا ترسل إلا مواقع عامة تملك صلاحية تحليلها. يجلب الفاحص الحالي الصفحة العامة المرسلة وملف robots.txt وخريطة موقع XML متاحة. ولا يتجاوز المصادقة أو جدران الدفع أو ضوابط الوصول، ولا يدّعي اختبار إجابات منتجات الذكاء الاصطناعي الموجهة للمستهلكين."] },
      { title: "الاحتفاظ والحذف", paragraphs: [{ before: "نحتفظ بسجلات الإصدار التجريبي الخاص ما دامت لازمة لتشغيل الإصدار وتقييمه. وقبل الإطلاق العام، ستنشر Recomvia جدول احتفاظ للإنتاج وتطبقه، ويغطي بيانات الحساب والتقارير والأدلة وسجلات الدعم والنسخ الاحتياطية وسجلات التكلفة. يمكنك طلب الوصول أو الحذف عبر ", link: "صفحة الاتصال", after: "." }] },
      { title: "مزودو الخدمة والأمان", paragraphs: ["تستخدم Recomvia مزودي البنية التحتية والخدمات اللازمين لاستضافة التطبيق وحفظ السجلات ومصادقة الزوار وتشغيل الدعم. يُتحقق على الخادم من وصول المستخدم إلى تقارير العملاء بالرجوع إلى مؤسسة المستخدم المسجل دخوله. لا تستطيع أي خدمة عبر الإنترنت ضمان الأمان المطلق؛ وستُحقق الحوادث الجوهرية وتُعالج وفق سياسة حوادث الإنتاج قبل الإطلاق العام."] },
      { title: "التغييرات", paragraphs: ["هذا الإشعار محدد بإصدار خاص بالمرحلة التجريبية. ستُعرض التغييرات الجوهرية بتاريخ سريان جديد. ولن تُفعّل الخدمة المدفوعة أو التحليلات الخارجية أو أدوات تتبع الإعلانات أو مزودو ذكاء اصطناعي جدد أو التعديل المباشر للموقع بصمت؛ بل سيُحدّث أولًا الإشعار المعني ومسار الموافقة."] },
    ],
  },
};

export default function PrivacyPage() { return <PolicyPage copy={copy} />; }
