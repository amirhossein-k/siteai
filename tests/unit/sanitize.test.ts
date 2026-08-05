import { describe, expect, it } from "vitest";
import { sanitizeOptional, sanitizePlainText } from "@/lib/sanitize";

describe("sanitizePlainText", () => {
  it("returns the input unchanged when falsy", () => {
    expect(sanitizePlainText("")).toBe("");
  });

  it("strips HTML tags but keeps their text content", () => {
    expect(sanitizePlainText("<script>alert(1)</script>hello")).toBe(
      "alert(1)hello"
    );
    expect(sanitizePlainText("<p>متن <b>bold</b></p>")).toBe("متن bold");
  });

  it("removes javascript: URLs", () => {
    expect(sanitizePlainText("javascript:alert(1)")).toBe("alert(1)");
    expect(sanitizePlainText("JAVASCRIPT:alert(1)")).toBe("alert(1)");
  });

  it("removes on* event handlers (requires preceding whitespace)", () => {
    expect(sanitizePlainText(' onclick="alert(1)"')).toBe("");
    expect(sanitizePlainText(" onerror=alert(1)")).toBe("");
    expect(sanitizePlainText("سلام onload='x' دنیا")).toBe("سلام دنیا");
  });

  it("strips a full XSS tag including its event handler", () => {
    const input =
      '<img src=x onerror="alert(1)"><a href="javascript:void(0)">link</a>';
    expect(sanitizePlainText(input)).toBe("link");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizePlainText("  hello  ")).toBe("hello");
  });
});

describe("sanitizeOptional", () => {
  it("returns undefined for null/undefined", () => {
    expect(sanitizeOptional(undefined)).toBeUndefined();
    expect(sanitizeOptional(null)).toBeUndefined();
  });

  it("passes an empty string through unchanged", () => {
    expect(sanitizeOptional("")).toBe("");
  });

  it("sanitizes provided values", () => {
    expect(sanitizeOptional("<b>x</b>")).toBe("x");
    expect(sanitizeOptional("  javascript:alert(1) ")).toBe("alert(1)");
  });
});
