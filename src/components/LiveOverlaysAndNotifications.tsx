import React, { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, orderBy, limit, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { makeNativePhoneCall, showNativeToast, triggerHaptic, resolveFirestoreMediaUrl } from '../androidBridge';
import type { NavTab } from './Navbar';

interface LiveOverlaysAndNotificationsProps {
  onNavigate: (tab: NavTab) => void;
  defaultCallNumber: string;
}

export const LiveOverlaysAndNotifications: React.FC<LiveOverlaysAndNotificationsProps> = ({
  onNavigate,
  defaultCallNumber,
}) => {
  const [activeNotif, setActiveNotif] = useState<any | null>(null);
  const [activeOverlay, setActiveOverlay] = useState<any | null>(null);

  useEffect(() => {
    const seenNotifIds = new Set<string>(
      JSON.parse(localStorage.getItem('kashish_seen_notifs') || '[]')
    );

    const qNotifs = query(collection(db, 'notifications'), orderBy('createdAt', 'desc'), limit(5));
    const unsubNotifs = onSnapshot(
      qNotifs,
      (snap) => {
        const now = Date.now();
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          if (seenNotifIds.has(docSnap.id) || d.seen) return;
          if (d.scheduledFor && d.scheduledFor > now) return;

          // Only show notifications created within the last 24 hours
          if (d.createdAt && now - d.createdAt < 86400000) {
            seenNotifIds.add(docSnap.id);
            try {
              localStorage.setItem('kashish_seen_notifs', JSON.stringify(Array.from(seenNotifIds)));
            } catch {}

            setActiveNotif({ id: docSnap.id, ...d });
            triggerHaptic(60);

            if (d.soundUrl) {
              resolveFirestoreMediaUrl(d.soundUrl).then((playUrl) => {
                if (!playUrl) return;
                const audio = new Audio(playUrl);
                audio.volume = 0.85;
                audio.play().catch(() => {});
              });
            }

            if (typeof window !== 'undefined' && window.AndroidApp?.showNotification) {
              window.AndroidApp.showNotification(d.title || 'New Message', d.message || '');
            }

            updateDoc(doc(db, 'notifications', docSnap.id), {
              seen: true,
              seenAt: Date.now(),
            }).catch(() => {});
          }
        });
      },
      () => {}
    );

    const seenOverlayIds = new Set<string>(
      JSON.parse(localStorage.getItem('kashish_seen_overlays') || '[]')
    );

    const qOverlays = query(collection(db, 'overlays'), orderBy('createdAt', 'desc'), limit(5));
    const unsubOverlays = onSnapshot(
      qOverlays,
      (snap) => {
        const now = Date.now();
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          if (seenOverlayIds.has(docSnap.id) || d.dismissed) return;
          if (d.scheduledFor && d.scheduledFor > now) return;

          if (d.createdAt && now - d.createdAt < 86400000) {
            seenOverlayIds.add(docSnap.id);
            try {
              localStorage.setItem('kashish_seen_overlays', JSON.stringify(Array.from(seenOverlayIds)));
            } catch {}

            setActiveOverlay({ id: docSnap.id, ...d });
            triggerHaptic(80);
          }
        });
      },
      () => {}
    );

    return () => {
      unsubNotifs();
      unsubOverlays();
    };
  }, []);

  const handleOverlayButton = (btn: { label: string; action: string; payload?: string }) => {
    if (!activeOverlay) return;
    const overlayId = activeOverlay.id;
    setActiveOverlay(null);

    updateDoc(doc(db, 'overlays', overlayId), {
      dismissed: true,
      clickedAction: btn.action,
      seenAt: Date.now(),
    }).catch(() => {});

    if (btn.action === 'call_now') {
      void makeNativePhoneCall(btn.payload || defaultCallNumber);
    } else if (btn.action === 'open_section') {
      const target = (btn.payload || 'home') as NavTab;
      onNavigate(target);
      showNativeToast(`Opened ${target}`);
    } else if (btn.action === 'open_url' && btn.payload) {
      window.location.href = btn.payload;
    }
  };

  return (
    <>
      {/* Real-time Notification Banner */}
      {activeNotif && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[1500] w-[92%] max-w-sm bg-neutral-950 text-white border border-neutral-800 p-3.5 rounded-xl shadow-2xl flex items-start gap-3">
          {activeNotif.imageUrl && (
            <img
              src={activeNotif.imageUrl}
              alt=""
              className="w-11 h-11 rounded-lg object-cover shrink-0 border border-neutral-800"
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold truncate">{activeNotif.title || 'Notification'}</div>
            <div className="text-[11px] text-neutral-300 mt-0.5 leading-snug break-words">
              {activeNotif.message}
            </div>
          </div>
          <button
            onClick={() => setActiveNotif(null)}
            className="text-[11px] text-neutral-400 hover:text-white px-2 py-1 border border-neutral-800 rounded cursor-pointer"
          >
            Close
          </button>
        </div>
      )}

      {/* Truecaller-Style Live Overlay Popup */}
      {activeOverlay && (
        <div className="fixed inset-0 z-[1600] bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 border border-neutral-300 dark:border-neutral-800 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-neutral-100 dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                Incoming Alert · Kashish World
              </span>
              <button
                onClick={() => {
                  updateDoc(doc(db, 'overlays', activeOverlay.id), { dismissed: true }).catch(() => {});
                  setActiveOverlay(null);
                }}
                className="text-xs font-bold text-neutral-500 hover:text-neutral-900 dark:hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-4 space-y-3 text-center">
              {activeOverlay.imageUrl && (
                <img
                  src={activeOverlay.imageUrl}
                  alt=""
                  className="w-20 h-20 rounded-full object-cover mx-auto border border-neutral-300 dark:border-neutral-700"
                />
              )}
              <h3 className="text-base font-bold">{activeOverlay.title || 'Special Message'}</h3>
              <p className="text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed whitespace-pre-wrap">
                {activeOverlay.message}
              </p>

              <div className="pt-2 flex flex-col gap-1.5">
                {Array.isArray(activeOverlay.buttons) && activeOverlay.buttons.length > 0 ? (
                  activeOverlay.buttons.slice(0, 3).map((btn: any, idx: number) => (
                    <button
                      key={idx}
                      onClick={() => handleOverlayButton(btn)}
                      className={`w-full py-2 px-3 rounded text-xs font-semibold border cursor-pointer ${
                        idx === 0
                          ? 'bg-neutral-900 text-white border-neutral-900 dark:bg-white dark:text-neutral-900 dark:border-white'
                          : 'bg-transparent text-neutral-800 dark:text-neutral-200 border-neutral-300 dark:border-neutral-700'
                      }`}
                    >
                      {btn.label || 'Continue'}
                    </button>
                  ))
                ) : (
                  <button
                    onClick={() => setActiveOverlay(null)}
                    className="w-full py-2 px-3 rounded text-xs font-semibold bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 cursor-pointer"
                  >
                    Dismiss
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
