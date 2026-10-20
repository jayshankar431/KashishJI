# Comprehensive Audit & Remediation Plan for Kashish-Ji

A senior full-stack audit and production-hardening plan to resolve all security vulnerabilities, admin authentication gaps, PWA caching conflicts, birthday surprise consistency issues, and dependency lockfile mismatches across the Kashish-Ji platform.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following critical product and technical choices were confirmed in Phase 1:

- **Confirmed Decision 1 (Birthday Surprise Brand & Claim Enforcement)**: Standardize exclusively on Amazon Gift Card (resolving Flipkart/Amazon inconsistencies in `HomeSection.tsx` and `BirthdaySurpriseSpinner.tsx`). Synchronize the one-time ₹300 reward claim state across devices via a dedicated Firestore record (`gifts/birthday_claim`) in addition to localStorage.
- **Confirmed Decision 2 (Telegram Bot Architecture)**: Keep the Telegram bot token and chat ID strictly off the frontend. Use a secure server-side Express proxy (`/api/telegram/send`) with environment variables (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`), HTML sanitization, and request rate limiting.
- **Confirmed Decision 3 (PWA & Service Worker Unification)**: Eliminate the conflicting static `public/sw.js` in favor of `vite-plugin-pwa` with automatic cache busting, Workbox runtime caching for media/fonts, and immediate background update notifications.

---

## 1. Overview & Core Concept

- **What It Does**: Hardens the entire Kashish-Ji application by eliminating security vulnerabilities, fixing broken admin permissions, protecting sensitive collections (selfies, device tokens, activity logs), ensuring honest one-time gift card claims, stabilizing the PWA offline layer, and ensuring clean CI/CD deployments.
- **Target Audience**: The recipient (Kashish) experiencing the personalized interactive surprise world, and the admin (Jay) managing content, gallery photos, and notifications from the Admin Panel.
- **Key Value**: Delivers zero runtime errors, impenetrable database rules, verified cross-device state, and seamless APK/Web updates without exposing secrets or breaking existing features.

---

## 2. User Experience & Visual Design

- **Visual Identity Preservation**:
  - Maintain the deeply romantic, nostalgic night diary aesthetic (`#140c1e` dark mode, `#fff5f8` soft rose light mode).
  - Preserve all custom fonts (`Caveat`, `Poppins`, `My Sunshine`, `Lucy Said Ok`) and animations (floating hearts, rose petals, 3D tilt spinner).
- **Admin Panel Access Flow**:
  - Replace the unauthenticated PIN-only check with a proper Firebase Auth login (`signInWithEmailAndPassword`) for `jayshankar431@gmail.com`.
  - Provide a clean, elegant login modal with clear feedback, error states, and session persistence so Firestore security rules recognize `request.auth`.
- **Birthday Surprise Flow**:
  - The wheel spinner cleanly lands on ₹300 on the first spin.
  - An honest Amazon gift card modal appears with the code configured in the environment/config (or placeholder prompt if not yet provisioned).
  - Subsequent spins are permitted for entertainment with an affectionate celebratory message, while preventing duplicate claims.
- **PWA & Offline Resilience**:
  - An unobtrusive in-app install prompt conforming to iOS and Android guidelines.
  - Safe area padding on mobile devices with zero viewport jumping.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Real Firebase Authentication for Admin Panel**
  - *Chosen Approach*: Integrate Firebase Auth with `signInWithEmailAndPassword` inside `AdminPanel.tsx` using `jayshankar431@gmail.com`.
  - *Why*: The Firestore security rules enforce `isAdmin()` via `request.auth.token.email`. Without Firebase Auth, the admin remained unauthenticated (`request.auth == null`), causing all delete/edit operations to fail with permission errors.
  - *Alternatives Considered*: Weakening rules to `allow write: if true` (rejected as a critical security failure).
- **Decision 2: Server-Side Telegram Proxy with Input Sanitization**
  - *Chosen Approach*: Route all Telegram logs, photos, and voice notes through `server.ts` at `/api/telegram/send`. Sanitize HTML entities (`<`, `>`, `&`) and validate payloads.
  - *Why*: Prevents bot token theft and script injection, and complies with AI Studio security guidelines.
  - *Alternatives Considered*: Direct client-side `fetch('https://api.telegram.org/...')` (rejected due to token exposure).
- **Decision 3: Unifying PWA via `vite-plugin-pwa`**
  - *Chosen Approach*: Remove manual `public/sw.js` and configure Workbox runtime caching directly in `vite.config.ts`.
  - *Why*: Dual service workers cause race conditions, stale cache serving, and broken asset hashes after updates.
- **Decision 4: Motion v12 Import Verification**
  - *Chosen Approach*: Add `framer-motion` explicitly to `package.json` matching `motion@12.x` and verify all import paths to prevent build-time resolution failures.
  - *Why*: Resolves dependency lockfile mismatch and enables removing the `npm ci || npm install` workaround in `.github/workflows/firebase-hosting-merge.yml`.

---

## 4. Technical Architecture & Data Strategy

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                     Client (React 19 SPA)                    │
│  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────┐  │
│  │ Main Experience │  │ Birthday Spinner │  │ Admin Panel │  │
│  └────────┬────────┘  └────────┬─────────┘  └──────┬──────┘  │
└───────────┼────────────────────┼───────────────────┼─────────┘
            │                    │                   │
            │ Firestore Reads    │ Sync Claim        │ Auth + Writes
            ▼                    ▼                   ▼
┌──────────────────────────────────────────────────────────────┐
│                    Firebase Firestore                        │
│  • site_content       • memories (public read, admin write)  │
│  • selfies (protected)• device_tokens (admin only read)      │
│  • gifts/birthday_claim (one-time claim validator)           │
│  • activity_logs (append-only, admin read/delete)            │
│  • notifications & overlays (validated status transitions)   │
└────────────────────────────────┬─────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────┐
│                 Express Backend Proxy (server.ts)            │
│  ┌───────────────────────────────┐  ┌─────────────────────┐  │
│  │ /api/telegram/send            │  │ /api/send-fcm-notif │  │
│  │ (Sanitization, Rate Limit)    │  │ (FCM Push Service)  │  │
│  └───────────────┬───────────────┘  └─────────────────────┘  │
└──────────────────┼───────────────────────────────────────────┘
                   ▼
         Telegram Bot API (HTTPS)
```

### Data Model & Firestore Rules Specifications

1. **`firestore.rules` Hardening**:
   - Helper: `isAdmin()` enforces `request.auth != null && request.auth.token.email == 'jayshankar431@gmail.com' && request.auth.token.email_verified == true`.
   - `device_tokens`: Allow write for FCM registration, restrict read exclusively to `isAdmin()`.
   - `selfies`: Public read only for curated/approved items; write allowed with validation; delete restricted to `isAdmin()`.
   - `activity_logs`: Client can append with strict metadata schema; read/delete restricted to `isAdmin()`.
   - `poems`: Public read; write/delete restricted to `isAdmin()`.
   - `gifts/birthday_claim`: Read public; create allowed only if document does not exist (`!exists(...)`); update/delete restricted to `isAdmin()`.

2. **Package & CI/CD Synchronization**:
   - Align `package.json` with explicit `framer-motion` and `motion`.
   - Run `npm install` to update `package-lock.json`.
   - Update `.github/workflows/firebase-hosting-merge.yml` from `npm ci || npm install` to strict `npm ci`.

3. **Backend Express Routes**:
   - Secure `/api/telegram/send` with HTML entity escaping (`escapeHtml`).
   - Rate limit to 30 requests per minute per IP to prevent spam abuse.
