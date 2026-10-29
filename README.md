# GrowTop — Next.js + TypeScript

Backend and admin panel for one Growtopia Private Server. Orders are fulfilled manually by an administrator. The data model stores only the player's GrowID; there is no game selector or server field.

For a quick visual preview without running the app, open `admin-preview.html` directly in a browser. It uses sample data and simulated controls; it does not call the API.

## Included

- Next.js App Router with TypeScript and PostgreSQL through Prisma.
- Customer account creation/login and an 8-hour HTTP-only signed session cookie.
- Guest and signed-in order creation. The server reads the current package price from the database.
- Guest order tracking using order code plus checkout email; authenticated purchase history endpoint.
- Admin-only order queue with guarded status transitions: pending payment → confirmed paid → processing → completed. Admin can cancel eligible orders.
- Admin package price/availability management and announcement draft/publish controls.
- Customer-facing storefront reads active packages and published announcements from the API, supports guided checkout, login/signup, guest tracking, and account purchase history.
- An audit event is recorded when an admin changes an order status.

## Local setup

1. Install Node.js 20.9 or newer and PostgreSQL.
2. Copy `.env.example` to `.env` and set `DATABASE_URL`, a random `SESSION_SECRET` of at least 32 characters, plus `ADMIN_EMAIL` and an `ADMIN_PASSWORD` of at least 12 characters.
3. Run `npm install`.
4. Run `npx prisma migrate dev --name init` and `npm run db:seed`.
5. Run `npm run dev`, then open `/admin/login`.

The seed creates the first admin, three editable sample packages, and one announcement. Change the sample package prices in the admin panel before accepting orders.

## API outline

- `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/packages`, `POST /api/orders`, `GET /api/orders/track?orderCode=...&email=...`, `GET /api/orders/mine`
- `GET /api/admin/orders`, `PATCH /api/admin/orders/:id`
- `GET/POST /api/admin/packages`, `PATCH /api/admin/packages/:id`
- `GET/POST /api/admin/announcements`, `PATCH /api/admin/announcements/:id`
- `GET /api/announcements`

## Not connected yet

Payment gateway, email notifications, rate limiting, password reset, and deployment configuration are not implemented. The storefront displays a notice that payment gateway is not yet active. For this manual-processing phase, an admin explicitly confirms payment, starts fulfillment, and marks the order complete after delivering the item. Connect a gateway and verify its signed webhook before using automated payment confirmation. Add rate limiting and production security review before public launch.
