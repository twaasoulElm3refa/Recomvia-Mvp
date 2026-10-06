import type { Metadata } from "next";
import { PolicyPage, type PolicyCopy } from "@/app/components/policy-page";
import { SITE_URL } from "@/lib/articles";

export const metadata: Metadata = { title: { absolute: "Recomvia Private Beta Terms" }, description: "Terms governing the Recomvia private beta.", alternates: { canonical: `${SITE_URL}/terms` } };

const copy: Record<"en" | "ar", PolicyCopy> = {
  en: {
    metadata: { title: "Recomvia Private Beta Terms", description: "Terms governing the Recomvia private beta." }, eyebrow: "Private beta", title: "Terms of Use", intro: "These terms govern the current evaluation release. The beta is not yet a paid production service.", effective: "Effective 21 September 2026 · Private beta",
    sections: [
      { title: "Beta status", paragraphs: ["Recomvia currently provides a live website-readiness scanner, saved evidence reports, research content, and support. AI answer-surface measurement, billing, Fix Credit consumption, and direct website application are not active unless a screen explicitly states otherwise."] },
      { title: "Authorized use", paragraphs: ["You may analyze only public websites that you own, manage, or are otherwise authorized to assess. You must not use Recomvia to probe private networks, evade access controls, overload services, submit unlawful material, impersonate another person, or interfere with other accounts."] },
      { title: "Measurement limits", paragraphs: ["A readiness score describes observable website signals in a defined run. It is not a ranking, guarantee, recommendation, citation, legal conclusion, or promise of commercial performance. Actual AI visibility must be supported by named surfaces, prompts, markets, timestamps, runs, and stored evidence."] },
      { title: "Changes and availability", paragraphs: ["Beta features, limits, and methodology can change as they are tested. Recomvia may pause a scan or account to protect security, data integrity, cost controls, or other users. Methodology changes that affect comparability will receive a new version."] },
      { title: "Content and responsibility", paragraphs: ["You retain responsibility for decisions and website changes made from a report. Recomvia research and generated recommendations require professional review where accuracy, regulation, safety, or contractual obligations matter."] },
      { title: "Contact", paragraphs: [{ before: "Questions, data requests, and beta issues can be submitted through the ", link: "Recomvia contact page", after: ". Final merchant, governing-law, liability, and business-identity terms will be published before any public paid checkout is enabled." }] },
    ],
  },
  ar: {
    metadata: { title: "شروط الإصدار التجريبي الخاص من Recomvia", description: "الشروط المنظمة للإصدار التجريبي الخاص من Recomvia." }, eyebrow: "إصدار تجريبي خاص", title: "شروط الاستخدام", intro: "تحكم هذه الشروط إصدار التقييم الحالي. ولم يصبح الإصدار التجريبي بعد خدمة إنتاج مدفوعة.", effective: "سارية من 21 سبتمبر 2026 · إصدار تجريبي خاص",
    sections: [
      { title: "حالة الإصدار التجريبي", paragraphs: ["تقدم Recomvia حاليًا فاحصًا مباشرًا لجاهزية المواقع، وتقارير أدلة محفوظة، ومحتوى بحثيًا، ودعمًا. ولا يكون قياس أسطح إجابات الذكاء الاصطناعي أو الفوترة أو استهلاك Fix Credits أو تطبيق التعديلات مباشرة على الموقع مفعّلًا ما لم تنص شاشة صراحة على خلاف ذلك."] },
      { title: "الاستخدام المصرح به", paragraphs: ["لا يجوز لك تحليل إلا المواقع العامة التي تملكها أو تديرها أو تملك صلاحية تقييمها. ويجب ألا تستخدم Recomvia لفحص الشبكات الخاصة، أو تجاوز ضوابط الوصول، أو إثقال الخدمات، أو إرسال مواد غير قانونية، أو انتحال شخصية أخرى، أو التدخل في حسابات الآخرين."] },
      { title: "حدود القياس", paragraphs: ["تصف درجة الجاهزية إشارات الموقع القابلة للرصد في تشغيل محدد. وهي ليست ترتيبًا أو ضمانًا أو توصية أو استشهادًا أو نتيجة قانونية أو وعدًا بأداء تجاري. ويجب دعم AI Visibility الفعلي بأسطح وأسئلة وأسواق وطوابع زمنية وعمليات تشغيل وأدلة محفوظة محددة بالاسم."] },
      { title: "التغييرات والتوافر", paragraphs: ["قد تتغير ميزات الإصدار التجريبي وحدوده ومنهجيته أثناء اختبارها. وقد توقف Recomvia فحصًا أو حسابًا لحماية الأمان أو سلامة البيانات أو ضوابط التكلفة أو المستخدمين الآخرين. وستحصل تغييرات المنهجية التي تؤثر في قابلية المقارنة على إصدار جديد."] },
      { title: "المحتوى والمسؤولية", paragraphs: ["تظل مسؤولًا عن القرارات وتغييرات الموقع التي تنفذها استنادًا إلى تقرير. وتتطلب أبحاث Recomvia والتوصيات المولدة مراجعة مهنية عندما تكون الدقة أو اللوائح أو السلامة أو الالتزامات التعاقدية مهمة."] },
      { title: "الاتصال", paragraphs: [{ before: "يمكن إرسال الأسئلة وطلبات البيانات ومشكلات الإصدار التجريبي عبر ", link: "صفحة الاتصال بـ Recomvia", after: ". وستُنشر شروط الجهة التجارية النهائية والقانون الحاكم والمسؤولية وهوية النشاط التجاري قبل تفعيل أي دفع عام مدفوع." }] },
    ],
  },
};

export default function TermsPage() { return <PolicyPage copy={copy} />; }
