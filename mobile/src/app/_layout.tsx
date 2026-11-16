import { useEffect } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider, useSession } from "@/lib/session";
import { C, Loading } from "@/lib/ui";

/** Sends signed-out users to the sign-in screen and signed-in users away from it. */
function Gate() {
  const { ready, me } = useSession();
  const segments = useSegments();
  const router = useRouter();
  useEffect(() => {
    if (!ready) return;
    const onLogin = segments[0] === "login";
    if (!me && !onLogin) router.replace("/login");
    else if (me && onLogin) router.replace("/");
  }, [ready, me, segments, router]);

  // Tapping an alert opens the family it is about.
  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const link = String(r.notification.request.content.data?.link ?? "");
      const m = link.match(/\/households\/([0-9a-f-]{36})(?:\?e=([0-9a-f-]{36}))?/);
      if (m) router.push({ pathname: "/family/[id]", params: { id: m[1], e: m[2] ?? "" } });
    });
    return () => sub.remove();
  }, [router]);

  if (!ready) return <Loading />;
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: C.brandDark }, headerTintColor: C.white, contentStyle: { backgroundColor: C.bg } }}>
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="family/[id]" options={{ title: "Family" }} />
      <Stack.Screen name="add" options={{ title: "Quick add enquiry", presentation: "modal" }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="light" />
        <Gate />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
