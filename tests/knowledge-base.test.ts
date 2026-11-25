import assert from "node:assert/strict";
import test from "node:test";
import { faqEntries, searchKnowledge } from "../lib/knowledge-base";
import { getLocalizedArticle } from "../lib/articles-ar";

const cases = [
  ["ما الفرق بين الظهور والجاهزية؟", "/ar/faq#visibility-vs-readiness"],
  ["هل تضمنون توصية الذكاء الاصطناعي؟", "/ar/faq#guarantee"],
  ["هل تضمن Recomvia ظهور علامتي التجارية أو التوصية بها داخل إجابات الذكاء الاصطناعي؟", "/ar/faq#guarantee"],
  ["كم سعر باقة Essential؟", "/ar/faq#essential-plan"],
  ["هل يمكنكم تعديل موقعي دون موافقتي؟", "/ar/faq#approval-rollback"],
  ["هل تدعمون ووردبريس؟", "/ar/faq#wordpress"],
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
  for (const [question, prefix] of [[entry.question, ""], [entry.questionAr, "/ar"]] as const) {
    test(`exact FAQ: ${question}`, () => {
      assert.equal(searchKnowledge(question).sourceUrl, `${prefix}/faq#${entry.id}`);
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
    assert.equal(result.sourceUrl, language === "ar" ? "/ar/faq#privacy" : "/faq#privacy");
    const answer = result.answer ?? "";
    for (const assertion of [account, retries, cache, limitation, rights]) assert.match(answer, assertion);
    assert.equal(answer, language === "en" ? entry.answer : entry.answerAr);
  }
});


test("assistant uses the published article and source in the answer language", () => {
  const slug = "ai-visibility-optimization-guide";
  for (const locale of ["en", "ar"] as const) {
    const article = getLocalizedArticle(slug, locale);
    assert.ok(article);
    const result = searchKnowledge(article.title);
    assert.equal(result.answered, true);
    assert.equal(result.language, locale);
    assert.equal(result.answer, article.directAnswer);
    assert.equal(result.sourceUrl, `${locale === "ar" ? "/ar" : ""}/blog/${slug}`);
  }
});

test("brand-only introduction links to the FAQ in the answer language", () => {
  assert.equal(searchKnowledge("Recomvia").sourceUrl, "/faq#what-is-recomvia");
  assert.equal(searchKnowledge("ريكومفيا").sourceUrl, "/ar/faq#what-is-recomvia");
});


test("warm knowledge indexes preserve results across languages and unrelated questions", () => {
  const articleEn = getLocalizedArticle("ai-visibility-optimization-guide", "en");
  const articleAr = getLocalizedArticle("ai-visibility-optimization-guide", "ar");
  assert.ok(articleEn && articleAr);
  const queries = [articleEn.title, articleAr.title, ...cases.map(([question]) => question),
    "What is the weather in Riyadh today?", "ما حالة الطقس في الرياض اليوم؟"];
  const expected = queries.map((question) => searchKnowledge(question));
  assert.equal(expected[0].sourceUrl, "/blog/ai-visibility-optimization-guide");
  assert.equal(expected[1].sourceUrl, "/ar/blog/ai-visibility-optimization-guide");
  assert.equal(expected.at(-1)?.answered, false);
  assert.equal(expected.at(-2)?.answered, false);
  for (let round = 0; round < 3; round++) {
    for (let i = queries.length - 1; i >= 0; i--) {
      const result = searchKnowledge(queries[i]);
      assert.deepEqual(result, expected[i]);
      // Returned objects belong to the caller, not to the shared index.
      result.answer = "caller mutation";
      assert.deepEqual(searchKnowledge(queries[i]), expected[i]);
    }
  }
});
