import Link from "next/link";
import { connection } from "next/server";
import { RecoveryStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export default async function PaymentComplete({
  searchParams,
}: {
  searchParams: Promise<{ recovery?: string }>;
}) {
  await connection();
  const { recovery: recoveryId } = await searchParams;
  const recovery = recoveryId
    ? await prisma.recovery.findUnique({
        where: { id: recoveryId },
        include: { payment: { include: { customer: true } } },
      })
    : null;
  const recovered = recovery?.status === RecoveryStatus.COMPLETED;

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-5 py-10 text-slate-950">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-sm">
        <div
          className={`mx-auto grid size-12 place-items-center rounded-full text-lg font-bold ${
            recovered
              ? "bg-emerald-100 text-emerald-700"
              : "bg-violet-100 text-violet-700"
          }`}
        >
          {recovered ? "✓" : "…"}
        </div>
        <p className="mt-5 text-sm font-medium text-violet-700">Recoverly</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {recovered ? "Payment confirmed" : "Payment is being confirmed"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {recovered
            ? `Thanks — ${recovery?.payment.customer.name}'s payment has been recorded.`
            : "Razorpay has returned you to Recoverly. The dashboard will update as soon as the secure webhook confirms the payment."}
        </p>
        <Link
          className="mt-6 inline-flex rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700"
          href="/"
        >
          Back to dashboard
        </Link>
      </section>
    </main>
  );
}
