import Constants from "expo-constants";
import { ScrollView, Text, View } from "react-native";
import { getServer } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button, Section, s } from "@/lib/ui";

export default function Me() {
  const { me, signOut } = useSession();
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Section title="Signed in as">
        <View style={{ padding: 14, gap: 4 }}>
          <Text style={{ fontWeight: "700", fontSize: 17 }}>{me?.user.name}</Text>
          <Text style={s.muted}>{me?.user.email}</Text>
          <Text style={s.text}>{me?.role} · {me?.school}</Text>
          <Text style={s.muted}>Branches: {me?.branches.map((b) => b.name).join(", ") || "All"}</Text>
          <Text style={s.muted}>Academic year: {me?.year}</Text>
        </View>
      </Section>
      <Section title="About">
        <View style={{ padding: 14, gap: 4 }}>
          <Text style={s.muted}>Server: {getServer()}</Text>
          <Text style={s.muted}>App version {Constants.expoConfig?.version}</Text>
          <Text style={s.muted}>Settings, reports and campaigns are in the web app.</Text>
        </View>
      </Section>
      <Button title="Sign out" kind="danger" onPress={signOut} />
    </ScrollView>
  );
}
