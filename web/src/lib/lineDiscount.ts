type DiscountType = 'percentage' | 'fixed';

interface StoredLine {
  discountValue?: number | string | null;
  discountType?: DiscountType;
  discountPercentage?: number | string | null;
  discount?: number | string | null;
}

interface FormLine {
  quantity?: number | string | null;
  rate?: number | string | null;
  discountValue?: number | string | null;
  discountType?: DiscountType;
}

const num = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

// an emptied `valueAsNumber` input reads back as NaN
const isSet = (value: unknown) =>
  value !== null && value !== undefined && value !== '' && !Number.isNaN(value);

// `discountType` is form-only and never stored: a saved line is "%" exactly when it
// carries a percentage, otherwise its ₹ amount is in `discount`.
export function storedLineDiscount(line: StoredLine): {
  value: number | string;
  type: DiscountType;
} {
  if (isSet(line.discountValue)) {
    return { value: line.discountValue!, type: line.discountType ?? 'percentage' };
  }
  if (isSet(line.discountPercentage)) {
    return { value: line.discountPercentage!, type: 'percentage' };
  }
  if (num(line.discount) > 0) return { value: line.discount!, type: 'fixed' };
  return { value: '', type: 'percentage' };
}

export function lineGross(line: FormLine): number {
  return num(line.quantity) * num(line.rate);
}

// Capped at the line's value, so the lines always sum to the document total.
export function lineDiscountAmount(line: FormLine): number {
  const gross = lineGross(line);
  const value = Math.max(0, num(line.discountValue));
  const amount =
    (line.discountType ?? 'percentage') === 'percentage' ? (gross * value) / 100 : value;
  return Math.min(amount, gross);
}

export function lineDiscountError(line: FormLine): string | null {
  if (!isSet(line.discountValue)) return null;
  const value = Number(line.discountValue);
  if (!Number.isFinite(value)) return 'Discount must be a number.';
  if (value < 0) return 'Discount cannot be negative.';
  if ((line.discountType ?? 'percentage') === 'percentage') {
    return value > 100 ? 'Discount cannot exceed 100%.' : null;
  }
  // compare in paise, as the server does, so float noise in qty × rate never rejects an exact amount
  return Math.round(value * 100) > Math.round(lineGross(line) * 100)
    ? 'Discount cannot exceed the line amount.'
    : null;
}
