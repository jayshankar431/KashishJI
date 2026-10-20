# Kashish-Ji Production Setup

## Firebase identities and private access

- The existing administrator remains `jayshankar431@gmail.com`; the Admin Panel still uses Firebase Email/Password sign-in.
- Keep public signup disabled. Create a separate Email/Password account for Kashish only after her account details are available.
- Until her exact Firebase Auth UID is confirmed and access is separately approved, private Firestore content and Storage objects are administrator-only. The current rules grant no recipient access.
- After the account is created and its UID is verified in Firebase Console, review and explicitly update both Firestore and Storage rules before granting access. Do not use an email, placeholder, or guessed UID.
- Private content is stored in `private_site_content/main`; the old mixed `site_content/main` remains administrator-only and is not deleted. Use **Prepare private content** in the Admin Panel to copy its current overrides into the split documents. Review the results before authorizing a recipient.
- Personal letter/envelope defaults were removed from the frontend bundle. If those defaults were never saved to Firestore, restore them manually in the Admin Panel before authorizing the recipient. No Firestore data was read, migrated, or changed as part of this code update.

## Firebase rules and private media

- `firestore.rules` and `storage.rules` deny access by default, limit private collections and media to the administrator until a recipient UID is verified and separately authorized, and restrict uploads by content type and size.
- The active web configuration uses project `kashishhji` and Firestore `(default)`.
- Review the rule changes before applying them. Production rules have not been deployed. When approved, deploy only the rules with `firebase deploy --only firestore:rules,storage`.
- New photos and voice notes are uploaded to Firebase Storage; Firestore stores their Storage paths and metadata, not base64 media. Existing tokenized download URLs are bearer links and are not revoked by these rules; migrate/revoke any existing links separately after review.
- Private Storage previews use authenticated `getBlob` requests. Configure the bucket's CORS policy to allow the production web origin (and any approved preview origin) before testing browser media playback.
- Android FCM tokens are written to `device_tokens` only while an authenticated admin session is active; no anonymous or public signup is used. Native token registration therefore waits until an authorized web account signs in.
- The Android source previously contained Firebase options for a different project. It now targets `kashishhji` and the default Firestore database, but this repository has no `google-services.json` or registered Android app configuration for this Firebase project. Register package `com.jayshankar.kashish` in Firebase Console and replace the temporary web-app Firebase options with that Android app's generated configuration before relying on native FCM. The native APK was not built or device-tested here.

## Express API on Cloud Run

Firebase Hosting forwards `/api/**` to Cloud Run service `kashish-ji-api` in `asia-south1`. The Cloud Run container is defined by `Dockerfile`; the Hosting rewrite and frontend calls are same-origin. Check service reachability with `/api/health` (this checks only that Express is responding, not Firebase or Telegram credentials).

Before deploying the Hosting rewrite:

1. Review the service account and grant only the required Firestore access plus Firebase Auth token-verification access. The native custom-token bridge also requires the service account to sign custom tokens; grant the minimum signing permission needed.
2. Deploy the Cloud Run service from the repository and allow the Hosting integration to invoke it. The service's own endpoints require Firebase ID-token authorization or Telegram webhook verification.
3. Store these values in Google Secret Manager and map them to Cloud Run environment variables. Never commit them or print them in logs:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
   - `TELEGRAM_WEBHOOK_SECRET`
   - `TELEGRAM_ALLOWED_USER_IDS` (comma-separated numeric Telegram sender IDs)
4. Set `FIREBASE_PROJECT_ID=kashishhji`. Cloud Run uses its attached service account through Application Default Credentials; do not upload a service-account JSON key.
5. Configure Telegram's webhook URL as `https://kashishhji.web.app/api/telegram-webhook` and provide the same `TELEGRAM_WEBHOOK_SECRET` as Telegram's `secret_token`.
6. Verify Cloud Run health and Telegram delivery before deploying the Firebase Hosting rewrite. The service is not deployed by this repository workflow.

The `/api/telegram/send` endpoint requires a Firebase ID token belonging to the configured administrator or an explicitly allowed recipient. It validates payload types and sizes, applies per-IP rate limiting, and reports network/Telegram failures. Telegram inbound commands are authenticated, sender-allowlisted, deduplicated by `update_id`, and saved to Firestore `notifications`; the frontend and Android background service continue to use their Firestore notification listeners.

The previous setup guide contained a Telegram credential. Treat that credential as exposed: revoke it with BotFather and configure a newly generated token in Secret Manager before enabling delivery.

## CI and deployment

- `.github/workflows/ci.yml` runs `npm ci`, TypeScript checks, the frontend build, and a container build for pull requests and `main`.
- `.github/workflows/firebase-hosting-merge.yml` still deploys Hosting on pushes to `main`; it does not deploy Firestore/Storage rules or Cloud Run.
- Do not merge the Hosting rewrite until the Cloud Run service is deployed and reachable. No production deployment or Firebase Console change was performed during this implementation.
- There is currently no automated unit-test suite or `npm test` script.

## Android JavaScript bridge contract

The active WebView registers `window.AndroidApp` from `AndroidAppInterface`. Available native signatures include:

| JavaScript method | Signature / behavior |
| --- | --- |
| `vibrate` | `vibrate(ms: number): void` |
| `showToast` | `showToast(message: string): void` |
| `logActivity` | `logActivity(description: string): void` |
| `openSettings`, `openAppSettings` | `(): void` |
| `hasCameraPermission`, `hasMicrophonePermission`, `hasNotificationPermission`, `canDrawOverlays` | `(): boolean` |
| `requestCameraPermission`, `requestMicrophonePermission`, `requestNotificationPermission` | `(): void` |
| `requestOverlayPermission`, `openOverlayPermission` | `(): void` |
| `requestAudioFocus`, `abandonAudioFocus` | `(): void` |
| `showNotification` | `(title: string, message: string): void` |
| `bringAppToFront` | `(): void` |
| `makePhoneCall` | `(phoneNumber?: string): void` |
| `requestPermissions` | `(types: string[]): void` (native also exposes a JSON-string overload) |
| `isNativeApp`, `getAppVersion` | `(): boolean` and `(): string` |
| `signInWithCustomToken` | `(token: string): void`; uses the trusted web session to authenticate the native Firestore listener |
| `signOutFirebase` | `(): void`; clears the native Firebase session when the web account signs out |

The web layer falls back to browser vibration, `tel:` links, and ordinary browser permission/file APIs where implemented. Android source is present, but a device/APK end-to-end run was not performed; do not treat the native runtime as verified until tested on a device.

The root Gradle project includes `:app`; the separate `android-app/` source tree is legacy and is not included in the active Gradle settings.

## End-to-end verification checklist

- [ ] Upload a photo through Send Pic and confirm it reaches Telegram, Firebase Storage, and the private Firestore metadata document.
- [ ] Upload a Gallery photo and verify the authorized viewer can open it while an unauthenticated viewer is denied.
- [ ] Record a voice note and confirm Telegram delivery, Storage upload, and admin-only playback.
- [ ] Send `/notify <message>` from an allowlisted Telegram sender; replay the same update and verify only one Firestore notification appears.
- [ ] Confirm the authorized app listener displays the notification; verify an unauthorized account cannot read it.
- [ ] Test the native bridge calls and file/camera/microphone permissions on the production Android APK.
