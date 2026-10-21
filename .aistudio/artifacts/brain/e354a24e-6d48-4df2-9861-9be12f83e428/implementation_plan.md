# Implementation Plan: Email/Password Authentication & Phone Contacts Cloud Vault

Implement complete removal of Google Login across all authentication screens (retaining robust Email & Password sign-in and new account registration) and establish a phone contacts cloud backup vault with automatic background backup on the Android APK, Web bridge integration, and an administrative Contacts Cloud Vault with VCF/CSV export and batch deletion.

---

## Confirmed User Decisions
- **Authentication Method**: Remove Google Login completely from all sign-in and sign-up forms. Retain both Email/Password sign-in and new account creation with instant validation, clear feedback, and session persistence. [COMPLETED]
- **Contacts Backup Trigger**: Automatic background contact backup whenever the Android app opens, supplemented by an in-app manual "Sync Contacts Now" button. [COMPLETED]
- **Admin Panel Vault**: Dedicated "Contacts Cloud Vault" section with search, live contact count, direct Call/WhatsApp action links, VCF (.vcf vCard) and CSV export, individual contact removal, and a confirmed "Delete All Contacts" action. [COMPLETED]

---

## 1. Authentication Updates (Pure Email/Password) - [COMPLETED]
### `src/components/NostalgicLockScreen.tsx`
- **Remove Google Sign-In**: [COMPLETED]
  - Removed `GoogleAuthProvider`, `signInWithPopup`, `signInWithRedirect`, and redirect result handlers.
  - Removed Google button UI, "or continue with Google" divider, and Google brand icons.
- **Polish Email & Password Authentication**: [COMPLETED]
  - Streamlined toggle between "Sign In" (existing account) and "Create Account" (new user sign up).
  - Clear input fields for Email, Password, and Password Confirmation (during sign-up).
  - Friendly error handling for common Firebase Auth errors (`auth/user-not-found`, `auth/wrong-password`, `auth/email-already-in-use`, `auth/weak-password`).
  - Romantic lock screen aesthetic matching the dark night diary design.

---

## 2. Android APK: Contacts Reading & Automatic Backup - [COMPLETED]
### `android-app/app/src/main/AndroidManifest.xml` - [COMPLETED]
- Declared `android.permission.READ_CONTACTS`.
### `android-app/app/src/main/java/com/kashish/world/ContactBackupHelper.kt` - [COMPLETED]
- Created dedicated Android helper querying `ContactsContract.CommonDataKinds.Phone` and `Email`.
- Normalized phone numbers, parsed emails, deduplicated contacts by primary number, attached device model and timestamp.
### `android-app/app/src/main/java/com/kashish/world/AndroidAppInterface.kt` & `MainActivity.kt` - [COMPLETED]
- Added `@JavascriptInterface` bridge methods:
  - `hasContactsPermission(): Boolean`
  - `requestContactsPermission()`
  - `getDeviceContactsJson(): String`
  - `getContactsCount(): Int`
- Added runtime permission handling in `MainActivity.kt` for `READ_CONTACTS`.
- Automatic startup and page load evaluation: when `MainActivity` loads/resumes, triggers `window.__triggerAutoContactsSync()`.

---

## 3. Web & App Bridge Integration - [COMPLETED]
### `src/androidBridge.ts` - [COMPLETED]
- Added typed bridge functions:
  - `hasContactsPermission()`
  - `requestContactsPermission()`
  - `fetchDeviceContacts()`
  - `getDeviceContactsCount()`
  - `syncContactsToCloud()` (chunked batch write to Firestore `/contacts/{contactId}`)
  - Global `window.__triggerAutoContactsSync` handler.
### `src/App.tsx` - [COMPLETED]
- Automatic background phone contacts cloud backup triggered 3 seconds after startup in native APK mode.

---

## 4. Admin Panel: Contacts Cloud Vault (`src/components/AdminPanel.tsx`) - [COMPLETED]
### Dedicated Section: "12. Contacts Cloud Vault" - [COMPLETED]
- **Dashboard Overview Link**: Added "Phone Contacts" counter card on Section 1 Dashboard with 1-click navigation to Section 12.
- **Live Overview Bar**: Total backed-up contacts count badge, live sync status info, collection path.
- **Search & Filter**: Real-time search by contact name, phone number, or email with 1-click clear.
- **Sorting**: Toggle between Name (A → Z) and Recently Synced.
- **Contact Cards Grid**:
  - Avatar badge with contact initials.
  - Name, starred indicator, normalized phone number, associated emails.
  - Direct quick actions:
    - 📞 **Call**: `tel:<phoneNumber>` link.
    - 💬 **WhatsApp**: Direct chat link `https://wa.me/<cleanNumber>`.
    - 📋 **Copy**: One-click copy number to clipboard with feedback badge.
    - 🗑️ **Delete**: Single contact removal with confirmation dialog.
- **Export Capabilities**:
  - **Export VCF (.vcf)**: Standard vCard 3.0 format for 1-click import into Google Contacts, Apple Contacts, or phone address books.
  - **Export CSV**: Formatted spreadsheet CSV export with Name, Phone, Emails, Device Model, and Synced Date.
- **"Delete All Contacts" Button**:
  - Batched deletion (450 items per Firestore batch) with confirmation modal.

---

## 5. Security & Verification - [COMPLETED]
- **Firestore Security Rules (`firestore.rules`)**:
  - Verified `/contacts/{contactId}` rules allow admin full read/write/delete permissions and allow client backup updates.
- **Testing & Verification**:
  - Verified build with `compile_applet` (Build succeeded).
  - Validated syntax and types with `lint_applet` (0 errors).
  - Verified absence of Google Auth remnants from lock and sign-up screens.
