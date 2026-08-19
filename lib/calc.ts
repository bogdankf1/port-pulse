import { z } from "zod";

/**
 * A closed arithmetic evaluator for the assistant's `calculate` tool.
 *
 * Deliberately not `eval`, `new Function`, or any expression library: the input
 * is model-generated text, and the only safe way to keep it read-only is for
 * the grammar to contain nothing that can reach outside itself. There are no
 * identifiers, no property access, no function calls — a token that is not a
 * number, an operator, or a parenthesis is a parse error, so there is nothing
 * to escape into.
 *
 * Recursive descent over:
 *   expr   := term (('+' | '-') term)*
 *   term   := unary (('*' | '/') unary)*
 *   unary  := ('-' | '+')* power
 *   power  := primary ('^' unary)?          right-associative
 *   primary:= NUMBER | '(' expr ')'
 */

export class CalcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalcError";
  }
}

type Token =
  | { type: "num"; value: number }
  | { type: "op"; value: "+" | "-" | "*" | "/" | "^" }
  | { type: "paren"; value: "(" | ")" };

const OPERATORS = new Set(["+", "-", "*", "/", "^"]);

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (ch === " " || ch === "\t" || ch === "\n") {
      i++;
      continue;
    }

    if (ch >= "0" && ch <= "9") {
      let j = i;
      for (;;) {
        while (j < src.length && /[0-9]/.test(src[j])) j++;
        // A separator belongs to the number only in true thousands position —
        // `32,301.78` is one figure, while `1,2` is two and stays an error.
        if (
          (src[j] === "," || src[j] === "_") &&
          /^[0-9]{3}(?![0-9])/.test(src.slice(j + 1))
        ) {
          j++;
          continue;
        }
        break;
      }
      if (src[j] === ".") {
        j++;
        while (j < src.length && /[0-9]/.test(src[j])) j++;
      }
      let value = Number(src.slice(i, j).replace(/[,_]/g, ""));
      i = j;
      // `15%` means 0.15. Percentages are how the model states weights and
      // returns, so rejecting them would push it back to doing the arithmetic
      // in its head — the exact thing this tool exists to prevent.
      if (src[i] === "%") {
        value = value / 100;
        i++;
      }
      if (!Number.isFinite(value)) throw new CalcError("Malformed number");
      tokens.push({ type: "num", value });
      continue;
    }

    if (ch === ".") {
      let j = i + 1;
      while (j < src.length && /[0-9]/.test(src[j])) j++;
      if (j === i + 1) throw new CalcError(`Unexpected character "."`);
      tokens.push({ type: "num", value: Number(src.slice(i, j)) });
      i = j;
      continue;
    }

    if (OPERATORS.has(ch)) {
      tokens.push({ type: "op", value: ch as "+" | "-" | "*" | "/" | "^" });
      i++;
      continue;
    }

    if (ch === "(" || ch === ")") {
      tokens.push({ type: "paren", value: ch });
      i++;
      continue;
    }

    // Currency and grouping symbols carry no arithmetic meaning; anything else
    // is a genuine error rather than something to skip past silently.
    if (ch === "$" || ch === "€" || ch === "£") {
      i++;
      continue;
    }

    throw new CalcError(`Unexpected character ${JSON.stringify(ch)}`);
  }

  return tokens;
}

export function evaluate(expression: string): number {
  const tokens = tokenize(expression);
  if (tokens.length === 0) throw new CalcError("Empty expression");

  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];

  function parseExpr(): number {
    let left = parseTerm();
    for (;;) {
      const t = peek();
      if (t?.type === "op" && (t.value === "+" || t.value === "-")) {
        pos++;
        const right = parseTerm();
        left = t.value === "+" ? left + right : left - right;
        continue;
      }
      return left;
    }
  }

  function parseTerm(): number {
    let left = parseUnary();
    for (;;) {
      const t = peek();
      if (t?.type === "op" && (t.value === "*" || t.value === "/")) {
        pos++;
        const right = parseUnary();
        if (t.value === "/" && right === 0) {
          throw new CalcError("Division by zero");
        }
        left = t.value === "*" ? left * right : left / right;
        continue;
      }
      return left;
    }
  }

  function parseUnary(): number {
    const t = peek();
    if (t?.type === "op" && (t.value === "-" || t.value === "+")) {
      pos++;
      const value = parseUnary();
      return t.value === "-" ? -value : value;
    }
    return parsePower();
  }

  function parsePower(): number {
    const base = parsePrimary();
    const t = peek();
    if (t?.type === "op" && t.value === "^") {
      pos++;
      // Right-associative, and the exponent may be signed: 2^-1.
      return Math.pow(base, parseUnary());
    }
    return base;
  }

  function parsePrimary(): number {
    const t = peek();
    if (!t) throw new CalcError("Unexpected end of expression");
    if (t.type === "num") {
      pos++;
      return t.value;
    }
    if (t.type === "paren" && t.value === "(") {
      pos++;
      const value = parseExpr();
      const close = peek();
      if (close?.type !== "paren" || close.value !== ")") {
        throw new CalcError("Unbalanced parentheses");
      }
      pos++;
      return value;
    }
    throw new CalcError(`Unexpected ${t.type === "op" ? `operator "${t.value}"` : "token"}`);
  }

  const result = parseExpr();
  if (pos !== tokens.length) throw new CalcError("Unexpected trailing input");
  if (!Number.isFinite(result)) {
    throw new CalcError("Result is not a finite number");
  }
  return result;
}

export const calculateSchema = z.object({
  expression: z
    .string()
    .min(1)
    .max(400)
    .describe(
      "Arithmetic only: numbers, + - * / ^, parentheses. Accepts $, thousands " +
        "separators and percent literals, so `204,593.81 * 15.9%` is valid. " +
        "No variables or functions.",
    ),
});
