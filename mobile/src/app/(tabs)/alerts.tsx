import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { api } from "@/lib/api";
import { rel } from "@/lib/fmt";
import { Button, C, Empty, ErrorText, Loading, s } from "@/lib/ui";

type Note = { id: string; category: string; title: string; link: string | null; read: boolean; created_at: string };

export default function Alerts() {
  const router = useRouter();
  const [rows, setRows] = useState<Note[] | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    try { setRows((await api<{ notifications: Note[] }>("notifications")).notifications); setError(""); } catch (e: any) { setError(e.message); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const open = (n: Note) => {
    const m = (n.link ?? "").match(/\/households\/([0-9a-f-]{36})(?:\?e=([0-9a-f-]{36}))?/);
    if (m) router.push({ pathname: "/family/[id]", params: { id: m[1], e: m[2] ?? "" } });
  };

  if (!rows && !error) return <Loading />;
  const unread = rows?.filter((r) => !r.read).length ?? 0;
  return (
    <View style={s.screen}>
      <ErrorText>{error}</ErrorText>
      <FlatList
        data={rows ?? []}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ padding: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ListHeaderComponent={unread ? <View style={{ marginBottom: 10 }}><Button small title={`Mark ${unread} as read`} onPress={async () => { await api("notifications-read", { body: {} }); load(); }} /></View> : undefined}
        ListEmptyComponent={<Empty title="You are all caught up">Assignments, due tasks, parent replies and escalations appear here.</Empty>}
        renderItem={({ item: n }) => (
          <Pressable onPress={() => open(n)} style={[s.card, { padding: 12, marginBottom: 8 }, !n.read && { borderColor: C.brand, backgroundColor: C.brandLight }]}>
            <Text style={s.text}>{n.title}</Text>
            <Text style={s.muted}>{n.category.replace("_", " ")} · {rel(n.created_at)}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}
