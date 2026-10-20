# 💖 Kashish's World — Complete Setup Steps (Hinglish Guide)

Ye guide aapko bina Android Studio ke APK download karne, phone me install karne, Play Protect bypass karne, aur Realme/ColorOS settings set karne me help karegi taaki **Notifications**, **System Overlay Popups**, aur **Direct 1-Tap Phone Call** 100% kaam karein (app band hone par bhi).

---

## 1. GitHub Actions se APK Kaise Download Karein (No Android Studio Needed)
1. Apne GitHub repo me **`Actions`** tab par click karein.
2. Left side me **`CI (Web + Android APK Artifact)`** workflow select karein (ya **`Run workflow`** button dabayein).
3. Jab workflow green tick (`✅`) ho jaye, us run par click karein aur neeche **Artifacts** section me **`kashish-world-debug-apk`** download karein.
4. ZIP file extract karein — andar aapko **`app-debug.apk`** milega.
5. *(Optional for Native FCM)*: Agar aapke paas Firebase console se `google-services.json` hai, toh GitHub Repo -> **Settings -> Secrets and variables -> Actions** me **`GOOGLE_SERVICES_JSON`** naam ka secret bana kar uska JSON paste kar dein.

---

## 2. APK Install Kaise Karein & Play Protect "Install Anyway"
Jab aap phone me `app-debug.apk` open karenge:
1. Agar Chrome/Files puche **"Install unknown apps"**, toh **Settings -> Allow from this source** ON karein.
2. **Google Play Protect Warning Popup** aayega (*"Blocked by Play Protect"* ya *"Unsafe app blocked"*):
   - Popup me **`More details`** (chhota dropdown arrow) par tap karein.
   - Neeche **`Install anyway`** par tap karein.
   - Agar PIN/Fingerprint maange toh verify karein — app install ho jayegi!
   - Agar **"Send app for scanning"** puche toh **`Don't send`** ya **`Scan`** dono me se kuch bhi kar sakte hain.

---

## 3. First-Launch Permission Setup Screen (5 Green Ticks ✅)
App pehli baar open hote hi **One-Time Permission Setup** screen khulegi. Wahan 5 buttons hain — ek-ek karke sabko ON karein jab tak sab par **`Granted ✅`** na aa jaye:
1. **1. Notifications** -> `Allow` karein.
2. **2. Display Over Other Apps** -> List me **Kashish's World** dhoondhein aur **`Allow display over other apps`** toggle ON karein (isse app band hone par bhi full popup screen ke upar aayega).
3. **3. Direct Phone Call** -> `Allow` karein (isse popup me **"Call Right Now 📞"** dabate hi bina dialer khule seedha call lag jayegi).
4. **4. Battery 'No Restriction'** -> `Allow` / `Unrestricted` select karein.
5. **5. Autostart / Background Launch** -> Tap karke **Kashish's World** ka Autostart ON karein.
6. Ab **`Continue to Kashish's World 💖`** par tap karein! Saare permissions ka live status aapke Admin Panel -> **Activity** tab me dikhne lagega.

---

## 4. Realme / ColorOS / Oppo Special Settings (Bahut Zaroori 🚨)
Realme phones background apps ko kill kar dete hain. Kashish ke phone me ye 3 settings zaroor check karein:
1. **Battery Unrestricted**:
   - Phone `Settings` -> `Apps` -> `App management` -> **Kashish's World** -> `Battery usage` -> **`Allow background activity`** aur **`Allow auto launch`** dono ON karein.
2. **Lock App in Recent Tasks**:
   - App open karein -> Recent Apps (3-lines button) kholein -> **Kashish's World** ke upar **3 dots (`⋮`)** par tap karke **`Lock`** laga dein.
3. **Full Screen & Banner Notifications**:
   - `Settings` -> `Apps` -> `App management` -> **Kashish's World** -> `Manage notifications` -> **`Allow notifications`**, **`Lock screen`**, aur **`Banner`** sab ON rakhein.

---

## 5. Server Environment Variables (Vercel / Cloud Run / Render)
Apne server environment me ye variables set karein (kisi bhi file me service account key hardcode nahi karni hai):
- **`FIREBASE_SERVICE_ACCOUNT_KEY`**: Firebase Console -> *Project Settings -> Service accounts -> Generate new private key* se mile JSON ko single-line string bana kar paste karein.
- **`FIREBASE_PROJECT_ID`**: `kashishhji`
- **`ADMIN_EMAIL`**: `jayshankar431@gmail.com`

---

## 6. Admin Panel Kaise Use Karein
- **Notifications Tab**: Title, message, aur saved sound select karein (ya Cloudinary par naya MP3 upload karein) -> **Send Now**.
- **Popups Tab**: Title, message, optional photo, popup color, aur 1 se 3 buttons (`Call Right Now`, `Call Later`, `Open URL`, `Open Section`) set karein. Aap ise **Template** ki tarah save karke 1-tap me dobara bhej sakte hain.
- **Music Tab**: Music URL, Live Volume slider (`0% - 100%`), aur Master ON/OFF switch live update karein.
- **Sections Tab**: 11 block types (`text`, `image`, `gallery`, `video`, `button`, `music`, `countdown`, `letter`, `quote`, `card`, `banner`) kisi bhi slot me add/reorder/ON-OFF karein, ya **Unlimited Custom Tabs** banayein. Jo slot empty ya OFF hai wo bilkul zero space leta hai.
- **Settings Tab**: Call Phone Number (ye sirf `private_site_content` me save hota hai, public files me kabhi nahi), Lock Password Hash & Hint, aur App Texts update karein.
