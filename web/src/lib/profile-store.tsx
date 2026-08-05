import * as React from "react";
import { api, type ProfilePayload } from "./api";

const ONBOARDING_CACHE_KEY = "onboarding_complete";

type ProfileStore = {
  data: ProfilePayload | null;
  loading: boolean;
  error: string | null;
  /** Cached answer, available before the first request resolves. */
  onboardingComplete: boolean | null;
  refresh: () => Promise<ProfilePayload | null>;
  setData: (data: ProfilePayload) => void;
};

const ProfileContext = React.createContext<ProfileStore | null>(null);

function readCachedFlag(): boolean | null {
  try {
    const raw = localStorage.getItem(ONBOARDING_CACHE_KEY);
    return raw === null ? null : raw === "true";
  } catch {
    return null;
  }
}

function writeCachedFlag(value: boolean) {
  try {
    localStorage.setItem(ONBOARDING_CACHE_KEY, String(value));
  } catch {
    /* private mode: the flag simply is not cached */
  }
}

/**
 * Loads the profile once and keeps it in memory for the whole session, so screens
 * read it without hitting the database again. The onboarding flag is additionally
 * mirrored to localStorage so a reload does not flash the onboarding screen at a
 * user who already finished it.
 */
export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [data, setDataState] = React.useState<ProfilePayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [onboardingComplete, setOnboardingComplete] = React.useState<boolean | null>(readCachedFlag);

  const setData = React.useCallback((next: ProfilePayload) => {
    setDataState(next);
    setOnboardingComplete(next.onboarding_complete);
    writeCachedFlag(next.onboarding_complete);
  }, []);

  const refresh = React.useCallback(async () => {
    try {
      const payload = await api.getProfile();
      setData(payload);
      setError(null);
      return payload;
    } catch (caught) {
      setError((caught as Error).message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [setData]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = React.useMemo(
    () => ({ data, loading, error, onboardingComplete, refresh, setData }),
    [data, loading, error, onboardingComplete, refresh, setData]
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const context = React.useContext(ProfileContext);
  if (!context) throw new Error("useProfile must be used inside ProfileProvider");
  return context;
}
