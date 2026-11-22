"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { translate, type Key, type Lang } from "@/lib/i18n";
import type { Profile } from "@/lib/types";

interface Ctx {
  user: User | null;
  profile: Profile | null;
  isAdmin: boolean;
  ready: boolean;
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: Key, vars?: Record<string, string | number>) => string;
}

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [ready, setReady] = useState(false);
  const [lang, setLangState] = useState<Lang>("tl");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("lang");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage exists only after hydration
      if (saved === "en" || saved === "tl") setLangState(saved);
    } catch {}
  }, []);

  useEffect(() => {
    let unsubProfile = () => {};
    const unsub = onAuthStateChanged(auth, async (u) => {
      unsubProfile();
      setUser(u);
      setProfile(null);
      if (!u) {
        setIsAdmin(false);
        setReady(true);
        return;
      }
      // Not ready again until this account's profile has loaded. Right after sign-in `ready` is
      // still true from the signed-out state, and "no profile yet" would read as a new account.
      setReady(false);
      const token = await u.getIdTokenResult();
      setIsAdmin(token.claims.admin === true);
      unsubProfile = onSnapshot(doc(db, "profiles", u.uid), (snap) => {
        setProfile(snap.exists() ? ({ uid: snap.id, ...snap.data() } as Profile) : null);
        setReady(true);
      });
    });
    return () => {
      unsub();
      unsubProfile();
    };
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem("lang", l);
    } catch {}
    document.documentElement.lang = l === "tl" ? "fil" : "en";
  }, []);

  const t = useCallback((key: Key, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);

  return <AppCtx.Provider value={{ user, profile, isAdmin, ready, lang, setLang, t }}>{children}</AppCtx.Provider>;
}

export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside AppProvider");
  return c;
}
