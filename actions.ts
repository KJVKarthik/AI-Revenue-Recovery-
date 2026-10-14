"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createDashboardSession, dashboardSessionCookie } from "@/lib/security";

export async function login(formData: FormData) {
  const password = formData.get("password");
  if (typeof password !== "string") redirect("/login?error=invalid");
  const session = await createDashboardSession(password);
  if (!session) redirect("/login?error=invalid");
  (await cookies()).set(dashboardSessionCookie, session.cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: session.maxAge,
  });
  redirect("/");
}

export async function logout() {
  (await cookies()).delete(dashboardSessionCookie);
  redirect("/login");
}
