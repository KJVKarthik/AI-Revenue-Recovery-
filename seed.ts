import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../generated/prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required to seed the database.");
const pool = new Pool({ connectionString, max: 2 });
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });

async function main() {
  const workspace = await prisma.workspace.upsert({
    where: { apiKey: process.env.DEMO_WORKSPACE_API_KEY || "local-demo-key" },
    update: {},
    create: {
      name: "Demo workspace",
      apiKey: process.env.DEMO_WORKSPACE_API_KEY || "local-demo-key",
    },
  });

  const rahul = await prisma.customer.upsert({
    where: { workspaceId_email: { workspaceId: workspace.id, email: "rahul@example.com" } },
    update: {},
    create: {
      workspaceId: workspace.id,
      name: "Rahul Sharma",
      email: "rahul@example.com",
      subscriptionAmount: 999,
    },
  });

  const priya = await prisma.customer.upsert({
    where: { workspaceId_email: { workspaceId: workspace.id, email: "priya@example.com" } },
    update: {},
    create: {
      workspaceId: workspace.id,
      name: "Priya Reddy",
      email: "priya@example.com",
      subscriptionAmount: 1499,
    },
  });

  const arjun = await prisma.customer.upsert({
    where: { workspaceId_email: { workspaceId: workspace.id, email: "arjun@example.com" } },
    update: {},
    create: {
      workspaceId: workspace.id,
      name: "Arjun Kumar",
      email: "arjun@example.com",
      subscriptionAmount: 799,
    },
  });

  await prisma.payment.upsert({
    where: { id: "demo-payment-rahul" },
    update: {},
    create: {
      id: "demo-payment-rahul",
      customerId: rahul.id,
      amount: 999,
      status: "FAILED",
      failureReason: "BANK_TIMEOUT",
    },
  });

  await prisma.payment.upsert({
    where: { id: "demo-payment-priya" },
    update: {},
    create: {
      id: "demo-payment-priya",
      customerId: priya.id,
      amount: 1499,
      status: "FAILED",
      failureReason: "INSUFFICIENT_BALANCE",
    },
  });

  await prisma.payment.upsert({
    where: { id: "demo-payment-arjun" },
    update: {},
    create: {
      id: "demo-payment-arjun",
      customerId: arjun.id,
      amount: 799,
      status: "SUCCESS",
    },
  });

  console.log("✅ Test data created successfully!");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
