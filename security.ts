import { createHmac, timingSafeEqual } from "node:crypto";
import type { cookies as nextCookies } from "next/headers";
import { prisma } from "@/lib/prisma";

const SESSION_COOKIE = "recoverly_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set to a random value of at least 32 characters.");
  }
  return secret;
}

function sign(value: string) {
  return createHmac("sha256", sessionSecret()).update(value).digest("hex");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export async function authenticateWorkspaceApiKey(apiKey: string | null) {
  if (!apiKey) return null;
  const workspace = await prisma.workspace.findUnique({ where: { apiKey }, select: { id: true } });
  return workspace?.id ?? null;
}

export async function createDashboardSession(password: string) {
  const configuredPassword = process.env.DASHBOARD_PASSWORD;
  if (!configuredPassword || !safeEqual(password, configuredPassword)) return null;

  const workspaceId = process.env.DASHBOARD_WORKSPACE_ID;
  if (workspaceId) {
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
    if (!workspace) return null;
  }
  const fallbackWorkspace = await prisma.workspace.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!workspaceId && !fallbackWorkspace) return null;
  const ownerId = workspaceId || fallbackWorkspace!.id;
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${ownerId}.${expiresAt}`;
  return { cookie: `${payload}.${sign(payload)}`, maxAge: SESSION_TTL_SECONDS };
}

export async function getDashboardWorkspaceId(cookieStore: Awaited<ReturnType<typeof nextCookies>>) {
  const value = cookieStore.get(SESSION_COOKIE)?.value;
  if (!value) return null;
  const [workspaceId, expiryText, signature] = value.split(".");
  const expiresAt = Number(expiryText);
  if (!workspaceId || !signature || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() / 1000) return null;
  const payload = `${workspaceId}.${expiresAt}`;
  if (!safeEqual(signature, sign(payload))) return null;
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
  return workspace?.id ?? null;
}

export const dashboardSessionCookie = SESSION_COOKIE;
