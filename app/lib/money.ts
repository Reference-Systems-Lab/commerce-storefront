import type { Money } from "@reference-systems-lab/commerce-api";

/**
 * ISO 4217 minor units for the currencies where they differ from the display digits Intl takes from
 * CLDR. The backend's amounts are in ISO 4217 minor units, so these decide where the decimal point
 * goes. From ISO 4217 List One (published 2026-09-17), compared with ICU 78.3 (Node 24 and 26).
 */
const ISO_MINOR_UNITS: Readonly<Record<string, number>> = {
  AFN: 2,
  ALL: 2,
  COP: 2,
  HUF: 2,
  IDR: 2,
  IQD: 3,
  IRR: 2,
  KPW: 2,
  LAK: 2,
  LBP: 2,
  MGA: 2,
  MMK: 2,
  PKR: 2,
  SOS: 2,
  SYP: 2,
  YER: 2,
};

/**
 * Formats a price from the backend, an integer count of the currency's ISO 4217 minor units, as a
 * label such as "$24.00". The backend decides prices; this only displays them. The amount is turned
 * into a decimal string, never divided, so no floating-point rounding can change it.
 */
export function formatMoney({ amount, currency }: Money): string {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError(`A price must be a whole number of minor units, not ${amount}.`);
  }
  const digits = ISO_MINOR_UNITS[currency] ?? displayDigits(currency);
  const format = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return format.format(toDecimal(amount, digits));
}

/** The fraction digits Intl shows for a currency, read from how it formats zero: "$0.00" has two. */
function displayDigits(currency: string): number {
  const format = new Intl.NumberFormat("en-US", { style: "currency", currency });
  const fraction = format.formatToParts(0).find((part) => part.type === "fraction");
  return fraction?.value.length ?? 0;
}

function toDecimal(amount: number, digits: number): `${number}` {
  const sign = amount < 0 ? "-" : "";
  const units = Math.abs(amount)
    .toString()
    .padStart(digits + 1, "0");
  const whole = digits === 0 ? units : `${units.slice(0, -digits)}.${units.slice(-digits)}`;
  return `${sign}${whole}` as `${number}`;
}
