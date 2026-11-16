// Signed-in state shared by every screen: who the user is, what they may do, and the school's picklists.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { api, loadStored, setServer, setToken, setUnauthorizedHandler } from "./api";

export type Me = {
  user: { id: string; name: string; email: string }; role: string; school: string; brand: string; year: string; branches: { id: string; name: string }[];
  can: { createLeads: boolean; editLeads: boolean; message: boolean; tasks: boolean; visits: boolean; reassign: boolean; sensitive: boolean; ownOnly: boolean }; readOnly: boolean;
};
export type Stage = { id: string; name: string; phase: string; color: string; closed: boolean; won: boolean; exempt: boolean; required: string[] };
export type Options = {
  grades: string[]; boards: string[]; reasons: string[]; branches: { id: string; name: string }[]; stages: Stage[];
  sources: { id: string; name: string; channel: string }[]; templates: { id: string; name: string; channel: string; body: string }[]; taskTypes: Record<string, string>; chips: [string, string][];
};

type Ctx = { ready: boolean; me: Me | null; options: Options | null; signIn: (server: string, email: string, password: string) => Promise<void>; signOut: () => Promise<void>; refresh: () => Promise<void> };
const SessionCtx = createContext<Ctx>(null as any);
export const useSession = () => useContext(SessionCtx);

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
});

let pushToken: string | null = null;

/** Registers this phone for alerts. Skipped on the web build and on emulators without Play services. */
async function registerPush() {
  if (Platform.OS === "web" || !Device.isDevice) return;
  try {
    if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("default", { name: "Alerts", importance: Notifications.AndroidImportance.HIGH });
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== "granted") return;
    const projectId = (Constants.expoConfig?.extra as any)?.eas?.projectId;
    const t = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    pushToken = t.data;
    await api("push", { body: { token: t.data, platform: Platform.OS } });
  } catch {
    // Push needs an Expo project id and Google services; the app works fine without it.
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [options, setOptions] = useState<Options | null>(null);

  const refresh = useCallback(async () => {
    const [m, o] = await Promise.all([api<Me>("me"), api<Options>("options")]);
    setMe(m);
    setOptions(o);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => { setToken(null); setMe(null); });
    (async () => {
      const { token } = await loadStored();
      if (token) {
        try { await refresh(); registerPush(); } catch { /* falls back to the sign-in screen */ }
      }
      setReady(true);
    })();
  }, [refresh]);

  const signIn = async (server: string, email: string, password: string) => {
    await setServer(server);
    const r = await api<{ token: string }>("login", { body: { email, password, device: `${Device.manufacturer ?? ""} ${Device.modelName ?? Platform.OS}`.trim() } });
    await setToken(r.token);
    await refresh();
    registerPush();
  };

  const signOut = async () => {
    try { await api("logout", { body: { pushToken } }); } catch { /* sign out locally anyway */ }
    await setToken(null);
    setMe(null);
  };

  return <SessionCtx.Provider value={{ ready, me, options, signIn, signOut, refresh }}>{children}</SessionCtx.Provider>;
}
