/**
 * =========================================================================
 * 💌 CONFIGURATION - PERSONAL TOUCHES FOR KASHISH'S WORLD
 * Edit the values below to customize name, dates, photos, and messages!
 * =========================================================================
 */
export const CONFIG = {
  // 🌟 Recipient's Name
  name: "Kashish",

  // 🎂 Birthday (Format: YYYY-MM-DD)
  birthday: "2026-12-17",

  // 🎁 Birthday Surprise Spinner & Flipkart Gift Card Settings
  // The surprise unlocks on December 16 at 11:59 PM Asia/Kolkata (IST), immediately before the birthday starts (Dec 17).
  birthdaySurprise: {
    // Target year for the birthday surprise countdown:
    // - If set to 2025: Target has arrived -> Unlocks the "🎁 Claim Your Birthday Surprise" button & spinner
    // - If set to 2026: Displays live countdown counting down to December 16 at 11:59 PM IST
    targetYear: 2026,
    targetMonth: 12, // December
    targetDay: 16,   // 16 December (at 11:59 PM IST right before Dec 17 begins)
    targetHour: 23,  // 23:59:00 IST (Asia/Kolkata timezone)
    targetMinute: 59,

    // 🏷️ Amazon Gift Card ₹300 Voucher Code Placeholder
    // Replace "YOUR_AMAZON_GIFT_CARD_CODE" with your real Amazon gift card code:
    amazonGiftCardCode: "YOUR_AMAZON_GIFT_CARD_CODE",
    flipkartGiftCardCode: "YOUR_AMAZON_GIFT_CARD_CODE",

    // 🧪 Testing toggle: Set to true to preview the unlocked surprise button at any time regardless of date:
    forceUnlockForTesting: true,

    // 🧪 Test Reset Button:
    // - true: Shows the "Reset Gift (Test Mode Only)" button so YOU can test the ₹300 first-spin reward anytime.
    // - false: Hides the reset button completely so the final stable app for Kashish is 100% clean with zero test controls!
    showTestResetButton: true,
  },

  // 🎨 Her Favourite Things
  favouriteColour: "Lavender & Soft Rose Pink",
  favouriteFood: "Chocolate Strawberries & Creamy Pasta",
  favouriteSong: "Golden Hour - JVKE",

  // 🔑 Entry Lock Password & Hint
  // Set your main entry password here directly. Spaces and capitalization are handled automatically.
  entryPassword: "",
  // SHA-256 hash of normalized password "daydream"
  entryLockHash: "",
  entryLockHint: "Hint: Ask to Jay",
  entryPlaceholder: "Enter secret password...",

  // 🔑 Entry Lock Screen Photo URL (Change this URL to customize the photo on the entry lock screen!)
  lockPhotoUrl: "https://res.cloudinary.com/dsfcu9y1h/image/upload/v1790940725/Golden_Gaze_in_a_Neon_Circle_hztvx3.png",

  // 📱 Progressive Web App (PWA) Settings
  appName: "Kashish's World",
  shortName: "Kashish",
  // App Icon URL (Will build 192x192, 512x512, and maskable icons automatically if Cloudinary URL)
  appIconUrl: "https://res.cloudinary.com/dsfcu9y1h/image/upload/v1791191256/Royal_Purple_Eye_Portrait_Icon_vbflga.png",
  themeColor: "#11061b",
  backgroundColor: "#11061b",
  display: "standalone",
  orientation: "portrait",
  installButtonText: "Add to My Heart 💗",

  // 🔑 Secret Letter Password & Daily Date Hint
  secretLetterHash: "",
  passwordHint: "",
  // 🎵 Secret Letter Emotional BGM (plays automatically when secret letter is unlocked with password)
  secretLetterMusicUrl: "",

  // 🛡️ Admin panel login (Firebase Authentication, Email/Password)
  // 1) Firebase Console -> Authentication -> Sign-in method -> Email/Password ON
  // 2) Authentication -> Users -> Add user (yahi email + ek strong password)
  // 3) Yahan apna wahi email likho aur firestore.rules me bhi SAME email likho
  adminEmail: "jayshankar431@gmail.com",

  // 🤖 Telegram Bot Activity Tracking
  // Create a bot via @BotFather and get your Chat ID via @userinfobot
  // ⚠️ Telegram band hai: bot token public repo/site me nahi rakh sakte (koi bhi chura sakta hai).
  // Sab activity ab admin panel me dikhti hai. Purana token @BotFather -> /revoke se band karo.
  telegramBot: {
    enabled: true,
    token: "USED_SERVER_SIDE",
    chatId: "USED_SERVER_SIDE",
  },

  // 📜 Personal Message displayed in the Secret Letter
  personalMessage: `I don't know how to explain what you mean to me,

because somehow you became more than just someone I talk to.

I didn't fall for you only because of your face, your smile, or the way you look.

I fell for your words, your little habits, your way of being,

and somehow, I even fell in love with your name.

Just seeing your name can make me smile.

Right now, we talk, we share things, and you're a part of my everyday life.

But sometimes I get scared thinking about the future.

What if one day our conversations become less, our lives change,

and we slowly become strangers who once knew everything about each other?

I don't know if that will ever happen,

but if it does, I know I'll still remember the little things about you that you may have forgotten.

I might remember something you said, a random conversation,

or a small moment that probably meant nothing to you but meant so much to me.

I don't expect you to love me the way I love you,

and I don't want you to feel guilty for that.

I just want you to know that what I feel for you is real.

You don't have to be mine for me to care about you.

I just feel lucky that I got to know you, talk to you, and have you in my life,

even for however long life allows.

And if someday we really do become strangers, I hope you remember one thing:

you were never just a person I talked to.

You were someone I loved with my whole heart.

No matter where life takes us, a small part of my heart will always remember you.

I love you, more than I can ever properly put into words.

And you once told me, “Never propose to me,” so I didn't.

I didn't make this website to propose to you or to ask you for anything.

I just had so many feelings inside me that I didn't know how to say them.

So I turned them into this little website instead.

Maybe I couldn't say everything to you with my voice,

so I let this website speak for my heart.`,

  // 8 Heartfelt Compliments (used in Spin Wheel, Jar & Cards)
  compliments: [
    "Your smile has the rare power to brighten even the gloomiest afternoon.",
    "The kindness in your heart is a quiet strength that inspires everyone.",
    "Your laughter is genuinely my favorite sound in the whole world.",
    "You carry a calm, effortless grace that makes everyone around you feel at peace.",
    "Your eyes hold a warmth that makes conversations feel like safe harbors.",
    "You are thoughtful, observant, and deeply caring in ways words cannot capture.",
    "The world is simply softer, gentler, and more beautiful with you in it.",
    "Never forget how extraordinary you are, even on the days you doubt yourself."
  ],




  // 🎵 Background Music URL (Emotional Sad BGM - Saiyaara Sad Background Music)
  musicUrl: "https://res.cloudinary.com/dsfcu9y1h/video/upload/v1791126913/Saiyaara_Sad_Background_Music___Film_Version___Recreated_by_Dhaval_K_Raval_saiyaara_xpnhvm.mp3",


  // 💌 "OPEN WHEN..." POST OFFICE ENVELOPES (12 emotional letters & interactive surprises)
  // Each envelope has label, emoji, moodColor, letterText, surpriseType, and optional unlockRule
  openWhen: [],

  // Breathe With Me - A peaceful breathing corner configuration
  breatheConfig: {
    // Welcoming note before starting
    introText: "Sit comfortably. Relax your shoulders. There is no rush.",
    // Default duration in minutes (1, 3, or 5)
    defaultDurationMinutes: 3,
    // Default mode ('calm', 'easy', or 'deep-rest')
    defaultModeId: "calm",
    // Breathing modes with inhale, hold, and exhale durations in seconds
    modes: [
      {
        id: "calm",
        name: "Calm",
        inhale: 4,
        hold: 2,
        exhale: 6,
        description: "Inhale 4s · Hold 2s · Exhale 6s",
      },
      {
        id: "easy",
        name: "Easy",
        inhale: 4,
        hold: 0,
        exhale: 4,
        description: "Inhale 4s · Exhale 4s",
      },
      {
        id: "deep-rest",
        name: "Deep Rest",
        inhale: 4,
        hold: 4,
        exhale: 8,
        description: "Inhale 4s · Hold 4s · Exhale 8s",
      },
    ],
    // 8 warm, simple messages shown when the session completes
    calmMessages: [
      "You did beautifully. Carry this calm with you.",
      "Your mind is peaceful, your heart is light.",
      "Remember: you are allowed to slow down anytime.",
      "Every gentle breath is a little hug for your soul.",
      "The world can wait while you take care of you.",
      "Soft heart, quiet mind. You are doing so well.",
      "Peace begins with this very moment.",
      "Breathe in love, breathe out everything else.",
    ],
  },
};


