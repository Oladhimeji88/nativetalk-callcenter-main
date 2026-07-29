# Security Checklist — UCP Platform

What's implemented in the app vs. what still needs your action before go-live.

## Done in the app ✅
- **Authentication:** JWT login; passwords hashed with bcrypt.
- **Authorization:** server-side RBAC on every endpoint (manager-role permissions);
  super-admin gate for platform/cross-tenant routes.
- **Tenant isolation:** every query scoped by `tenantId`; verified one tenant
  cannot read another's data.
- **Brute-force protection:** login throttled to 8 attempts/min/IP; global rate
  limit 120 req/min/IP.
- **Security headers:** Helmet (CSP, HSTS, X-Frame-Options, X-Content-Type-Options,
  Referrer-Policy, etc.).
- **CORS:** restricted to configured `WEB_ORIGIN` (not wide-open).
- **Error handling:** global filter — no stack traces / internal details leaked in
  production; all 5xx logged.
- **Secrets:** read from env; boot **fails** in production if `JWT_SECRET` is the
  dev default.
- **Input validation:** global ValidationPipe (whitelist + transform).
- **Path safety:** recording streaming resolves strictly inside the recordings dir.
- **Telephony:** API keeps a single ESL connection; PBX provisioning degrades
  safely when the conf dir isn't writable.

## You must do before go-live 🔴
- [ ] **Independent penetration test / security review** (third party).
- [ ] **TLS everywhere** — HTTPS for web/api, WSS for the softphone (domain + cert).
- [ ] **Rotate all secrets** to strong values: `JWT_SECRET`, DB password,
      FreeSWITCH ESL password, extension/SIP passwords (off the `1234` default).
- [ ] **Firewall SIP/RTP** — restrict SIP ports to known peers or add fail2ban;
      your session log showed active SIP scanning of the public port.
- [ ] **Secrets manager** for production credentials (not committed `.env`).
- [ ] **Network-restrict** `/metrics` (unauthenticated by design for scrapers).
- [ ] **Backups + tested restore**; consider DB encryption at rest (managed DB).
- [ ] **Audit-log review** + retention policy; **DPA/consent & DNC** compliance
      (telecom regulation, NCC) for outbound calling.

## Recommended next (app-side, post-Phase 6)
- Token revocation / refresh tokens (Redis deny-list) for instant logout.
- Per-tenant API keys for the inbound webhooks (sign provider callbacks).
- 2FA for admin/super-admin logins.
- Per-tenant rate limits tied to plan.
