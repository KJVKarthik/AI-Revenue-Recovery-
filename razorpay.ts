import { createHmac, timingSafeEqual } from "node:crypto";

const RAZORPAY_API_URL = "https://api.razorpay.com/v1";

type JsonRecord = Record<string, unknown>;

export type RazorpayPaymentLink = {
  id: string;
  shortUrl: string;
  status: string;
  amountPaid: number;
  paymentId: string | null;
  expiresAt: Date | null;
};

export class RazorpayConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RazorpayConfigurationError";
  }
}

export class RazorpayRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RazorpayRequestError";
  }
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function getCredentials() {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();

  if (!keyId || !keySecret) {
    throw new RazorpayConfigurationError(
      "Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env.",
    );
  }

  return { keyId, keySecret };
}

function parseResponse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function getErrorMessage(body: unknown, fallback: string) {
  const error = asRecord(asRecord(body)?.error);
  return asString(error?.description) || fallback;
}

async function requestRazorpay(
  path: string,
  options: RequestInit = {},
): Promise<unknown> {
  const { keyId, keySecret } = getCredentials();
  const authorization = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const response = await fetch(`${RAZORPAY_API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Basic ${authorization}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
    cache: "no-store",
  });
  const body = parseResponse(await response.text());

  if (!response.ok) {
    throw new RazorpayRequestError(
      getErrorMessage(body, "Razorpay could not process the request."),
      response.status,
    );
  }

  return body;
}

function toPaymentLink(body: unknown): RazorpayPaymentLink {
  const entity = asRecord(body);
  const id = asString(entity?.id);
  const shortUrl = asString(entity?.short_url);

  if (!id || !shortUrl) {
    throw new RazorpayRequestError(
      "Razorpay returned an incomplete payment-link response.",
      502,
    );
  }

  const expiresAt = asNumber(entity?.expire_by);

  return {
    id,
    shortUrl,
    status: asString(entity?.status) || "created",
    amountPaid: asNumber(entity?.amount_paid),
    paymentId: asString(entity?.payment_id),
    expiresAt: expiresAt ? new Date(expiresAt * 1000) : null,
  };
}

function getPaymentReturnUrl(recoveryId: string) {
  const appUrl = process.env.APP_URL?.trim();

  if (!appUrl) {
    return undefined;
  }

  try {
    const url = new URL(appUrl);

    if (url.protocol !== "https:") {
      return undefined;
    }

    url.pathname = "/payment-complete";
    url.search = new URLSearchParams({ recovery: recoveryId }).toString();
    return url.toString();
  } catch {
    return undefined;
  }
}

export function isRazorpayConfigured() {
  return Boolean(
    process.env.RAZORPAY_KEY_ID?.trim() && process.env.RAZORPAY_KEY_SECRET?.trim(),
  );
}

export function isRazorpayWebhookConfigured() {
  return Boolean(process.env.RAZORPAY_WEBHOOK_SECRET?.trim());
}

export async function createRazorpayPaymentLink({
  amountInRupees,
  currency,
  customer,
  paymentId,
  recoveryId,
}: {
  amountInRupees: number;
  currency: string;
  customer: { name: string; email: string };
  paymentId: string;
  recoveryId: string;
}) {
  if (!Number.isInteger(amountInRupees) || amountInRupees <= 0) {
    throw new RazorpayRequestError("Payment amount must be a positive whole rupee value.", 400);
  }

  const referenceId = `rec_${recoveryId}`;

  if (referenceId.length > 40) {
    throw new RazorpayRequestError("The payment-link reference is too long.", 400);
  }

  const callbackUrl = getPaymentReturnUrl(recoveryId);
  const body: JsonRecord = {
    amount: amountInRupees * 100,
    currency,
    accept_partial: false,
    reference_id: referenceId,
    description: `Subscription payment recovery for ${customer.name}`,
    customer: {
      name: customer.name,
      email: customer.email,
    },
    // The dashboard controls sharing the link. No customer notification is sent implicitly.
    notify: { email: false, sms: false },
    reminder_enable: false,
    notes: {
      payment_id: paymentId,
      recovery_id: recoveryId,
    },
  };

  if (callbackUrl) {
    body.callback_url = callbackUrl;
    body.callback_method = "get";
  }

  return toPaymentLink(
    await requestRazorpay("/payment_links", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

export async function fetchRazorpayPaymentLink(paymentLinkId: string) {
  return toPaymentLink(
    await requestRazorpay(`/payment_links/${encodeURIComponent(paymentLinkId)}`),
  );
}

export async function cancelRazorpayPaymentLink(paymentLinkId: string) {
  return toPaymentLink(
    await requestRazorpay(`/payment_links/${encodeURIComponent(paymentLinkId)}/cancel`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  );
}

export function verifyRazorpayWebhookSignature(
  rawBody: string,
  signature: string | null,
  secret = process.env.RAZORPAY_WEBHOOK_SECRET,
) {
  if (!signature || !secret) {
    return false;
  }

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const received = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  return (
    received.length === expectedBuffer.length &&
    timingSafeEqual(received, expectedBuffer)
  );
}
