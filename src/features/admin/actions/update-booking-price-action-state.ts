export type UpdateBookingPriceActionState = {
  status: "idle" | "success" | "error";
  conflict?: boolean;
  successMessage?: string;
  formError?: string;
  fieldErrors?: Partial<Record<"finalPriceCzk" | "priceAdjustmentReason", string>>;
};

export const initialUpdateBookingPriceActionState: UpdateBookingPriceActionState = {
  status: "idle",
};
