# Smart Farm MQTT -- Security Vulnerability Analysis & Remediation Plan

**Date:** 2026-03-27
**Auditor:** Security Architect Agent
**Scope:** Backend (NestJS), Frontend (Vue 3), WebSocket (Socket.IO), MQTT

---

## Executive Summary

| Metric | Value |
|--------|-------|
| Total Issues | 7 |
| Critical | 4 (Issue #1, #3, #5, #6) |
| High | 2 (Issue #2, #7) |
| Medium | 1 (Issue #4) |
| Estimated Fix Effort | 3-4 days |

---

## Issue #1: KMA API Key Hardcoded in Source Code

**Severity:** CRITICAL
**OWASP:** A02 Cryptographic Failures
**File:** `backend/src/modules/dashboard/dashboard.service.ts:224-226`

### Current Code (Lines 223-226)

```typescript
private getServiceKey(): string {
  const encodedFallback =
    'Ovj%2FY%2Bkq2KuEXQDUmEBRg4ekq4bR2xjBSmwLU0Atp4r2ZJeOKhMBjap2M5J34fLoj5VM9w6VA%2FySVbjAtgX9SQ%3D%3D';
  const configured = process.env.KMA_SERVICE_KEY || process.env.KMA_API_KEY || encodedFallback;
```

### Impact

- API key is committed to git history and exposed to anyone with repo access
- Even if environment variable is set, the hardcoded fallback remains extractable
- Key abuse can exhaust KMA API quota or be used for unauthorized API calls

### Remediation

1. **Remove the hardcoded fallback entirely.** If no env var is set, throw a startup error or return a graceful "weather unavailable" response.
2. **Rotate the exposed key immediately** via the KMA (data.go.kr) portal.
3. **Add `KMA_SERVICE_KEY` to `.env.example`** and document it as required.

```typescript
// FIX
private getServiceKey(): string {
  const key = process.env.KMA_SERVICE_KEY || process.env.KMA_API_KEY;
  if (!key) {
    throw new ServiceUnavailableException('KMA_SERVICE_KEY 환경변수가 설정되지 않았습니다.');
  }
  try {
    return key.includes('%') ? decodeURIComponent(key) : key;
  } catch {
    return key;
  }
}
```

---

## Issue #2: No Rate Limiting (Brute-Force Login Attacks)

**Severity:** HIGH
**OWASP:** A07 Identification and Authentication Failures
**File:** `backend/src/main.ts`, `backend/src/app.module.ts`

### Current State

- `@nestjs/throttler` v5.1.2 is installed in `package.json` but **never imported or configured**
- `helmet` v7.1.0 is also installed but **never used**
- Login endpoint `POST /api/auth/login` has zero rate limiting
- Refresh endpoint `POST /api/auth/refresh` also unprotected

### Impact

- Unlimited brute-force login attempts possible
- No security headers (HSTS, X-Frame-Options, CSP, etc.)
- Credential stuffing attacks trivially executable

### Remediation

**Step 1:** Enable Helmet for security headers in `main.ts`:

```typescript
import helmet from 'helmet';
// in bootstrap():
app.use(helmet());
```

**Step 2:** Configure ThrottlerModule in `app.module.ts`:

```typescript
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

@Module({
  imports: [
    ThrottlerModule.forRoot([{
      ttl: 60000,   // 1 minute window
      limit: 60,    // 60 requests per minute (general)
    }]),
    // ... existing modules
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
```

**Step 3:** Apply stricter rate limiting to auth endpoints:

```typescript
// auth.controller.ts
import { Throttle } from '@nestjs/throttler';

@Post('login')
@Throttle({ default: { limit: 5, ttl: 60000 } })  // 5 attempts per minute
async login(@Body() dto: LoginDto) { ... }

@Post('refresh')
@Throttle({ default: { limit: 10, ttl: 60000 } })  // 10 per minute
async refresh(@Body() dto: RefreshTokenDto) { ... }
```

---

## Issue #3: Refresh Token Cannot Be Invalidated

**Severity:** CRITICAL
**OWASP:** A07 Identification and Authentication Failures
**File:** `backend/src/modules/auth/auth.service.ts:54-69`

### Current State

```typescript
async refresh(refreshToken: string) {
  try {
    const payload = this.jwtService.verify<JwtPayload>(refreshToken);
    // Simply re-signs a new token -- no server-side validation
    const newPayload: JwtPayload = { ... };
    return {
      accessToken: this.jwtService.sign(newPayload, { expiresIn: '1h' }),
      refreshToken: this.jwtService.sign(newPayload, { expiresIn: '7d' }),
    };
  } catch { ... }
}
```

- Refresh tokens are **pure JWT with no server-side tracking**
- `logout()` on the frontend only removes tokens from browser storage
- A stolen refresh token remains valid for its full 7-day lifetime
- The `refresh()` endpoint issues a new refresh token each time (token rotation) but **never invalidates the old one**

### Impact

- After logout, a captured refresh token can generate new access tokens for 7 days
- With the 30-day session requirement, this exposure window would extend to 30 days
- No way to force-logout a compromised account

### Remediation -- Token Family with DB Tracking

Given the 30-day session requirement, implement refresh token families stored in the database:

```
Table: refresh_tokens
- id: UUID (PK)
- user_id: UUID (FK -> users)
- token_hash: VARCHAR (SHA-256 hash of token)
- family_id: UUID (groups rotated tokens)
- expires_at: TIMESTAMP
- revoked: BOOLEAN default false
- created_at: TIMESTAMP
```

**Logic:**
1. On login: create a new token family, store hashed refresh token
2. On refresh: verify token exists in DB and is not revoked, issue new pair, mark old as used
3. On logout: revoke all tokens in the family
4. If a revoked token is reused: revoke the entire family (replay attack detection)
5. Cron job: clean up expired tokens daily

**Token Lifetimes for 30-Day Session:**
- Access Token: `15m` (short-lived, reduces risk if intercepted)
- Refresh Token: `30d` (matches session requirement)
- Silent refresh interval: every 14 minutes on the frontend

---

## Issue #4: Refresh Token Stored in localStorage (XSS Risk)

**Severity:** MEDIUM
**OWASP:** A07 Identification and Authentication Failures
**File:** `frontend/src/stores/auth.store.ts:25, 47`

### Current State

```typescript
localStorage.setItem('refreshToken', data.refreshToken)  // line 25
localStorage.setItem('refreshToken', data.refreshToken)  // line 47
```

- Refresh token stored in `localStorage` (plaintext, accessible to any JS on the page)
- Access token stored in `sessionStorage` (same risk but shorter-lived)
- Any XSS vulnerability would allow token theft

### Impact Assessment

For a web-only smart farm management system:
- The attack surface is limited (not a public-facing consumer app)
- Users are known farm operators, not anonymous internet users
- However, if any dependency has an XSS vulnerability, tokens are immediately compromisable

### Remediation Options (Ranked by Effort)

**Option A (Recommended): httpOnly Cookie for Refresh Token**

Set refresh token as httpOnly cookie from the server:

```typescript
// auth.controller.ts
@Post('login')
async login(@Body() dto: LoginDto, @Res() res: Response) {
  const result = await this.authService.login(dto);
  res.cookie('refresh_token', result.refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    path: '/api/auth',
  });
  res.json({ accessToken: result.accessToken, user: result.user });
}
```

- Access token remains in memory (JS variable, not storage)
- Frontend `initAuth()` calls `/api/auth/refresh` on page load; cookie is sent automatically
- No token in localStorage = nothing for XSS to steal

**Option B (Quick Fix): Keep localStorage but reduce token lifetime**

If httpOnly cookies are not feasible short-term, at least:
- Reduce refresh token to 7 days
- Add token binding (include IP hash or fingerprint in JWT claims)

---

## Issue #5: SQL Injection in sensor-alerts.service.ts

**Severity:** CRITICAL
**OWASP:** A03 Injection
**File:** `backend/src/modules/sensor-alerts/sensor-alerts.service.ts:274, 296-298`

### Current Code

```typescript
// Line 274
AND time >= NOW() - INTERVAL '${FLATLINE_WINDOW_HOURS} hours'

// Line 296
AND resolved_at >= NOW() - INTERVAL '${FLAPPING_WINDOW_HOURS} hours'

// Line 298
HAVING COUNT(*) >= ${FLAPPING_THRESHOLD}
```

Also found in `isConditionNormal()`:
```typescript
// Line 418
AND time >= NOW() - INTERVAL '${FLATLINE_WINDOW_HOURS} hours'

// Line 431
AND resolved_at >= NOW() - INTERVAL '${FLAPPING_WINDOW_HOURS} hours'
```

### Impact Assessment -- DOWNGRADED to LOW actual risk

After tracing the variables:

```typescript
// sensor-alert-rules.ts
export const FLATLINE_WINDOW_HOURS = 24;
export const FLAPPING_WINDOW_HOURS = 6;
export const FLAPPING_THRESHOLD = 3;
```

These are **module-level constants** (hardcoded numbers), not user input. The string interpolation pattern is technically bad practice, but there is **no injection vector** because:
1. The values come from a read-only constant file, not from request parameters
2. They are numeric types (`number`), not strings
3. No user-controlled data reaches these template literals

### Remediation (Defense in Depth)

Even though the current risk is low, convert to parameterized queries for correctness:

```typescript
// Instead of:
AND time >= NOW() - INTERVAL '${FLATLINE_WINDOW_HOURS} hours'

// Use:
AND time >= NOW() - make_interval(hours => $3)
// with parameter: [device.id, sensorType, FLATLINE_WINDOW_HOURS]
```

Or use a constant string directly since the values never change:

```typescript
AND time >= NOW() - INTERVAL '24 hours'
```

**Priority: Low** -- No actual attack vector exists, but the pattern should be cleaned up to prevent future copy-paste mistakes.

---

## Issue #6: WebSocket Global Broadcast (Cross-Tenant Data Leak)

**Severity:** CRITICAL
**OWASP:** A01 Broken Access Control
**File:** `backend/src/modules/gateway/events.gateway.ts:81, 89, 99`

### Current Code

```typescript
// Line 81 -- broadcasts to ALL connected clients
broadcastSensorUpdate(data) {
  this.server.emit('sensor:update', data);  // <-- GLOBAL broadcast
  if (data.houseId) {
    this.server.to(`house:${data.houseId}`).emit('sensor:update', data);
  }
}

// Line 89 -- same issue
broadcastDeviceStatus(deviceId: string, online: boolean) {
  this.server.emit('device:status', { deviceId, online });  // <-- GLOBAL
}

// Line 99 -- same issue
broadcastAutomationExecuted(data) {
  this.server.emit('automation:executed', data);  // <-- GLOBAL
}
```

Additionally, the `subscribe:house` and `subscribe:group` handlers (lines 47-61) perform **no ownership verification**. Any authenticated user can subscribe to any house/group by ID.

### Impact

- **farm_admin A** sees sensor data, device status, and automation logs from **farm_admin B**
- Any authenticated user can subscribe to any house channel by guessing/enumerating UUIDs
- In a multi-tenant smart farm system, this is a serious data privacy violation

### Remediation

**Step 1:** Replace global broadcasts with user-scoped rooms.

When a client connects, automatically join a user-specific room:

```typescript
async handleConnection(client: Socket) {
  // ... existing token verification ...
  const userId = payload.sub;
  (client as any).userId = userId;
  client.join(`user:${userId}`);  // auto-join user room
}
```

**Step 2:** Scope all broadcasts to the data owner:

```typescript
broadcastSensorUpdate(userId: string, data: { ... }) {
  this.server.to(`user:${userId}`).emit('sensor:update', data);
  if (data.houseId) {
    this.server.to(`house:${data.houseId}`).emit('sensor:update', data);
  }
}
```

**Step 3:** Validate ownership on room subscriptions:

```typescript
@SubscribeMessage('subscribe:house')
async handleSubscribeHouse(
  @ConnectedSocket() client: Socket,
  @MessageBody() data: { houseId: string },
) {
  const userId = (client as any).userId;
  // Verify user owns this house before allowing subscription
  const house = await this.houseRepo.findOne({
    where: { id: data.houseId, userId },
  });
  if (!house) {
    client.emit('error', { message: 'Access denied' });
    return;
  }
  client.join(`house:${data.houseId}`);
}
```

---

## Issue #7: No Backend Role Enforcement (Frontend-Only Guards)

**Severity:** HIGH
**OWASP:** A01 Broken Access Control
**File:** Multiple controllers

### Current State

**Frontend:** Router guards check `denyFarmUser` and `requiresAdmin` meta flags (router/index.ts:88-120)

**Backend:** Only 2 of 13 controllers use `RolesGuard`:
- `config-deploy.controller.ts` -- `@Roles('admin')` (correct)
- `users.controller.ts` -- `@Roles('admin')` on all methods (correct)

**Unprotected controllers (no role check):**

| Controller | Frontend Rule | Backend Role Check |
|-----------|--------------|-------------------|
| `automation.controller.ts` | `denyFarmUser` | NONE |
| `devices.controller.ts` | `denyFarmUser` | NONE |
| `gateway-manager.controller.ts` | - | NONE |
| `groups.controller.ts` | - | NONE |
| `sensors.controller.ts` | - | NONE |
| `reports.controller.ts` | - | NONE |
| `harvest.controller.ts` | - | NONE |
| `env-config.controller.ts` | - | NONE |
| `sensor-alerts.controller.ts` | - | NONE |
| `dashboard.controller.ts` | - | NONE |

### Impact

- A `farm_user` can call `POST /api/automation/rules` directly via curl/Postman, bypassing the frontend guard
- Frontend-only security is no security at all -- any API client can skip it
- The `automation.controller.ts` has `getEffectiveUserId()` which maps farm_user to parentUserId for data scoping, but does NOT block access

### Remediation

**Step 1:** Register RolesGuard as a global guard in `app.module.ts`:

```typescript
import { APP_GUARD } from '@nestjs/core';
import { RolesGuard } from './common/guards/roles.guard';

providers: [
  { provide: APP_GUARD, useClass: ThrottlerGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
],
```

**Step 2:** Add `@Roles()` decorator to controllers that should be restricted:

```typescript
// automation.controller.ts
@Controller('automation')
@UseGuards(JwtAuthGuard)
@Roles('admin', 'farm_admin')  // deny farm_user
export class AutomationController { ... }

// devices.controller.ts
@Controller('devices')
@UseGuards(JwtAuthGuard)
@Roles('admin', 'farm_admin')  // deny farm_user
export class DevicesController { ... }
```

**Step 3:** For controllers where `farm_user` should have read-only access, apply per-method:

```typescript
@Get('rules')
// No @Roles -- all authenticated users can read
findAll(@CurrentUser() user: any) { ... }

@Post('rules')
@Roles('admin', 'farm_admin')  // only admin/farm_admin can create
create(@CurrentUser() user: any, @Body() dto: CreateRuleDto) { ... }
```

---

## 30-Day Session Strategy

### Requirements
- User wants to stay logged in for 30 days
- Web-only service (no mobile)
- Convenience over strict security

### Recommended Token Configuration

| Token | Lifetime | Storage | Purpose |
|-------|----------|---------|---------|
| Access Token | **15 minutes** | JS memory (Pinia ref) | API authorization |
| Refresh Token | **30 days** | httpOnly cookie | Session persistence |

### Why Not Just a 30-Day Access Token?

- Access tokens are sent with every API request in the Authorization header
- If intercepted, a 30-day access token gives full API access for a month
- Short access tokens + long refresh tokens = best balance of security and convenience

### Frontend Implementation

```typescript
// auth.store.ts
async function initAuth() {
  // No need to read localStorage -- cookie is sent automatically
  try {
    const { data } = await authApi.refresh()  // cookie-based
    accessToken.value = data.accessToken
    await fetchUser()
  } catch {
    // Not logged in or session expired
  }
}

// Set up silent refresh timer
let refreshTimer: number | null = null

function startSilentRefresh() {
  refreshTimer = window.setInterval(async () => {
    await refreshToken()
  }, 14 * 60 * 1000)  // every 14 minutes
}
```

### User Experience

- User logs in once, stays logged in for 30 days
- Tab close/reopen: `initAuth()` auto-restores session via cookie
- Browser close/reopen: same behavior (cookie persists)
- Explicit logout: cookie cleared, all refresh tokens revoked server-side

---

## Fix Priority & Implementation Order

### Phase 1: Immediate (Day 1) -- Block Critical Exploits

| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| 1 | Remove hardcoded API key + rotate | 30 min | Stops credential leak |
| 2 | Enable Helmet (security headers) | 15 min | Package already installed |
| 6 | Fix WebSocket global broadcast | 2 hr | Stops cross-tenant data leak |

### Phase 2: High Priority (Day 2) -- Authentication Hardening

| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| 2 | Enable ThrottlerModule + login rate limit | 1 hr | Blocks brute force |
| 7 | Add RolesGuard to unprotected controllers | 2 hr | Enforces authorization |

### Phase 3: Session Architecture (Day 3-4) -- 30-Day Session

| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| 3 | Implement refresh token DB tracking | 4 hr | Token revocation |
| 4 | Move refresh token to httpOnly cookie | 2 hr | XSS protection |
| - | Adjust token lifetimes (15m / 30d) | 30 min | 30-day session goal |

### Phase 4: Defense in Depth (Backlog)

| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| 5 | Parameterize constant SQL interpolation | 1 hr | Prevents future mistakes |
| - | CORS tightening for production | 30 min | Defense in depth |
| - | CSP header configuration | 1 hr | XSS mitigation |

---

## Additional Findings (Non-Critical)

### 1. CORS Configuration

```typescript
// main.ts:12
origin: process.env.CORS_ORIGIN || 'http://localhost:5174',
```

Production should use a strict allowlist. The fallback to localhost is fine for development.

### 2. GlobalExceptionFilter Exposes Path

```typescript
// http-exception.filter.ts:43
path: request.url,  // Could reveal internal API structure
```

Low risk for an internal system, but consider removing `path` from production error responses.

### 3. synchronize: true in Non-Production

```typescript
synchronize: config.get('NODE_ENV') !== 'production',
```

This is correct -- but ensure `NODE_ENV=production` is always set in deployed environments to prevent accidental schema changes.

### 4. WebSocket CORS Mismatch

```typescript
// events.gateway.ts:16
origin: process.env.CORS_ORIGIN || 'http://localhost:5173',  // port 5173
// main.ts:13
origin: process.env.CORS_ORIGIN || 'http://localhost:5174',  // port 5174
```

Inconsistent default ports between HTTP CORS and WebSocket CORS.

---

## Compliance Summary

| OWASP Category | Status | Issues |
|---------------|--------|--------|
| A01 Broken Access Control | FAIL | #6, #7 |
| A02 Cryptographic Failures | FAIL | #1 |
| A03 Injection | WARN | #5 (low actual risk) |
| A04 Insecure Design | WARN | Frontend-only guards |
| A05 Security Misconfiguration | FAIL | No headers, no rate limit |
| A06 Vulnerable Components | OK | Dependencies appear current |
| A07 Auth Failures | FAIL | #2, #3, #4 |
| A08 Integrity Failures | OK | - |
| A09 Logging/Monitoring | WARN | No security event logging |
| A10 SSRF | OK | External calls are to fixed KMA endpoint |
