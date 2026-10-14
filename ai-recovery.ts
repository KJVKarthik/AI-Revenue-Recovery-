import type { Payment, Customer } from "@/generated/prisma/client";

type Candidate = Payment & { customer: Customer };

export async function recommendRecoveryAction(payment: Candidate | null) {
  if (!payment) {
    return {
      summary: "Your queue is clear. New failed payments will be prioritized here.",
      action: "No customer needs follow-up right now.",
    };
  }

  const fallback = {
    summary: "Start with the highest-value recovery.",
    action: `Contact ${payment.customer.name} about their ${payment.failureReason?.toLowerCase().replaceAll("_", " ") || "failed"} subscription payment of ₹${payment.amount}.`,
  };
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallback;

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        input: `Recommend one respectful, concise next action for this failed subscription payment. Do not claim to have contacted the customer. Respond only as JSON with string keys summary and action. Customer name: ${payment.customer.name}; amount: ${payment.currency} ${payment.amount}; failure: ${payment.failureReason || "unknown"}.`,
        text: { format: { type: "json_object" } },
        max_output_tokens: 120,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return fallback;
    const result = await response.json() as {
      output?: Array<{ content?: Array<{ text?: string }> }>;
    };
    const text = result.output?.flatMap((item) => item.content || []).find((item) => item.text)?.text;
    if (!text) return fallback;
    const parsed = JSON.parse(text) as { summary?: unknown; action?: unknown };
    if (typeof parsed.summary !== "string" || typeof parsed.action !== "string") return fallback;
    return { summary: parsed.summary.slice(0, 180), action: parsed.action.slice(0, 240) };
  } catch {
    return fallback;
  }
}
