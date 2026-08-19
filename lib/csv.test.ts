import { describe, expect, it } from "vitest";
import { parseCsv, sniffDelimiter, toPreviewText } from "./csv";

describe("parseCsv", () => {
  it("parses a plain comma file", () => {
    expect(parseCsv("type,amount,currency\nCash,1000,usd")).toEqual([
      ["type", "amount", "currency"],
      ["Cash", "1000", "usd"],
    ]);
  });

  it("honours quoted fields containing the delimiter", () => {
    expect(parseCsv('label,amount\n"Monobank, black",8753')).toEqual([
      ["label", "amount"],
      ["Monobank, black", "8753"],
    ]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseCsv('label\n"He said ""hi"""')).toEqual([
      ["label"],
      ['He said "hi"'],
    ]);
  });

  it("keeps newlines inside a quoted field", () => {
    const [, row] = parseCsv('label,note\nCash,"line one\nline two"');
    expect(row).toEqual(["Cash", "line one\nline two"]);
  });

  it("handles CRLF endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("strips a UTF-8 BOM so the first header still matches", () => {
    // Exports from Excel routinely carry one; without this the first column is
    // named "﻿Account" and every header lookup misses.
    const [header] = parseCsv("﻿Account,Balance\nCash,10");
    expect(header[0]).toBe("Account");
  });

  it("drops entirely blank rows, including a trailing newline", () => {
    expect(parseCsv("a,b\n1,2\n\n\n")).toHaveLength(2);
  });

  it("returns nothing for empty input", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n \n")).toEqual([]);
  });
});

describe("sniffDelimiter", () => {
  it("finds comma, semicolon, tab and pipe", () => {
    expect(sniffDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(sniffDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(sniffDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
    expect(sniffDelimiter("a|b|c\n1|2|3")).toBe("|");
  });

  it("prefers semicolon when commas are decimal separators", () => {
    // The European export shape: `1,50` is one number, not two columns. Naive
    // occurrence-counting picks the comma here and shreds every row.
    const text = "Konto;Saldo;Waehrung\nGiro;1234,56;EUR\nSpar;9876,54;EUR";
    expect(sniffDelimiter(text)).toBe(";");
    expect(parseCsv(text)[1]).toEqual(["Giro", "1234,56", "EUR"]);
  });

  it("falls back to comma when nothing splits", () => {
    expect(sniffDelimiter("justonecolumn")).toBe(",");
  });
});

describe("toPreviewText", () => {
  it("caps the rows it renders", () => {
    const rows = Array.from({ length: 100 }, (_, i) => [`r${i}`, "1"]);
    const text = toPreviewText(rows, 5);
    expect(text.split("\n")).toHaveLength(5);
    expect(text).toContain("r0 | 1");
    expect(text).not.toContain("r5 |");
  });
});
