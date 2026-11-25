import assert from "node:assert/strict";
import test from "node:test";
import { faqEntries, searchKnowledge } from "../lib/knowledge-base";

const cases = [
  ["ما الفرق بين الظهور والجاهزية؟", "/faq#visibility-vs-readiness"],
  ["هل تضمنون توصية الذكاء الاصطناعي؟", "/faq#guarantee"],
  ["هل تضمن Recomvia ظهور علامتي التجارية أو التوصية بها داخل إجابات الذكاء الاصطناعي؟", "/faq#guarantee"],
  ["كم سعر باقة Essential؟", "/faq#essential-plan"],
  ["هل يمكنكم تعديل موقعي دون موافقتي؟", "/faq#approval-rollback"],
  ["هل تدعمون ووردبريس؟", "/faq#wordpress"],
  ["What does the Essential plan include?", "/faq#essential-plan"],
  ["What is the difference between subscriptions and Fix Credits?", "/faq#subscription-vs-credits"],
] as const;
for (const [question, source] of cases) {
  test(`supported question: ${question}`, () => {
    const result = searchKnowledge(question);
    assert.equal(result.answered, true);
    assert.equal(result.sourceUrl, source);
  });
}
for (const question of [
  "ما حالة الطقس في الرياض اليوم؟",
  "هل Recomvia تساعدني في الحصول على تأشيرة سفر؟",
  "Does Recomvia refund a failed scan?",
  "Recomvia can you find my missing invoice number 827184?",
  "ما كلمة المرور لحساب Recomvia الخاص بي؟",
]) {
  test(`unsupported question: ${question}`, () => {
    const result = searchKnowledge(question);
    assert.equal(result.answered, false);
    assert.equal(result.answer, undefined);
  });
}
for (const entry of faqEntries) {
  for (const question of [entry.question, entry.questionAr]) {
    test(`exact FAQ: ${question}`, () => {
      assert.equal(searchKnowledge(question).sourceUrl, `/faq#${entry.id}`);
    });
  }
}

test("paid-plan FAQ and assistant do not promise checkout before payment activation", () => {
  for (const plan of ["starter", "essential", "growth", "pro"]) {
    const entry = faqEntries.find((item) => item.id === `${plan}-plan`);
    assert.ok(entry, `Missing ${plan} FAQ`);
    assert.match(entry.answer, /only after online payments are activated/i);
    assert.match(entry.answerAr, /إلا بعد تفعيل/);
    assert.doesNotMatch(entry.answer, /continue to checkout/i);
    assert.doesNotMatch(entry.answerAr, /للمتابعة إلى الدفع/);
    const english = searchKnowledge(entry.question);
    const arabic = searchKnowledge(entry.questionAr);
    assert.equal(english.answered, true);
    assert.equal(arabic.answered, true);
    assert.match(english.answer ?? "", /only after online payments are activated/i);
    assert.match(arabic.answer ?? "", /إلا بعد تفعيل/);
  }
});


test("privacy FAQ and assistant accurately describe current beta abuse controls", () => {
  const entry = faqEntries.find((item) => item.id === "privacy");
  assert.ok(entry);
  for (const [question, language, account, retries, cache, limitation, rights] of [
    [entry.question, "en", /account eligibility/i, /retry limits/i, /recent eligible results may be reused/i, /device fingerprinting and risk scoring are not implemented/i, /request access or deletion/i],
    [entry.questionAr, "ar", /أهلية الحساب/, /حدود إعادة المحاولة/, /النتائج الحديثة المؤهلة/, /لم تُنفذ بعد آليات بصمة الجهاز المتقدمة وتقييم المخاطر/, /طلب الوصول إليها أو حذفها/],
  ] as const) {
    const result = searchKnowledge(question);
    assert.equal(result.answered, true);
    assert.equal(result.language, language);
    assert.equal(result.sourceUrl, "/faq#privacy");
    const answer = result.answer ?? "";
    for (const assertion of [account, retries, cache, limitation, rights]) assert.match(answer, assertion);
    assert.equal(answer, language === "en" ? entry.answer : entry.answerAr);
  }
});
