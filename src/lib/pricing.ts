import type {
  PaymentPriceAdjustment,
  PaymentPriceAdjustments,
  StoreDiscountCoupon,
} from "@/lib/cloud-sync";

export type PaymentMethod = "efectivo" | "transferencia" | "tarjeta o mercado pago";

export const DEFAULT_PAYMENT_PRICE_ADJUSTMENTS: PaymentPriceAdjustments = {
  efectivo: { mode: "none", percent: 0 },
  transferencia: { mode: "none", percent: 0 },
  "tarjeta o mercado pago": { mode: "none", percent: 0 },
};

export function normalizeCouponCode(code: string) {
  return code.trim().toLocaleUpperCase("es-AR");
}

export function paymentAdjustmentFor(
  method: PaymentMethod | undefined,
  adjustments?: PaymentPriceAdjustments,
): PaymentPriceAdjustment {
  if (!method) return { mode: "none", percent: 0 };
  return adjustments?.[method] ?? { mode: "none", percent: 0 };
}

export function adjustedServicePrice(
  price: number,
  adjustment: PaymentPriceAdjustment,
) {
  if (adjustment.mode === "none" || adjustment.percent <= 0) return Math.round(price);
  const factor = adjustment.mode === "discount" ? 1 - adjustment.percent / 100 : 1 + adjustment.percent / 100;
  return Math.max(0, Math.round(price * factor));
}

export function couponForCode(coupons: StoreDiscountCoupon[] | undefined, code: string) {
  const normalizedCode = normalizeCouponCode(code);
  return (coupons ?? []).find(
    (coupon) => coupon.active && normalizeCouponCode(coupon.code) === normalizedCode,
  );
}

export function calculateBookingPrice(
  servicePrices: number[],
  method: PaymentMethod | undefined,
  adjustments: PaymentPriceAdjustments | undefined,
  coupons: StoreDiscountCoupon[] | undefined,
  couponCode = "",
) {
  const adjustment = paymentAdjustmentFor(method, adjustments);
  const basePrice = servicePrices.reduce((sum, price) => sum + Math.round(price), 0);
  const adjustedSubtotal = servicePrices.reduce(
    (sum, price) => sum + adjustedServicePrice(price, adjustment),
    0,
  );
  const coupon = couponCode ? couponForCode(coupons, couponCode) : undefined;
  const couponDiscountAmount = coupon
    ? Math.min(
        adjustedSubtotal,
        coupon.discountType === "percent"
          ? Math.round((adjustedSubtotal * coupon.discountValue) / 100)
          : Math.round(coupon.discountValue),
      )
    : 0;
  const totalPrice = Math.max(0, adjustedSubtotal - couponDiscountAmount);
  return {
    basePrice,
    adjustedSubtotal,
    coupon,
    couponDiscountAmount,
    paymentAdjustmentMode: adjustment.mode,
    paymentAdjustmentPercent: adjustment.percent,
    paymentAdjustmentAmount: adjustedSubtotal - Math.round(basePrice),
    totalPrice,
  };
}