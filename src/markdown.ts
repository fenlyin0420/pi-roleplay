/** 极简 YAML frontmatter 解析：只支持 `key: value`、`key: [a, b]`、`key:` 后跟 `- item` 列表。 */

export interface Frontmatter {
  data: Record<string, string | string[]>;
  body: string;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 1) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length > 1)
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseInlineList(value: string): string[] {
  const inner = value.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (!inner.trim()) return [];
  return inner
    .split(",")
    .map((item) => unquote(item))
    .filter((item) => item.length > 0);
}

export function parseFrontmatter(text: string): Frontmatter {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---")) return { data: {}, body: normalized };

  const end = normalized.indexOf("\n---", 3);
  if (end < 0) return { data: {}, body: normalized };

  const rawHeader = normalized.slice(normalized.indexOf("\n", 3) + 1, end);
  const body = normalized.slice(normalized.indexOf("\n", end + 1) + 1).replace(/^\n/, "");

  const data: Record<string, string | string[]> = {};
  let listKey: string | undefined;

  for (const line of rawHeader.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const listItem = /^\s*-\s+(.*)$/.exec(line);
    if (listItem && listKey) {
      const current = data[listKey];
      const values = Array.isArray(current) ? current : [];
      values.push(unquote(listItem[1]));
      data[listKey] = values;
      continue;
    }

    const match = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1];
    const value = match[2];
    if (!value.trim()) {
      data[key] = [];
      listKey = key;
      continue;
    }
    data[key] = value.trim().startsWith("[") ? parseInlineList(value) : unquote(value);
    listKey = undefined;
  }

  return { data, body };
}

export function frontmatterString(data: Record<string, string | string[]>, key: string): string | undefined {
  const value = data[key];
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value.join(", ") : value;
}

export function frontmatterList(data: Record<string, string | string[]>, key: string): string[] {
  const value = data[key];
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function frontmatterBool(data: Record<string, string | string[]>, key: string): boolean | undefined {
  const value = frontmatterString(data, key);
  if (value === undefined) return undefined;
  return /^(true|yes|1)$/i.test(value.trim());
}

export function frontmatterNumber(data: Record<string, string | string[]>, key: string): number | undefined {
  const value = frontmatterString(data, key);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
