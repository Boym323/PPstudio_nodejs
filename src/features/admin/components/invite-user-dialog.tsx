"use client";

import { useActionState, useEffect, useRef, type RefObject } from "react";
import { useFormStatus } from "react-dom";

import {
  initialAdminUserAccessActionState,
  type AdminUserAccessActionState,
} from "@/features/admin/actions/update-admin-user-access-action-state";
import { saveAdminUserAccessAction } from "@/features/admin/actions/admin-user-actions";
import * as Dialog from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

type InviteUserDialogProps = {
  open: boolean;
  mode: "invite" | "edit";
  initialValues?: {
    id: string;
    name: string;
    email: string;
    role: "OWNER" | "SALON";
  } | null;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
};

export function InviteUserDialog({
  open,
  mode,
  initialValues,
  returnFocusRef,
  onClose,
}: InviteUserDialogProps) {
  const { toast } = useToast();
  const [serverState, formAction] = useActionState(
    saveAdminUserAccessAction,
    initialAdminUserAccessActionState,
  );
  const previousStatus = useRef<AdminUserAccessActionState["status"]>("idle");

  useEffect(() => {
    if (
      previousStatus.current !== "success" &&
      serverState.status === "success"
    ) {
      toast({ message: serverState.successMessage ?? (mode === "invite" ? "Pozvánka byla odeslána." : "Změny byly uloženy.") });
      onClose();
    }

    previousStatus.current = serverState.status;
  }, [mode, onClose, serverState.formError, serverState.status, serverState.successMessage, toast]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content
          className="rounded-[1.7rem] border border-white/10 bg-[#131116] p-5 shadow-[0_20px_70px_rgba(0,0,0,0.45)] sm:p-6"
          onCloseAutoFocus={(event) => {
            if (returnFocusRef?.current) {
              event.preventDefault();
              returnFocusRef.current.focus();
            }
          }}
        >
          <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--color-accent-soft)]">
                {mode === "invite" ? "Nový přístup" : "Úprava přístupu"}
              </p>
              <Dialog.Title>
                {mode === "invite" ? "Pozvat uživatele" : "Upravit uživatele"}
              </Dialog.Title>
              <Dialog.Description>
                {mode === "invite"
                  ? "Jednoduché založení přístupu bez složitých oprávnění navíc."
                  : "Upravte jméno a e-mail tak, aby byl přístup v evidenci dobře čitelný."}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="min-h-11 min-w-11 rounded-full border border-white/10 px-3 py-2 text-sm text-white/72 transition hover:border-white/18 hover:bg-white/6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
              >
                Zavřít
              </button>
            </Dialog.Close>
          </div>

          <form action={formAction} className="mt-5 space-y-4">
            <input type="hidden" name="userId" value={initialValues?.id ?? ""} />
            {mode === "edit" ? (
              <input type="hidden" name="role" value={initialValues?.role ?? "SALON"} />
            ) : null}

            {serverState.status === "error" && serverState.formError ? (
              <div className="rounded-[1rem] border border-red-300/16 bg-red-400/10 px-4 py-3 text-sm leading-6 text-red-50">
                {serverState.formError}
              </div>
            ) : null}

            <Field
              label="Jméno"
              name="name"
              defaultValue={initialValues?.name ?? ""}
              placeholder="Např. Petra Nováková"
              error={serverState.fieldErrors?.name}
            />

            <Field
              label="E-mail"
              name="email"
              type="email"
              defaultValue={initialValues?.email ?? ""}
              placeholder="napr. petra@ppstudio.cz"
              error={serverState.fieldErrors?.email}
            />

            <label className="block">
              <span className="text-sm font-medium text-white">Role</span>
              <select
                name="role"
                defaultValue={initialValues?.role ?? "SALON"}
                disabled={mode === "edit"}
                className={cn(
                  "mt-2 w-full rounded-[1rem] border border-white/8 bg-black/20 px-3.5 py-3 text-sm text-white outline-none transition focus:border-[var(--color-accent)]/55 focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/45",
                  serverState.fieldErrors?.role ? "border-red-300/40" : "",
                  mode === "edit" ? "cursor-not-allowed opacity-70" : "",
                )}
              >
                <option value="OWNER">OWNER</option>
                <option value="SALON">SALON</option>
              </select>
              {serverState.fieldErrors?.role ? (
                <p className="mt-2 text-sm text-red-300">{serverState.fieldErrors.role}</p>
              ) : (
                <span className="mt-1.5 block text-xs leading-5 text-white/42">
                  {mode === "invite"
                    ? "V systému jsou pouze dvě role: OWNER a SALON."
                    : "Role se mění samostatně přes akci „Změnit roli“ přímo v řádku uživatele."}
                </span>
              )}
            </label>

            <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-full border border-white/10 px-4 py-2.5 text-sm text-white/80 transition hover:border-white/18 hover:bg-white/6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                >
                  Zrušit
                </button>
              </Dialog.Close>
              <SubmitButton mode={mode} />
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Field({
  label,
  name,
  defaultValue,
  placeholder,
  type = "text",
  error,
}: {
  label: string;
  name: string;
  defaultValue: string;
  placeholder: string;
  type?: string;
  error?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-white">{label}</span>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className={cn(
          "mt-2 w-full rounded-[1rem] border border-white/8 bg-black/20 px-3.5 py-3 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-[var(--color-accent)]/55 focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/45",
          error ? "border-red-300/40" : "",
        )}
      />
      {error ? <p className="mt-2 text-sm text-red-300">{error}</p> : null}
    </label>
  );
}

function SubmitButton({ mode }: { mode: "invite" | "edit" }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="min-w-36 rounded-full bg-[var(--color-accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:cursor-not-allowed"
    >
      {pending ? "Ukládám…" : mode === "invite" ? "Odeslat pozvánku" : "Uložit změny"}
    </button>
  );
}
