/**
 * A small GitHub-flavoured-markdown subset parser, sized to what the assistant
 * actually emits: headings, emphasis, code, lists, tables, quotes and rules.
 *
 * Written rather than installed because CLAUDE.md rules out external UI
 * dependencies, and because this has one requirement a general parser does not:
 * **it is fed half-written input on every streaming delta.** Every construct
 * below therefore degrades to something readable when its closing token has not
 * arrived yet — an unterminated `**` stays literal, an unclosed fence renders as
 * a code block, a table whose delimiter row is still mid-stream renders as
 * paragraph text. Nothing throws, and nothing swallows the rest of the message
 * waiting for a terminator.
 */

export type Inline =
  | { type: "text"; value: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; children: Inline[] };

export type Align = "left" | "right" | "center";

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "code"; lang: string | null; value: string }
  | { type: "quote"; children: Inline[] }
  | { type: "table"; header: Inline[][]; rows: Inline[][][]; align: Align[] }
  | { type: "rule" };

const HEADING_RE = /^(#{1,3})\s+(.*)$/;
const FENCE_RE = /^```(\w*)\s*$/;
const RULE_RE = /^(-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE_RE = /^>\s?/;
const BULLET_RE = /^\s*[-*+]\s+(.*)$/;
const ORDERED_RE = /^\s*\d+[.)]\s+(.*)$/;
/** `| --- | ---: |` — the row that promotes the line above it to a table. */
const DELIMITER_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const ALNUM = /[A-Za-z0-9]/;

function isTableStart(lines: string[], i: number): boolean {
  return (
    lines[i].includes("|") &&
    i + 1 < lines.length &&
    DELIMITER_RE.test(lines[i + 1])
  );
}

/** Does this line begin a block, and so end any paragraph running into it? */
function startsBlock(lines: string[], i: number): boolean {
  const line = lines[i];
  return (
    HEADING_RE.test(line) ||
    FENCE_RE.test(line.trim()) ||
    RULE_RE.test(line.trim()) ||
    QUOTE_RE.test(line) ||
    BULLET_RE.test(line) ||
    ORDERED_RE.test(line) ||
    isTableStart(lines, i)
  );
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function alignFrom(cell: string): Align {
  const s = cell.trim();
  const left = s.startsWith(":");
  const right = s.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  return "left";
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  let i = 0;

  const flush = () => {
    if (buf) {
      out.push({ type: "text", value: buf });
      buf = "";
    }
  };

  while (i < src.length) {
    const ch = src[i];

    // Code spans win over everything — their contents are literal.
    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i) {
        flush();
        out.push({ type: "code", value: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if (ch === "[") {
      const close = src.indexOf("]", i + 1);
      if (close > i && src[close + 1] === "(") {
        const paren = src.indexOf(")", close + 2);
        if (paren > close) {
          flush();
          out.push({
            type: "link",
            href: src.slice(close + 2, paren).trim(),
            children: parseInline(src.slice(i + 1, close)),
          });
          i = paren + 1;
          continue;
        }
      }
    }

    if (ch === "*" && src[i + 1] === "*") {
      const end = src.indexOf("**", i + 2);
      if (end > i + 1) {
        flush();
        out.push({ type: "strong", children: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }

    if (ch === "*") {
      // `3 * 4` is multiplication, not an opener.
      const end = src.indexOf("*", i + 1);
      if (end > i + 1 && src[i + 1] !== " ") {
        flush();
        out.push({ type: "em", children: parseInline(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }

    if (ch === "_") {
      // Intraword underscores are identifiers, not emphasis: `get_portfolio`
      // must survive intact, since the assistant names its own tools.
      const prev = i > 0 ? src[i - 1] : "";
      const end = src.indexOf("_", i + 1);
      if (!ALNUM.test(prev) && end > i + 1 && !ALNUM.test(src[end + 1] ?? "")) {
        flush();
        out.push({ type: "em", children: parseInline(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }

    buf += ch;
    i++;
  }

  flush();
  return out;
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = FENCE_RE.exec(line.trim());
    if (fence) {
      const lang = fence[1] || null;
      const body: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== "```") {
        body.push(lines[i]);
        i++;
      }
      // Mid-stream the closing fence has not arrived; consuming to EOF and
      // rendering what we have beats holding the whole message back.
      i++;
      blocks.push({ type: "code", lang, value: body.join("\n") });
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3,
        children: parseInline(heading[2].trim()),
      });
      i++;
      continue;
    }

    if (RULE_RE.test(line.trim())) {
      blocks.push({ type: "rule" });
      i++;
      continue;
    }

    if (isTableStart(lines, i)) {
      const header = splitRow(lines[i]).map(parseInline);
      const align = splitRow(lines[i + 1]).map(alignFrom);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitRow(lines[i]).map(parseInline));
        i++;
      }
      blocks.push({ type: "table", header, rows, align });
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        buf.push(lines[i].replace(QUOTE_RE, ""));
        i++;
      }
      blocks.push({ type: "quote", children: parseInline(buf.join(" ")) });
      continue;
    }

    const ordered = ORDERED_RE.test(line);
    if (ordered || BULLET_RE.test(line)) {
      const re = ordered ? ORDERED_RE : BULLET_RE;
      const items: Inline[][] = [];
      while (i < lines.length) {
        const m = re.exec(lines[i]);
        if (!m) break;
        items.push(parseInline(m[1].trim()));
        i++;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const para: string[] = [];
    // `i` is known not to start a block (every branch above missed), so this
    // always consumes at least one line and cannot spin.
    do {
      para.push(lines[i].trim());
      i++;
    } while (i < lines.length && lines[i].trim() && !startsBlock(lines, i));
    blocks.push({ type: "paragraph", children: parseInline(para.join(" ")) });
  }

  return blocks;
}
