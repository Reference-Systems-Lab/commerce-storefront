import { describe, expect, it } from "vitest";
import { formatMoney } from "./money";

describe("formatMoney", () => {
  it.each([
    [2400, "USD", "$24.00"],
    [1, "USD", "$0.01"],
    [0, "USD", "$0.00"],
    [-150, "USD", "-$1.50"],
    [500, "JPY", "¥500"],
    // Node's ICU separates the code from the number with a no-break space.
    [1234, "KWD", "KWD\u00a01.234"],
    // ISO 4217 has minor units where CLDR shows none: the amount mustn't come out 100× too large.
    [12345, "IDR", "IDR\u00a0123.45"],
    [1234, "IQD", "IQD\u00a01.234"],
  ])("formats %i %s as %s", (amount, currency, label) => {
    expect(formatMoney({ amount, currency })).toBe(label);
  });

  it("refuses an amount that isn't a whole number of minor units", () => {
    expect(() => formatMoney({ amount: 24.5, currency: "USD" })).toThrow(RangeError);
  });
});
