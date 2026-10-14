# Recoverly — AI Revenue Recovery

Recoverly is a subscription payment recovery dashboard. It stores customer payment events, prioritizes failed payments, creates Razorpay payment links, and reconciles status from signed webhooks. Optional OpenAI recommendations augment a deterministic fallback.

## Requirements

- Node.js 20.19+ (required by Prisma 7)
- npm
- PostgreSQL (local or managed)
- Razorpay test API keys to exercise hosted payment links (optional for local/manual recovery)

## Run locally

```bash
npm install
cp .env.example .env
npm run db:setup
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The setup command applies checked-in migrations and seeds three sample customers and payments in the demo workspace. It replaces sample records only in that workspace.

## Configuration

Set these values in `.env`:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection URL |
| `SESSION_SECRET` | Yes | Random 32+ character secret used to sign dashboard sessions |
| `DASHBOARD_PASSWORD` | Yes | Password protecting the dashboard |
| `DASHBOARD_WORKSPACE_ID` | Optional | Workspace ID for the dashboard; otherwise the first workspace is used |
| `DEMO_WORKSPACE_API_KEY` | Optional | Seed/demo workspace API key; change the default before production |
| `OPENAI_API_KEY` | Optional | Enables generated recovery recommendations |
| `OPENAI_MODEL` | Optional | Responses API model; defaults to `gpt-4.1-mini` |
| `RAZORPAY_KEY_ID` | For hosted links | Razorpay test-mode key ID |
| `RAZORPAY_KEY_SECRET` | For hosted links | Razorpay test-mode key secret |
| `RAZORPAY_WEBHOOK_SECRET` | For webhook updates | Secret configured on the Razorpay webhook endpoint |
| `APP_URL` | Optional | Public HTTPS app URL used as Razorpay return URL |

Configure the Razorpay webhook to send payment-link events to `POST /api/webhooks/razorpay`. Use the same webhook secret in both Razorpay and `RAZORPAY_WEBHOOK_SECRET`. Keep test keys and secrets out of source control.

Without Razorpay credentials, the dashboard still supports starting a recovery, marking an offline payment as paid, and cancelling a local recovery.

The dashboard uses a signed, HttpOnly session cookie. The payment intake endpoint requires `Authorization: Bearer <workspace-api-key>` and rejects customer IDs owned by other workspaces. The dashboard is configured for one workspace per deployment. Create separate workspace records and unique API keys for each tenant.

When configured, OpenAI generates a concise suggested next action. If the key is missing or the service is unavailable, the dashboard uses a deterministic recommendation. The model does not send customer messages.

## Payment intake API

`POST /api/payments/create` records a payment event for a customer in the authenticated workspace.

Example request:

```bash
curl -X POST http://localhost:3000/api/payments/create \
  -H 'authorization: Bearer local-demo-key' \
  -H 'content-type: application/json' \
  -d '{"customerId":"CUSTOMER_ID","amount":999,"currency":"INR","status":"FAILED","failureReason":"BANK_TIMEOUT"}'
```

`amount` is a positive whole number in the payment currency's major unit (for example, rupees for INR). `status` must be `PENDING`, `FAILED`, `SUCCESS`, or `RECOVERED`. The response is `201` with the created payment; invalid input returns `400`, a missing customer returns `404`, and unexpected storage errors return `500`.

## Recovery lifecycle

1. Failed payments appear in the dashboard queue, highest amount first.
2. Start a recovery, then create a hosted payment link or record an offline payment manually.
3. The dashboard can sync a link directly with Razorpay. Signed webhooks update payment and recovery status automatically.
4. Webhook event IDs are recorded to make provider retries idempotent.

All amounts are stored as integer major currency units. Razorpay requests convert INR amounts to paise. Automated email/SMS delivery is not implemented. Before handling real customer data, replace the demo API key, configure strong secrets, provision isolated workspaces, and review your privacy and retention requirements.

## Useful commands

```bash
npm run dev       # local development
npm run lint      # lint the project
npm run build     # production build
npm run db:migrate # apply database migrations
npm run db:seed    # add sample records (does not clear data)
```
