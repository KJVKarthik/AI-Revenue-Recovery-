import { NextResponse } from "next/server";
import { PaymentStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticateWorkspaceApiKey } from "@/lib/security";

const allowedStatuses = new Set(Object.values(PaymentStatus));

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function POST(request: Request) {
  const workspaceId = await authenticateWorkspaceApiKey(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null);
  if (!workspaceId) {
    return NextResponse.json({ error: "A valid workspace API key is required" }, { status: 401 });
  }
  let body: Record<string, unknown> | null;

  try {
    body = asRecord(await request.json());
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  if (!body) {
    return NextResponse.json({ error: "Request body must be an object" }, { status: 400 });
  }

  const customerId = typeof body.customerId === "string" ? body.customerId.trim() : "";
  const amount = body.amount;
  const status = body.status;
  const failureReason = body.failureReason;
  const currency = typeof body.currency === "string" ? body.currency.trim().toUpperCase() : "INR";

  if (!customerId) {
    return NextResponse.json({ error: "customerId is required" }, { status: 400 });
  }

  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "amount must be a positive whole rupee value" },
      { status: 400 },
    );
  }

  if (typeof status !== "string" || !allowedStatuses.has(status as PaymentStatus)) {
    return NextResponse.json(
      { error: `status must be one of: ${Object.values(PaymentStatus).join(", ")}` },
      { status: 400 },
    );
  }

  if (currency.length !== 3) {
    return NextResponse.json({ error: "currency must be a 3-letter code" }, { status: 400 });
  }

  if (failureReason !== undefined && failureReason !== null && typeof failureReason !== "string") {
    return NextResponse.json(
      { error: "failureReason must be a string when provided" },
      { status: 400 },
    );
  }

  try {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, workspaceId: true },
    });

    if (!customer || customer.workspaceId !== workspaceId) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    const payment = await prisma.$transaction(async (tx) => {
      const createdPayment = await tx.payment.create({
        data: {
          customerId: customer.id,
          amount,
          currency,
          status: status as PaymentStatus,
          failureReason: typeof failureReason === "string" ? failureReason.trim() || null : null,
        },
      });

      await tx.auditLog.create({
        data: {
          paymentId: createdPayment.id,
          event: "PAYMENT_CREATED",
          details: "Payment created through the API.",
        },
      });

      return createdPayment;
    });

    return NextResponse.json({ success: true, payment }, { status: 201 });
  } catch (error) {
    console.error("Failed to create payment", error);
    return NextResponse.json({ error: "Failed to create payment" }, { status: 500 });
  }
}
