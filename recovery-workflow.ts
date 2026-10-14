import {
  PaymentStatus,
  RecoveryStatus,
  type Prisma,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

type TransactionClient = Prisma.TransactionClient;

type PaymentLinkState = {
  paymentLinkId: string;
  status: string;
  amountPaidInPaise?: number;
  externalPaymentId?: string | null;
};

type PaymentLinkReconciliation =
  | "missing"
  | "recovered"
  | "updated"
  | "unchanged";

function normalizePaymentLinkStatus(status: string) {
  return status.trim().toLowerCase();
}

async function reconcilePaymentLinkInTransaction(
  tx: TransactionClient,
  input: PaymentLinkState,
): Promise<PaymentLinkReconciliation> {
  const recovery = await tx.recovery.findUnique({
    where: { paymentLinkId: input.paymentLinkId },
    include: { payment: true },
  });

  if (!recovery) {
    return "missing";
  }

  const status = normalizePaymentLinkStatus(input.status);
  const externalPaymentId = input.externalPaymentId || recovery.externalPaymentId;

  if (status === "paid") {
    if (recovery.status === RecoveryStatus.COMPLETED) {
      if (
        recovery.paymentLinkStatus !== status ||
        externalPaymentId !== recovery.externalPaymentId
      ) {
        await tx.recovery.update({
          where: { id: recovery.id },
          data: {
            paymentLinkStatus: status,
            externalPaymentId,
          },
        });
      }

      return "unchanged";
    }

    const recoveredAmount = input.amountPaidInPaise
      ? Math.round(input.amountPaidInPaise / 100)
      : recovery.payment.amount;

    await tx.recovery.update({
      where: { id: recovery.id },
      data: {
        status: RecoveryStatus.COMPLETED,
        paymentLinkStatus: status,
        externalPaymentId,
        recoveredAmount,
        completedAt: new Date(),
      },
    });
    await tx.payment.update({
      where: { id: recovery.paymentId },
      data: { status: PaymentStatus.RECOVERED },
    });
    await tx.auditLog.create({
      data: {
        paymentId: recovery.paymentId,
        event: "PAYMENT_RECOVERED",
        details: `Razorpay confirmed payment-link ${input.paymentLinkId} as paid.`,
      },
    });

    return "recovered";
  }

  const recoveryStatus =
    status === "cancelled"
      ? RecoveryStatus.CANCELLED
      : status === "expired"
        ? RecoveryStatus.EXPIRED
        : null;

  if (!recoveryStatus) {
    if (recovery.paymentLinkStatus !== status) {
      await tx.recovery.update({
        where: { id: recovery.id },
        data: { paymentLinkStatus: status },
      });
      return "updated";
    }

    return "unchanged";
  }

  if (
    recovery.status === recoveryStatus &&
    recovery.paymentLinkStatus === status
  ) {
    return "unchanged";
  }

  await tx.recovery.update({
    where: { id: recovery.id },
    data: {
      status: recoveryStatus,
      paymentLinkStatus: status,
    },
  });
  await tx.auditLog.create({
    data: {
      paymentId: recovery.paymentId,
      event:
        recoveryStatus === RecoveryStatus.CANCELLED
          ? "RECOVERY_CANCELLED"
          : "PAYMENT_LINK_EXPIRED",
      details: `Razorpay payment link ${input.paymentLinkId} is ${status}.`,
    },
  });

  return "updated";
}

export async function recordPaymentLinkCreated({
  recoveryId,
  paymentLinkId,
  paymentLinkUrl,
  paymentLinkStatus,
  expiresAt,
}: {
  recoveryId: string;
  paymentLinkId: string;
  paymentLinkUrl: string;
  paymentLinkStatus: string;
  expiresAt: Date | null;
}) {
  return prisma.$transaction(async (tx) => {
    const recovery = await tx.recovery.findUnique({
      where: { id: recoveryId },
      include: { payment: true },
    });

    if (!recovery) {
      return { status: "missing" as const };
    }

    if (recovery.paymentLinkUrl) {
      return {
        status: "existing" as const,
        paymentLinkUrl: recovery.paymentLinkUrl,
      };
    }

    if (
      recovery.status !== RecoveryStatus.PENDING &&
      recovery.status !== RecoveryStatus.FAILED
    ) {
      return { status: "not-active" as const };
    }

    await tx.recovery.update({
      where: { id: recovery.id },
      data: {
        status: RecoveryStatus.LINK_CREATED,
        provider: "RAZORPAY",
        paymentLinkId,
        paymentLinkUrl,
        paymentLinkStatus: normalizePaymentLinkStatus(paymentLinkStatus),
        expiresAt,
      },
    });
    await tx.auditLog.create({
      data: {
        paymentId: recovery.paymentId,
        event: "PAYMENT_LINK_CREATED",
        details: `Razorpay payment link ${paymentLinkId} was created.`,
      },
    });

    return { status: "created" as const, paymentLinkUrl };
  });
}

export async function reconcilePaymentLink(input: PaymentLinkState) {
  return prisma.$transaction((tx) => reconcilePaymentLinkInTransaction(tx, input));
}

export async function cancelRecoveryLocally(recoveryId: string) {
  return prisma.$transaction(async (tx) => {
    const recovery = await tx.recovery.findUnique({
      where: { id: recoveryId },
    });

    if (!recovery) {
      return "missing" as const;
    }

    if (recovery.status === RecoveryStatus.COMPLETED) {
      return "completed" as const;
    }

    if (recovery.status === RecoveryStatus.CANCELLED) {
      return "unchanged" as const;
    }

    await tx.recovery.update({
      where: { id: recovery.id },
      data: {
        status: RecoveryStatus.CANCELLED,
        paymentLinkStatus: recovery.paymentLinkId ? "cancelled" : null,
      },
    });
    await tx.auditLog.create({
      data: {
        paymentId: recovery.paymentId,
        event: "RECOVERY_CANCELLED",
        details: "Recovery workflow cancelled from the dashboard.",
      },
    });

    return "cancelled" as const;
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function getPaymentLinkDetailsFromWebhook(payload: unknown) {
  const root = asRecord(payload);
  const payloadData = asRecord(root?.payload);
  const paymentLink = asRecord(asRecord(payloadData?.payment_link)?.entity);
  const payment = asRecord(asRecord(payloadData?.payment)?.entity);
  const paymentLinkId = asString(paymentLink?.id);

  if (!paymentLinkId) {
    return null;
  }

  return {
    paymentLinkId,
    paymentLinkStatus: asString(paymentLink?.status) || "",
    amountPaidInPaise: asNumber(paymentLink?.amount_paid),
    externalPaymentId:
      asString(payment?.id) || asString(paymentLink?.payment_id),
  };
}

export async function processRazorpayWebhook({
  sourceId,
  event,
  rawBody,
  payload,
}: {
  sourceId: string;
  event: string;
  rawBody: string;
  payload: unknown;
}) {
  const paymentLink = getPaymentLinkDetailsFromWebhook(payload);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.webhookEvent.findUnique({
      where: { sourceId },
    });

    if (existing) {
      return "duplicate" as const;
    }

    const webhookEvent = await tx.webhookEvent.create({
      data: {
        sourceId,
        event,
        paymentLinkId: paymentLink?.paymentLinkId,
        payload: rawBody,
      },
    });

    let outcome: PaymentLinkReconciliation | "ignored" = "ignored";

    if (paymentLink) {
      outcome = await reconcilePaymentLinkInTransaction(tx, {
        paymentLinkId: paymentLink.paymentLinkId,
        status: paymentLink.paymentLinkStatus || event.replace("payment_link.", ""),
        amountPaidInPaise: paymentLink.amountPaidInPaise,
        externalPaymentId: paymentLink.externalPaymentId,
      });
    }

    if (outcome !== "missing") {
      await tx.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { processedAt: new Date() },
      });
    }

    return outcome;
  });
}
