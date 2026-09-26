/**
 * 极简 PNG 文本块读取器：只做读取 tEXt / zTXt / iTXt 三类文本 chunk 所需的最少解析。
 * 用途：从 SillyTavern 角色卡 PNG 中取出 `chara`（v2）或 `ccv3`（v3）块里的 base64 JSON。
 * 不做 CRC 校验（我们只读不写），也不解码图像数据。
 */
import { inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isPng(buf: Buffer): boolean {
  return buf.length > 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE);
}

function decodeLatin1(buf: Buffer): string {
  return buf.toString("latin1");
}

/**
 * 文本块解码：PNG 规范规定 tEXt/zTXt 为 ISO-8859-1，但实际工具里 UTF-8 更常见。
 * 先按 UTF-8 严格解码，失败（出现 U+FFFD）再退回 latin1。
 */
function decodeText(buf: Buffer): string {
  const utf8 = buf.toString("utf8");
  return utf8.includes("\uFFFD") ? decodeLatin1(buf) : utf8;
}

/** 读取 PNG 中所有文本块，返回 keyword → text（同名取第一个）。 */
export function readPngTextChunks(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  if (!isPng(buf)) return out;

  let offset = 8;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("latin1", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buf.length) break; // 截断文件，停止解析

    if (type === "tEXt" || type === "zTXt" || type === "iTXt") {
      try {
        const parsed = parseTextChunk(type, buf.subarray(dataStart, dataEnd));
        if (parsed && !out.has(parsed.keyword)) out.set(parsed.keyword, parsed.text);
      } catch {
        // 单个坏 chunk 不影响其它文本块
      }
    }
    if (type === "IEND") break;
    offset = dataEnd + 4;
  }
  return out;
}

function parseTextChunk(
  type: string,
  data: Buffer,
): { keyword: string; text: string } | undefined {
  const nul = data.indexOf(0);
  if (nul < 0) return undefined;
  const keyword = decodeLatin1(data.subarray(0, nul));
  const rest = data.subarray(nul + 1);

  if (type === "tEXt") return { keyword, text: decodeText(rest) };

  if (type === "zTXt") {
    // keyword \0 compressionMethod(1) compressedText
    if (rest.length < 1 || rest[0] !== 0) return undefined;
    return { keyword, text: decodeText(inflateSync(rest.subarray(1))) };
  }

  // iTXt: keyword \0 compressionFlag(1) compressionMethod(1) languageTag \0 translatedKeyword \0 text
  if (rest.length < 2) return undefined;
  const compressionFlag = rest[0];
  const body = rest.subarray(2);
  const langEnd = body.indexOf(0);
  if (langEnd < 0) return undefined;
  const afterLang = body.subarray(langEnd + 1);
  const translatedEnd = afterLang.indexOf(0);
  if (translatedEnd < 0) return undefined;
  const textBytes = afterLang.subarray(translatedEnd + 1);
  const decoded = compressionFlag === 1 ? inflateSync(textBytes) : textBytes;
  return { keyword, text: decoded.toString("utf8") };
}

/** 从 PNG 卡里取出角色 JSON 文本（兼容 v2 `chara` 与 v3 `ccv3`）。 */
export function readCharacterJsonFromPng(buf: Buffer): { json: string; source: string } | undefined {
  const chunks = readPngTextChunks(buf);
  for (const key of ["ccv3", "chara"]) {
    const value = chunks.get(key);
    if (!value) continue;
    const trimmed = value.trim();
    if (trimmed.startsWith("{")) return { json: trimmed, source: `png:${key}` };
    try {
      const decoded = Buffer.from(trimmed, "base64").toString("utf8");
      if (decoded.trim().startsWith("{")) return { json: decoded, source: `png:${key}` };
    } catch {
      // 继续尝试下一个 key
    }
  }
  return undefined;
}
