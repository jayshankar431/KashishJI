import React, { useState, useEffect } from 'react';
import {
  Eye,
  EyeOff,
  Sparkles,
  Heart,
  Sun,
  Moon,
  Unlock,
  Mail,
  Lock,
  User,
  LogIn,
  UserPlus,
  Loader2,
  KeyRound,
  ShieldAlert,
  Clock,
  LogOut,
  Settings,
} from 'lucide-react';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  updateProfile,
  sendPasswordResetEmail,
  EmailAuthProvider,
  linkWithCredential,
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, googleProvider, db, ADMIN_EMAIL } from '../firebase';
import { romanticAudio } from '../audio';
import { triggerHaptic, logNativeActivity, showNativeToast } from '../androidBridge';

interface NostalgicLockScreenProps {
  name: string;
  lockPhotoUrl?: string;
  expectedPassword?: string;
  expectedHash?: string;
  hintText: string;
  placeholder?: string;
  onUnlock: () => void;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  approvalStatus?: 'loading' | 'approved' | 'pending' | 'rejected' | 'unauthenticated';
  currentUserEmail?: string | null;
  currentUserName?: string | null;
  onSignOutUser?: () => void;
  onShowAdmin?: () => void;
}

export const NostalgicLockScreen: React.FC<NostalgicLockScreenProps> = ({
  name,
  lockPhotoUrl,
  onUnlock,
  isDarkMode,
  onToggleDarkMode,
  approvalStatus = 'unauthenticated',
  currentUserEmail,
  currentUserName,
  onSignOutUser,
  onShowAdmin,
}) => {
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [successNotice, setSuccessNotice] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  const [isDiaryFlipping, setIsDiaryFlipping] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [localApprovalStatus, setLocalApprovalStatus] = useState<'pending' | 'rejected' | null>(null);

  // Handle Google Redirect Sign-In completion on mobile / in-app browsers
  useEffect(() => {
    getRedirectResult(auth)
      .then(async (result) => {
        if (result?.user) {
          const status = await saveUserToFirestore(
            result.user.uid,
            result.user.email,
            result.user.displayName,
            'google_redirect',
            result.user.photoURL
          );
          if (status === 'approved') {
            logNativeActivity(`🔓 Google Sign-In: <b>${result.user.email}</b>`, true);
            triggerUnlock(result.user.displayName || result.user.email?.split('@')[0]);
          } else {
            setLocalApprovalStatus(status);
            showNativeToast('Signed in! Waiting for Admin approval 🔒');
          }
        }
      })
      .catch(() => {
        // Ignore if no redirect was pending
      });
  }, []);

  const triggerUnlock = (displayName?: string | null) => {
    setIsSuccess(true);
    setFeedbackMessage('');

    if (typeof window !== 'undefined' && window.AndroidApp?.vibrate) {
      window.AndroidApp.vibrate(40);
    } else {
      triggerHaptic(40);
    }

    const welcomeUser = displayName || name;
    showNativeToast(`Welcome to ${name}'s World, ${welcomeUser}! 💖`);

    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    romanticAudio.playChime();

    setTimeout(() => {
      setIsDiaryFlipping(true);
    }, 350);

    setTimeout(() => {
      onUnlock();
    }, 800);
  };

  const formatFirebaseError = (err: any): string => {
    const code = err?.code || '';
    switch (code) {
      case 'auth/invalid-email':
        return 'Please enter a valid email address.';
      case 'auth/user-not-found':
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
        return 'Wrong password, or this Gmail was logged in via Google (no password set yet). Click "Forgot Password?" to set a password for this email!';
      case 'auth/email-already-in-use':
        return 'This email is already registered (e.g. via Google). Click "Forgot Password?" on Sign In to set a password for it.';
      case 'auth/weak-password':
        return 'Password must be at least 6 characters long.';
      case 'auth/operation-not-allowed':
        return 'Please enable Email/Password in Firebase Console → Authentication → Sign-in method.';
      case 'auth/unauthorized-domain':
        return `For Google login, add "${typeof window !== 'undefined' ? window.location.hostname : 'this domain'}" in Firebase Console → Authentication → Settings → Authorized domains, or sign in with Email & Password above.`;
      case 'auth/popup-closed-by-user':
        return 'Google Sign-In popup was closed before finishing.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Please wait a moment and try again.';
      default:
        return err?.message || 'Authentication failed. Please try again.';
    }
  };

  const saveUserToFirestore = async (
    uid: string,
    userEmail: string | null,
    displayName: string | null,
    method: string,
    photoURL?: string | null
  ): Promise<'approved' | 'pending' | 'rejected'> => {
    const isAdminUser = userEmail?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    if (isAdminUser) {
      try {
        await setDoc(
          doc(db, 'users', uid),
          {
            uid,
            email: userEmail || ADMIN_EMAIL,
            displayName: displayName || 'Admin (Jay)',
            photoURL: photoURL || '',
            authMethod: method,
            approved: true,
            status: 'approved',
            role: 'admin',
            lastLoginAt: serverTimestamp(),
          },
          { merge: true }
        );
      } catch {}
      return 'approved';
    }

    try {
      const userRef = doc(db, 'users', uid);
      const snap = await getDoc(userRef);

      if (snap.exists()) {
        const data = snap.data();
        const isAlreadyApproved = data.approved === true || data.status === 'approved';
        const currentStatus: 'approved' | 'pending' | 'rejected' = isAlreadyApproved
          ? 'approved'
          : data.status === 'rejected'
          ? 'rejected'
          : 'pending';

        await setDoc(
          userRef,
          {
            uid,
            email: userEmail || data.email || '',
            displayName: displayName || data.displayName || userEmail?.split('@')[0] || name,
            photoURL: photoURL || data.photoURL || '',
            authMethod: method,
            lastLoginAt: serverTimestamp(),
            ...(data.approved === undefined ? { approved: false, status: 'pending', createdAt: Date.now() } : {}),
          },
          { merge: true }
        );

        return currentStatus;
      } else {
        await setDoc(
          userRef,
          {
            uid,
            email: userEmail || '',
            displayName: displayName || userEmail?.split('@')[0] || 'New User',
            photoURL: photoURL || '',
            authMethod: method,
            approved: false,
            status: 'pending',
            createdAt: Date.now(),
            lastLoginAt: serverTimestamp(),
          },
          { merge: true }
        );
        logNativeActivity(`⏳ Approval Pending for New User: <b>${userEmail || displayName}</b> (${method})`, true);
        return 'pending';
      }
    } catch {
      return 'pending';
    }
  };

  const linkPasswordViaGooglePopup = async (targetEmail: string, newPassword: string, displayNameToSet?: string): Promise<boolean> => {
    try {
      googleProvider.setCustomParameters({ login_hint: targetEmail });
      const googleResult = await signInWithPopup(auth, googleProvider);
      if (googleResult.user.email?.toLowerCase() === targetEmail.toLowerCase()) {
        const credential = EmailAuthProvider.credential(targetEmail, newPassword);
        await linkWithCredential(googleResult.user, credential).catch(() => {});
        if (displayNameToSet) {
          await updateProfile(googleResult.user, { displayName: displayNameToSet }).catch(() => {});
        }
      }
      const status = await saveUserToFirestore(
        googleResult.user.uid,
        googleResult.user.email,
        displayNameToSet || googleResult.user.displayName,
        'email_and_google_linked',
        googleResult.user.photoURL
      );
      if (status === 'approved') {
        logNativeActivity(`🔗 Password Linked & Signed In: <b>${googleResult.user.email}</b>`, true);
        triggerUnlock(displayNameToSet || googleResult.user.displayName || googleResult.user.email?.split('@')[0]);
      } else {
        setLocalApprovalStatus(status);
        showNativeToast('Account linked! Waiting for Admin approval 🔒');
      }
      return true;
    } catch {
      return false;
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isLoading || isSuccess) return;

    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();
    const trimmedName = fullName.trim();

    if (!trimmedEmail || !trimmedPassword) {
      setFeedbackMessage('Please enter both your email and password.');
      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 600);
      return;
    }

    if (trimmedPassword.length < 6) {
      setFeedbackMessage('Password must be at least 6 characters long.');
      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 600);
      return;
    }

    setIsLoading(true);
    setFeedbackMessage('');
    setSuccessNotice('');

    try {
      if (authMode === 'signup') {
        try {
          const userCredential = await createUserWithEmailAndPassword(auth, trimmedEmail, trimmedPassword);
          if (trimmedName) {
            await updateProfile(userCredential.user, { displayName: trimmedName }).catch(() => {});
          }
          const status = await saveUserToFirestore(
            userCredential.user.uid,
            userCredential.user.email,
            trimmedName || userCredential.user.displayName,
            'email_signup',
            userCredential.user.photoURL
          );
          if (status === 'approved') {
            logNativeActivity(`✨ New Account Created: <b>${trimmedEmail}</b>`, true);
            triggerUnlock(trimmedName || userCredential.user.email?.split('@')[0]);
          } else {
            setLocalApprovalStatus(status);
            showNativeToast('Account created! Waiting for Admin approval 🔒');
          }
        } catch (signUpErr: any) {
          if (signUpErr?.code === 'auth/email-already-in-use') {
            try {
              const userCredential = await signInWithEmailAndPassword(auth, trimmedEmail, trimmedPassword);
              const status = await saveUserToFirestore(
                userCredential.user.uid,
                userCredential.user.email,
                userCredential.user.displayName,
                'email_signin',
                userCredential.user.photoURL
              );
              if (status === 'approved') {
                logNativeActivity(`🔓 Signed In: <b>${trimmedEmail}</b>`, true);
                triggerUnlock(userCredential.user.displayName || userCredential.user.email?.split('@')[0]);
              } else {
                setLocalApprovalStatus(status);
                showNativeToast('Signed in! Waiting for Admin approval 🔒');
              }
              return;
            } catch {
              const linked = await linkPasswordViaGooglePopup(trimmedEmail, trimmedPassword, trimmedName);
              if (linked) return;
              throw signUpErr;
            }
          } else {
            throw signUpErr;
          }
        }
      } else {
        try {
          const userCredential = await signInWithEmailAndPassword(auth, trimmedEmail, trimmedPassword);
          const status = await saveUserToFirestore(
            userCredential.user.uid,
            userCredential.user.email,
            userCredential.user.displayName,
            'email_signin',
            userCredential.user.photoURL
          );
          if (status === 'approved') {
            logNativeActivity(`🔓 Signed In: <b>${trimmedEmail}</b>`, true);
            triggerUnlock(userCredential.user.displayName || userCredential.user.email?.split('@')[0]);
          } else {
            setLocalApprovalStatus(status);
            showNativeToast('Signed in! Waiting for Admin approval 🔒');
          }
        } catch (signInErr: any) {
          if (
            signInErr?.code === 'auth/invalid-credential' ||
            signInErr?.code === 'auth/user-not-found'
          ) {
            try {
              const newCredential = await createUserWithEmailAndPassword(auth, trimmedEmail, trimmedPassword);
              const defaultName = trimmedEmail.split('@')[0];
              await updateProfile(newCredential.user, { displayName: defaultName }).catch(() => {});
              const status = await saveUserToFirestore(
                newCredential.user.uid,
                newCredential.user.email,
                defaultName,
                'email_auto_signup',
                newCredential.user.photoURL
              );
              if (status === 'approved') {
                logNativeActivity(`✨ Account Created & Signed In: <b>${trimmedEmail}</b>`, true);
                triggerUnlock(defaultName);
              } else {
                setLocalApprovalStatus(status);
                showNativeToast('Account created! Waiting for Admin approval 🔒');
              }
              return;
            } catch (autoSignUpErr: any) {
              if (autoSignUpErr?.code === 'auth/email-already-in-use') {
                throw signInErr;
              }
              throw autoSignUpErr;
            }
          }
          throw signInErr;
        }
      }
    } catch (err: any) {
      romanticAudio.playChime();
      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 600);
      setFeedbackMessage(formatFirebaseError(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (isLoading || isSuccess) return;
    setIsLoading(true);
    setFeedbackMessage('');
    setSuccessNotice('');

    try {
      const result = await signInWithPopup(auth, googleProvider);
      const status = await saveUserToFirestore(
        result.user.uid,
        result.user.email,
        result.user.displayName,
        'google',
        result.user.photoURL
      );
      if (status === 'approved') {
        logNativeActivity(`🔓 Google Sign-In: <b>${result.user.email}</b>`, true);
        triggerUnlock(result.user.displayName || result.user.email?.split('@')[0]);
      } else {
        setLocalApprovalStatus(status);
        showNativeToast('Google account registered! Waiting for Admin approval 🔒');
      }
    } catch (err: any) {
      if (err?.code === 'auth/popup-blocked') {
        try {
          await signInWithRedirect(auth, googleProvider);
          return;
        } catch (redirErr: any) {
          setFeedbackMessage(formatFirebaseError(redirErr));
        }
      } else {
        setIsShaking(true);
        setTimeout(() => setIsShaking(false), 600);
        setFeedbackMessage(formatFirebaseError(err));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setFeedbackMessage('Enter your email address above first to reset your password.');
      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 600);
      return;
    }

    setIsLoading(true);
    setFeedbackMessage('');
    setSuccessNotice('');
    try {
      await sendPasswordResetEmail(auth, trimmedEmail);
      setSuccessNotice(`Password reset link sent to ${trimmedEmail}! Check your inbox.`);
    } catch (err: any) {
      setFeedbackMessage(formatFirebaseError(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      style={{
        backgroundColor: 'var(--bg)',
        color: 'var(--text)',
        paddingTop: 'max(1rem, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))',
      }}
      className={`fixed inset-0 z-50 overflow-y-auto min-h-[100vh] min-h-[100dvh] flex flex-col justify-between items-center px-3 sm:px-4 py-4 sm:py-6 transition-all duration-700 select-none ${
        isDiaryFlipping ? 'opacity-0 scale-95 transition-all duration-700' : ''
      }`}
    >
      {/* Background Vignette & Fairy Lights Ambient Overlay */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div
          style={{
            background: isDarkMode
              ? 'radial-gradient(ellipse at center, transparent 40%, rgba(10, 4, 18, 0.7) 100%)'
              : 'radial-gradient(ellipse at center, transparent 45%, rgba(107, 58, 82, 0.15) 100%)',
          }}
          className="absolute inset-0"
        />

        {/* Fairy Lights String across the top */}
        <div className="absolute top-0 left-0 right-0 h-16 flex items-center justify-around px-4 pointer-events-none opacity-90">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="flex flex-col items-center">
              <div className="w-0.5 h-3 bg-slate-400/40" />
              <div
                style={{
                  backgroundColor: i % 2 === 0 ? '#fde047' : '#f472b6',
                  boxShadow:
                    i % 2 === 0
                      ? '0 0 12px 3px rgba(253, 224, 71, 0.6)'
                      : '0 0 12px 3px rgba(244, 114, 182, 0.6)',
                }}
                className="w-3.5 h-3.5 rounded-full animate-sparkle"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Top Bar with Brand Title & Dark/Light Toggle */}
      <header className="relative z-10 w-full max-w-md flex items-center justify-between pt-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
          <Sparkles className="w-3.5 h-3.5 text-amber-500 animate-sparkle" />
          <span>A Secret Haven</span>
        </div>

        <button
          onClick={onToggleDarkMode}
          title={isDarkMode ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
          aria-label={isDarkMode ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
          style={{
            backgroundColor: 'var(--card-subtle)',
            color: 'var(--text)',
            borderColor: 'var(--card-border)',
          }}
          className="min-h-[44px] min-w-[44px] p-2.5 rounded-full border flex items-center justify-center cursor-pointer shadow-xs active:scale-95"
        >
          {isDarkMode ? <Sun className="w-5 h-5 text-amber-300" /> : <Moon className="w-5 h-5 text-[var(--accent)]" />}
        </button>
      </header>

      {/* Main Content Area */}
      <main className="relative z-10 w-full max-w-sm my-auto text-center space-y-5 pt-3 pb-4">
        {/* Title */}
        <div className="space-y-1">
          <h1
            style={{
              color: 'var(--text)',
              textShadow: isDarkMode
                ? '0 0 20px rgba(244, 114, 182, 0.35)'
                : '0 0 16px rgba(214, 51, 108, 0.25)',
            }}
            className="font-serif text-3xl sm:text-4xl font-bold tracking-tight"
          >
            Enter {name}'s World
          </h1>
          <p
            style={{ color: 'var(--text-soft)' }}
            className="text-xs sm:text-sm font-semibold italic"
          >
            "Sign in or create your account to unlock this special diary."
          </p>
        </div>

        {/* Compact Vintage Polaroid Avatar Card */}
        <div
          className={`relative mx-auto w-44 sm:w-52 transition-transform duration-500 ${
            isShaking ? 'animate-shake' : ''
          }`}
        >
          {/* Washi-Tape Strip on top */}
          <div
            style={{
              backgroundColor: isDarkMode ? '#f472b6' : '#f3c6d6',
              boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
              transform: 'translateX(-50%) rotate(-2deg)',
            }}
            className="absolute -top-3 left-1/2 w-24 h-5 rounded-xs opacity-90 z-20 pointer-events-none border border-white/40"
          >
            <div className="w-full h-full flex items-center justify-center opacity-40 text-[8px] font-bold tracking-widest uppercase">
              • MEMORY •
            </div>
          </div>

          {/* Polaroid Frame */}
          <div
            style={{
              backgroundColor: 'var(--card-solid)',
              borderColor: 'var(--card-border)',
              boxShadow: '0 15px 35px var(--shadow-color)',
            }}
            className={`p-3 pb-4 rounded-2xl border-2 transition-all duration-700 transform rotate-1 ${
              isSuccess ? 'rotate-y-180 scale-105' : 'hover:rotate-0'
            }`}
          >
            <div
              style={{
                backgroundColor: 'var(--card-subtle)',
                borderColor: 'var(--card-border)',
              }}
              className="relative aspect-square w-full rounded-xl border flex flex-col items-center justify-center overflow-hidden p-2 shadow-inner"
            >
              <div
                style={{ backgroundColor: 'var(--accent)' }}
                className={`absolute w-32 h-32 rounded-full blur-2xl opacity-25 pointer-events-none ${
                  isSuccess ? 'animate-pulse opacity-50 scale-125 transition-all duration-700' : ''
                }`}
              />

              <div className="relative z-20 flex items-center justify-center">
                <div
                  className={`relative w-[130px] h-[130px] sm:w-[155px] sm:h-[155px] rounded-full p-1 border-2 border-amber-400/90 shadow-[0_0_25px_rgba(244,114,182,0.6)] transition-all duration-500 ${
                    isSuccess ? 'animate-heartbeat shadow-[0_0_45px_rgba(251,191,36,0.9)] border-amber-300' : 'animate-pulse'
                  }`}
                >
                  {!imgError && lockPhotoUrl ? (
                    <div className="relative w-full h-full rounded-full overflow-hidden bg-rose-200/30">
                      {!imgLoaded && (
                        <div className="absolute inset-0 bg-gradient-to-r from-rose-300/30 via-pink-200/50 to-rose-300/30 animate-pulse rounded-full" />
                      )}
                      <img
                        src={lockPhotoUrl}
                        alt={name}
                        onLoad={() => setImgLoaded(true)}
                        onError={() => setImgError(true)}
                        className={`w-full h-full object-cover object-center rounded-full transition-opacity duration-500 ${
                          imgLoaded ? 'opacity-100' : 'opacity-0'
                        }`}
                      />
                    </div>
                  ) : (
                    <div
                      style={{ backgroundColor: 'var(--accent)' }}
                      className="w-full h-full rounded-full flex flex-col items-center justify-center border-2 border-white/60 text-white shadow-lg"
                    >
                      <span className="text-2xl select-none">👑</span>
                      <Heart className="w-5 h-5 fill-white text-white mt-1" />
                    </div>
                  )}

                  {isSuccess && (
                    <div className="absolute inset-0 pointer-events-none z-40 flex items-center justify-center">
                      <Sparkles className="w-12 h-12 text-amber-300 animate-spin-slow drop-shadow-[0_0_15px_rgba(251,191,36,1)]" />
                      <div className="absolute inset-0 bg-amber-300/20 rounded-full animate-ping" />
                    </div>
                  )}

                  <div className="absolute -bottom-1 -right-1 z-30 flex flex-col items-center">
                    <span className="text-[10px] -mb-1 select-none animate-bounce drop-shadow-md">👑</span>
                    <div
                      style={{
                        backgroundColor: isSuccess ? '#10b981' : 'var(--accent)',
                        boxShadow: isSuccess
                          ? '0 0 15px rgba(16, 185, 129, 0.8)'
                          : '0 0 12px rgba(214, 51, 108, 0.7)',
                      }}
                      className="w-8 h-8 rounded-full border-2 border-white flex items-center justify-center text-white transition-all duration-500"
                    >
                      {isSuccess ? (
                        <Unlock className="w-3.5 h-3.5 animate-sparkle" />
                      ) : (
                        <Heart className="w-3.5 h-3.5 fill-white text-white" />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Sign In / Sign Up OR Pending Admin Approval Card */}
        <div
          style={{
            backgroundColor: 'var(--card-solid)',
            borderColor: 'var(--card-border)',
            boxShadow: '0 8px 25px var(--shadow-color)',
          }}
          className="p-5 sm:p-6 rounded-2xl border-2 space-y-4 transition-all text-left"
        >
          {(approvalStatus === 'pending' ||
            approvalStatus === 'rejected' ||
            localApprovalStatus === 'pending' ||
            localApprovalStatus === 'rejected') &&
          (currentUserEmail || auth.currentUser?.email) ? (
            <div className="space-y-4 text-center py-2 animate-fade-in">
              <div className="mx-auto w-14 h-14 rounded-2xl flex items-center justify-center border border-rose-500/30 bg-rose-500/10 text-rose-500">
                {(approvalStatus === 'rejected' || localApprovalStatus === 'rejected') ? (
                  <ShieldAlert className="w-7 h-7" />
                ) : (
                  <Clock className="w-7 h-7 animate-spin-slow" />
                )}
              </div>

              <div className="space-y-1.5">
                <h2
                  style={{ color: 'var(--text)' }}
                  className="font-serif text-xl sm:text-2xl font-bold"
                >
                  {(approvalStatus === 'rejected' || localApprovalStatus === 'rejected')
                    ? 'Access Declined by Admin'
                    : 'Waiting for Admin Approval'}
                </h2>
                <p
                  style={{ color: 'var(--text-soft)' }}
                  className="text-xs sm:text-sm font-medium leading-relaxed"
                >
                  {(approvalStatus === 'rejected' || localApprovalStatus === 'rejected')
                    ? 'Admin has restricted or declined access for this account. Please contact Jay or sign in with an approved account.'
                    : `Your account has been registered! You will automatically enter ${name}'s World as soon as the Admin approves your request.`}
                </p>
              </div>

              <div
                style={{
                  backgroundColor: 'var(--card-subtle)',
                  borderColor: 'var(--card-border)',
                }}
                className="p-3 rounded-xl border text-left space-y-1"
              >
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-soft)]">
                  Signed In Account
                </div>
                <div className="text-sm font-bold text-[var(--text)] truncate">
                  {currentUserName || auth.currentUser?.displayName || 'New User'}
                </div>
                <div className="text-xs text-[var(--text-soft)] truncate">
                  {currentUserEmail || auth.currentUser?.email}
                </div>
                <div className="pt-1 flex items-center gap-1.5 text-[11px] font-bold text-amber-500">
                  <span>
                    Status:{' '}
                    {(approvalStatus === 'rejected' || localApprovalStatus === 'rejected')
                      ? 'Blocked / Declined'
                      : 'Pending Admin Approval (Live Sync Active)'}
                  </span>
                </div>
              </div>

              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setLocalApprovalStatus(null);
                    if (onSignOutUser) {
                      onSignOutUser();
                    } else {
                      auth.signOut().catch(() => {});
                    }
                  }}
                  style={{
                    backgroundColor: 'var(--card-subtle)',
                    borderColor: 'var(--card-border)',
                    color: 'var(--text)',
                  }}
                  className="w-full min-h-[44px] px-4 py-2.5 rounded-xl border text-xs sm:text-sm font-bold flex items-center justify-center gap-2 cursor-pointer hover:opacity-90 active:scale-[0.98] transition-all"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sign Out / Use Another Account</span>
                </button>

                {onShowAdmin && (
                  <button
                    type="button"
                    onClick={onShowAdmin}
                    className="w-full min-h-[40px] px-4 py-2 rounded-xl text-xs font-semibold text-[var(--text-soft)] hover:text-[var(--accent)] flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <Settings className="w-3.5 h-3.5" />
                    <span>Admin Control Center</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Mode Switch Tabs */}
              <div
                style={{
                  backgroundColor: 'var(--card-subtle)',
                  borderColor: 'var(--card-border)',
                }}
                className="grid grid-cols-2 p-1 rounded-xl border gap-1"
              >
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('signin');
                    setFeedbackMessage('');
                    setSuccessNotice('');
                  }}
                  className={`py-2.5 px-3 rounded-lg text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    authMode === 'signin'
                      ? 'bg-gradient-to-r from-rose-500 to-pink-500 text-white shadow-sm'
                      : 'text-[var(--text-soft)] hover:text-[var(--text)]'
                  }`}
                >
                  <LogIn className="w-4 h-4" />
                  <span>Sign In</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('signup');
                    setFeedbackMessage('');
                    setSuccessNotice('');
                  }}
                  className={`py-2.5 px-3 rounded-lg text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    authMode === 'signup'
                      ? 'bg-gradient-to-r from-rose-500 to-pink-500 text-white shadow-sm'
                      : 'text-[var(--text-soft)] hover:text-[var(--text)]'
                  }`}
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Sign Up</span>
                </button>
              </div>

              <form onSubmit={handleAuthSubmit} className="space-y-3">
                {/* Name Field (Sign Up Only) */}
                {authMode === 'signup' && (
                  <div className="relative">
                    <User
                      style={{ color: 'var(--text-soft)' }}
                      className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                    />
                    <input
                      type="text"
                      placeholder="Your Name (e.g. Kashish)"
                      value={fullName}
                      disabled={isLoading || isSuccess}
                      onChange={(e) => {
                        setFullName(e.target.value);
                        setFeedbackMessage('');
                      }}
                      style={{
                        backgroundColor: 'var(--card-subtle)',
                        borderColor: 'var(--card-border)',
                        color: 'var(--text)',
                      }}
                      className="w-full min-h-[46px] pl-10 pr-4 py-2.5 rounded-xl border text-sm font-semibold focus:outline-hidden focus:ring-2 focus:ring-[var(--accent)] transition-all disabled:opacity-60"
                    />
                  </div>
                )}

                {/* Email Field */}
                <div className="relative">
                  <Mail
                    style={{ color: 'var(--text-soft)' }}
                    className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  />
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="Email Address"
                    value={email}
                    disabled={isLoading || isSuccess}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setFeedbackMessage('');
                      setSuccessNotice('');
                    }}
                    style={{
                      backgroundColor: 'var(--card-subtle)',
                      borderColor: 'var(--card-border)',
                      color: 'var(--text)',
                    }}
                    className="w-full min-h-[46px] pl-10 pr-4 py-2.5 rounded-xl border text-sm font-semibold focus:outline-hidden focus:ring-2 focus:ring-[var(--accent)] transition-all disabled:opacity-60"
                  />
                </div>

                {/* Password Field */}
                <div className="relative">
                  <Lock
                    style={{ color: 'var(--text-soft)' }}
                    className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
                    placeholder={authMode === 'signup' ? 'Create Password (min 6 chars)' : 'Enter Password'}
                    value={password}
                    disabled={isLoading || isSuccess}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setFeedbackMessage('');
                    }}
                    style={{
                      backgroundColor: 'var(--card-subtle)',
                      borderColor: 'var(--card-border)',
                      color: 'var(--text)',
                    }}
                    className="w-full min-h-[46px] pl-10 pr-11 py-2.5 rounded-xl border text-sm font-semibold focus:outline-hidden focus:ring-2 focus:ring-[var(--accent)] transition-all disabled:opacity-60"
                  />

                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    title={showPassword ? 'Hide password' : 'Show password'}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    style={{ color: 'var(--text-soft)' }}
                    className="absolute right-1 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] flex items-center justify-center hover:text-[var(--accent)] cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {/* Forgot Password Link on Sign In */}
                {authMode === 'signin' && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleForgotPassword}
                      disabled={isLoading}
                      className="text-xs font-semibold text-[var(--accent)] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <KeyRound className="w-3 h-3" />
                      <span>Forgot Password?</span>
                    </button>
                  </div>
                )}

                {/* Error or Success Feedback */}
                {feedbackMessage && (
                  <p
                    style={{ color: '#e11d48' }}
                    className="text-xs font-bold text-center px-2 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 animate-fade-in"
                  >
                    {feedbackMessage}
                  </p>
                )}

                {successNotice && (
                  <p className="text-xs font-bold text-emerald-500 text-center px-2 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 animate-fade-in">
                    {successNotice}
                  </p>
                )}

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={isLoading || isSuccess}
                  className="theme-btn-accent w-full min-h-[48px] px-6 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98] disabled:opacity-50 select-none"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{authMode === 'signup' ? 'Creating Account...' : 'Signing In...'}</span>
                    </>
                  ) : authMode === 'signup' ? (
                    <>
                      <UserPlus className="w-4 h-4" />
                      <span>Create Account & Enter</span>
                    </>
                  ) : (
                    <>
                      <LogIn className="w-4 h-4" />
                      <span>Sign In & Open Diary</span>
                    </>
                  )}
                </button>
              </form>

              {/* Divider */}
              <div className="relative flex py-1 items-center">
                <div className="flex-grow border-t border-[var(--card-border)]" />
                <span
                  style={{ color: 'var(--text-soft)' }}
                  className="flex-shrink mx-3 text-[11px] font-semibold uppercase tracking-wider"
                >
                  or continue with
                </span>
                <div className="flex-grow border-t border-[var(--card-border)]" />
              </div>

              {/* Google Sign-In Button */}
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isLoading || isSuccess}
                style={{
                  backgroundColor: 'var(--card-subtle)',
                  borderColor: 'var(--card-border)',
                  color: 'var(--text)',
                }}
                className="w-full min-h-[46px] px-4 py-2.5 rounded-xl border text-xs sm:text-sm font-bold flex items-center justify-center gap-2.5 cursor-pointer hover:opacity-95 active:scale-[0.98] transition-all disabled:opacity-50"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                <span>Continue with Google</span>
              </button>
            </>
          )}
        </div>
      </main>

      {/* Small Footer Line */}
      <footer className="relative z-10 w-full text-center pb-2 space-y-1">
        <p
          style={{ color: 'var(--text-soft)' }}
          className="font-serif text-xl sm:text-2xl font-bold"
        >
          Made with love, just for you.
        </p>
        {onShowAdmin && (
          <button
            type="button"
            onClick={onShowAdmin}
            className="text-[11px] font-semibold text-[var(--text-soft)] opacity-60 hover:opacity-100 hover:text-[var(--accent)] transition-opacity cursor-pointer"
          >
            Admin Control Center
          </button>
        )}
      </footer>
    </div>
  );
};
