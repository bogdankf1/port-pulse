import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, type Block, type Inline } from "./markdown";

/** Flatten an inline tree back to its visible text, for terse assertions. */
function text(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case "text":
        case "code":
          return n.value;
        default:
          return text(n.children);
      }
    })
    .join("");
}

describe("parseInline", () => {
  it("parses bold, italic and code", () => {
    const nodes = parseInline("a **b** c *d* e `f`");
    expect(nodes.map((n) => n.type)).toEqual([
      "text",
      "strong",
      "text",
      "em",
      "text",
      "code",
    ]);
  });

  it("leaves an unterminated emphasis run literal", () => {
    // This is the streaming case: `**NVD` arrives before its closing `**`.
    const nodes = parseInline("gain of **NVD");
    expect(nodes).toEqual([{ type: "text", value: "gain of **NVD" }]);
  });

  it("does not treat intraword underscores as emphasis", () => {
    // The assistant names its own tools; `get_portfolio` must survive.
    expect(text(parseInline("call get_portfolio then get_position"))).toBe(
      "call get_portfolio then get_position",
    );
    expect(parseInline("get_portfolio").every((n) => n.type === "text")).toBe(
      true,
    );
  });

  it("does not treat spaced asterisks as emphasis", () => {
    expect(parseInline("3 * 4 = 12")).toEqual([
      { type: "text", value: "3 * 4 = 12" },
    ]);
  });

  it("keeps code span contents literal", () => {
    const nodes = parseInline("`**not bold**`");
    expect(nodes).toEqual([{ type: "code", value: "**not bold**" }]);
  });

  it("parses links", () => {
    const nodes = parseInline("see [NVDA](/position/NVDA) now");
    expect(nodes[1]).toEqual({
      type: "link",
      href: "/position/NVDA",
      children: [{ type: "text", value: "NVDA" }],
    });
  });

  it("leaves a half-written link literal", () => {
    expect(text(parseInline("see [NVDA](/pos"))).toBe("see [NVDA](/pos");
  });
});

describe("parseMarkdown", () => {
  it("parses headings by level", () => {
    const blocks = parseMarkdown("## Risk\n\n### Detail");
    expect(blocks[0]).toMatchObject({ type: "heading", level: 2 });
    expect(blocks[1]).toMatchObject({ type: "heading", level: 3 });
  });

  it("parses bullet and ordered lists", () => {
    const [bullets, numbers] = parseMarkdown("- a\n- b\n\n1. x\n2. y");
    expect(bullets).toMatchObject({ type: "list", ordered: false });
    expect(numbers).toMatchObject({ type: "list", ordered: true });
    expect((bullets as Extract<Block, { type: "list" }>).items).toHaveLength(2);
  });

  it("parses a table with alignment", () => {
    const [block] = parseMarkdown(
      "| Ticker | Value |\n| --- | ---: |\n| NVDA | $32,301 |\n| VOO | $83,492 |",
    );
    const table = block as Extract<Block, { type: "table" }>;
    expect(table.type).toBe("table");
    expect(table.align).toEqual(["left", "right"]);
    expect(table.rows).toHaveLength(2);
    expect(text(table.header[0])).toBe("Ticker");
    expect(text(table.rows[1][1])).toBe("$83,492");
  });

  it("renders a table whose delimiter row has not streamed yet as text", () => {
    const [block] = parseMarkdown("| Ticker | Value |");
    expect(block.type).toBe("paragraph");
  });

  it("closes an unterminated code fence at end of input", () => {
    const [block] = parseMarkdown("```ts\nconst a = 1;");
    expect(block).toEqual({ type: "code", lang: "ts", value: "const a = 1;" });
  });

  it("keeps block markers inside a fence literal", () => {
    const [block] = parseMarkdown("```\n# not a heading\n- not a list\n```");
    expect(block).toMatchObject({
      type: "code",
      value: "# not a heading\n- not a list",
    });
  });

  it("ends a paragraph at the line that starts the next block", () => {
    const blocks = parseMarkdown("Here is the split:\n- NVDA\n- VOO");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "list"]);
  });

  it("joins wrapped paragraph lines into one block", () => {
    const blocks = parseMarkdown("one line\nand its continuation");
    expect(blocks).toHaveLength(1);
    expect(text((blocks[0] as Extract<Block, { type: "paragraph" }>).children)).toBe(
      "one line and its continuation",
    );
  });

  it("parses quotes and rules", () => {
    const blocks = parseMarkdown("> careful\n\n---");
    expect(blocks.map((b) => b.type)).toEqual(["quote", "rule"]);
  });

  it("returns no blocks for empty or whitespace input", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("\n  \n")).toEqual([]);
  });

  it("terminates on every prefix of a realistic answer", () => {
    // The renderer is called on each streaming delta, so every prefix must
    // parse without throwing or hanging.
    const full = [
      "## Concentration",
      "",
      "**NVDA** is 15.9% of the book.",
      "",
      "| Ticker | Weight |",
      "| --- | ---: |",
      "| NVDA | 15.9% |",
      "",
      "- QQQ holds it too",
      "",
      "> Watch the overlap.",
      "",
      "```json",
      '{"a": 1}',
      "```",
    ].join("\n");
    for (let i = 0; i <= full.length; i++) {
      expect(() => parseMarkdown(full.slice(0, i))).not.toThrow();
    }
  });
});
