import assert from "node:assert/strict";
import { test } from "node:test";
import { clip, estimateTokens, keywordMatches, tokenizeForSearch, truncateToTokens, uniqueBy } from "../src/text.ts";

test("estimateTokens：CJK 按字、拉丁按 4 字符", () => {
  assert.equal(estimateTokens("你好世界"), 4);
  assert.equal(estimateTokens("test"), 1);
  assert.ok(estimateTokens("hello world") <= 4);
  assert.equal(estimateTokens(""), 0);
});

test("truncateToTokens：超出预算时截断并加省略号", () => {
  const text = "一二三四五六七八九十";
  assert.equal(truncateToTokens(text, 100), text);
  const truncated = truncateToTokens(text, 4);
  assert.ok(truncated.endsWith("…"));
  assert.ok(estimateTokens(truncated) <= 5);
  assert.equal(truncateToTokens(text, 0), "");
});

test("keywordMatches：子串、大小写、整词、正则", () => {
  assert.ok(keywordMatches("他走进码头区", "码头"));
  assert.ok(keywordMatches("The Harbor Gate", "harbor"));
  assert.ok(!keywordMatches("The Harbor Gate", "harbor", { caseSensitive: true }));

  // 整词：只对 ASCII 关键词生效
  assert.ok(!keywordMatches("start the engine", "art", { wholeWord: true }));
  assert.ok(keywordMatches("fine art", "art", { wholeWord: true }));
  // 含连字符的词边界
  assert.ok(!keywordMatches("art-direction", "art", { wholeWord: true }));

  // 正则写法
  assert.ok(keywordMatches("订单号 A-1029", "/A-\\d{4}/"));
  assert.ok(!keywordMatches("订单号 A-10", "/A-\\d{4}/"));
  assert.ok(keywordMatches("Deadline", "/deadline/"));
});

test("uniqueBy 保留首次出现顺序", () => {
  assert.deepEqual(uniqueBy([1, 2, 1, 3, 2], (item) => item), [1, 2, 3]);
});

test("tokenizeForSearch 兼顾拉丁词与中文片段", () => {
  const tokens = tokenizeForSearch("Harbor 码头区的煤灰 harbor");
  assert.ok(tokens.includes("harbor"));
  assert.ok(tokens.some((token) => token.includes("码头")));
  assert.equal(new Set(tokens).size, tokens.length);
});

test("clip 限制长度", () => {
  assert.equal(clip("abcdef", 3), "ab…");
  assert.equal(clip("ab", 5), "ab");
});
