import type { Money } from "@reference-systems-lab/commerce-api";

/**
 * Formats a price from the backend, an integer count of the currency's minor units, as a label such
 * as "$24.00". The backend decides prices; this only displays them. The amount is turned into a
 * decimal string, never divided, so no floating-point rounding can change it.
 */
export function formatMoney({ amount, currency }: Money): string {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError(`A price must be a whole number of minor units, not ${amount}.`);
  }
  const format = new Intl.NumberFormat("en-US", { style: "currency", currency });
  // The fraction digits the currency uses, read from how it formats zero: "$0.00" has two, "¥0" none.
  const fraction = format.formatToParts(0).find((part) => part.type === "fraction");
  const digits = fraction?.value.length ?? 0;
  return format.format(toDecimal(amount, digits));
}

function toDecimal(amount: number, digits: number): `${number}` {
  const sign = amount < 0 ? "-" : "";
  const units = Math.abs(amount)
    .toString()
    .padStart(digits + 1, "0");
  const whole = digits === 0 ? units : `${units.slice(0, -digits)}.${units.slice(-digits)}`;
  return `${sign}${whole}` as `${number}`;
}
