import assert from "node:assert/strict";
import { test } from "node:test";
import { frontmatterBool, frontmatterList, frontmatterNumber, frontmatterString, parseFrontmatter } from "../src/markdown.ts";

test("解析标量、数组与列表形式", () => {
  const { data, body } = parseFrontmatter(
    [
      "---",
      "id: tone",
      "title: \"叙事基调\"",
      "priority: 100",
      "constant: true",
      "keywords: [码头, 煤灰]",
      "tags:",
      "  - 悬疑",
      "  - 推理",
      "---",
      "# 正文",
      "内容",
    ].join("\n"),
  );

  assert.equal(frontmatterString(data, "id"), "tone");
  assert.equal(frontmatterString(data, "title"), "叙事基调");
  assert.equal(frontmatterNumber(data, "priority"), 100);
  assert.equal(frontmatterBool(data, "constant"), true);
  assert.deepEqual(frontmatterList(data, "keywords"), ["码头", "煤灰"]);
  assert.deepEqual(frontmatterList(data, "tags"), ["悬疑", "推理"]);
  assert.equal(body.trim(), "# 正文\n内容");
});

test("没有 frontmatter 时正文原样返回", () => {
  const { data, body } = parseFrontmatter("# 标题\n正文");
  assert.deepEqual(data, {});
  assert.equal(body, "# 标题\n正文");
});

test("未闭合 frontmatter 不会吞掉正文", () => {
  const { data, body } = parseFrontmatter("---\nid: broken\n正文");
  assert.deepEqual(data, {});
  assert.equal(body, "---\nid: broken\n正文");
});
