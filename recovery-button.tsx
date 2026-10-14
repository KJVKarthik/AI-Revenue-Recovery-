"use client";

import { useActionState } from "react";
import {
  cancelRecovery,
  completeRecoveryManually,
  createRecoveryPaymentLink,
  startRecovery,
  syncRecoveryPaymentLink,
  type RecoveryActionState,
} from "@/app/actions";

const initialState: RecoveryActionState = {};
const primaryButton =
  "rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400";
const secondaryButton =
  "rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400";
const dangerButton =
  "rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:text-rose-300";

type ActiveRecovery = {
  id: string;
  status: string;
  paymentLinkUrl: string | null;
};

export function RecoveryActions({
  paymentId,
  recovery,
  razorpayConfigured,
}: {
  paymentId: string;
  recovery: ActiveRecovery | null;
  razorpayConfigured: boolean;
}) {
  const startRecoveryForPayment = startRecovery.bind(null, paymentId);
  const createPaymentLink = createRecoveryPaymentLink.bind(null, recovery?.id || "");
  const syncPaymentLink = syncRecoveryPaymentLink.bind(null, recovery?.id || "");
  const cancelActiveRecovery = cancelRecovery.bind(null, recovery?.id || "");
  const completeManually = completeRecoveryManually.bind(null, recovery?.id || "");
  const [startState, startFormAction, starting] = useActionState(
    startRecoveryForPayment,
    initialState,
  );
  const [linkState, linkFormAction, creatingLink] = useActionState(
    createPaymentLink,
    initialState,
  );
  const [syncState, syncFormAction, syncing] = useActionState(
    syncPaymentLink,
    initialState,
  );
  const [cancelState, cancelFormAction, cancelling] = useActionState(
    cancelActiveRecovery,
    initialState,
  );
  const [manualState, manualFormAction, completingManually] = useActionState(
    completeManually,
    initialState,
  );

  if (!recovery) {
    return (
      <ActionForm action={startFormAction} error={startState.error}>
        <button className={primaryButton} disabled={starting} type="submit">
          {starting ? "Starting…" : "Start recovery"}
        </button>
      </ActionForm>
    );
  }

  if (recovery.status === "LINK_CREATED") {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        {recovery.paymentLinkUrl ? (
          <a
            className={primaryButton}
            href={recovery.paymentLinkUrl}
            rel="noreferrer"
            target="_blank"
          >
            Open payment link
          </a>
        ) : null}
        <ActionForm action={syncFormAction} error={syncState.error}>
          <button className={secondaryButton} disabled={syncing} type="submit">
            {syncing ? "Syncing…" : "Sync status"}
          </button>
        </ActionForm>
        <ActionForm action={cancelFormAction} error={cancelState.error}>
          <button className={dangerButton} disabled={cancelling} type="submit">
            {cancelling ? "Cancelling…" : "Cancel"}
          </button>
        </ActionForm>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {razorpayConfigured ? (
        <ActionForm action={linkFormAction} error={linkState.error}>
          <button className={primaryButton} disabled={creatingLink} type="submit">
            {creatingLink
              ? "Creating…"
              : recovery.status === "FAILED"
                ? "Retry payment link"
                : "Create payment link"}
          </button>
        </ActionForm>
      ) : (
        <span className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20">
          Razorpay setup required
        </span>
      )}
      <ActionForm action={manualFormAction} error={manualState.error}>
        <button className={secondaryButton} disabled={completingManually} type="submit">
          {completingManually ? "Completing…" : "Mark paid manually"}
        </button>
      </ActionForm>
      <ActionForm action={cancelFormAction} error={cancelState.error}>
        <button className={dangerButton} disabled={cancelling} type="submit">
          {cancelling ? "Cancelling…" : "Cancel"}
        </button>
      </ActionForm>
    </div>
  );
}

function ActionForm({
  action,
  children,
  error,
}: {
  action: (formData: FormData) => void;
  children: React.ReactNode;
  error?: string;
}) {
  return (
    <form action={action}>
      {children}
      {error ? (
        <p aria-live="polite" className="mt-2 max-w-44 text-right text-xs text-rose-600">
          {error}
        </p>
      ) : null}
    </form>
  );
}
