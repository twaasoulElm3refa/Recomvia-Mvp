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
  ["What is included in the Starter Report?", "/faq#starter-report"],
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
