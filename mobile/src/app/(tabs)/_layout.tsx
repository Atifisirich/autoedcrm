import { Tabs } from "expo-router";
import { Text } from "react-native";
import { C } from "@/lib/ui";

import type { ColorValue } from "react-native";
const icon = (glyph: string) => ({ color }: { color: ColorValue }) => <Text style={{ color, fontSize: 18 }}>{glyph}</Text>;

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerStyle: { backgroundColor: C.brandDark }, headerTintColor: C.white, tabBarActiveTintColor: C.brand, tabBarLabelStyle: { fontSize: 12, fontWeight: "600" } }}>
      <Tabs.Screen name="index" options={{ title: "My day", tabBarIcon: icon("☀") }} />
      <Tabs.Screen name="leads" options={{ title: "Leads", tabBarIcon: icon("☰") }} />
      <Tabs.Screen name="alerts" options={{ title: "Alerts", tabBarIcon: icon("🔔") }} />
      <Tabs.Screen name="more" options={{ title: "Me", tabBarIcon: icon("●") }} />
    </Tabs>
  );
}
