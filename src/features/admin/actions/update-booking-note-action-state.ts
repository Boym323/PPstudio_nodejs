export type UpdateBookingNoteActionState = {
  status: "idle" | "success" | "error";
  conflict?: boolean;
  successMessage?: string;
  formError?: string;
  fieldErrors?: Partial<Record<"internalNote", string>>;
};

export const initialUpdateBookingNoteActionState: UpdateBookingNoteActionState = {
  status: "idle",
};
