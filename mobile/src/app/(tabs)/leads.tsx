import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { api } from "@/lib/api";
import { isPast, rel } from "@/lib/fmt";
import { useSession } from "@/lib/session";
import { Badge, Button, C, Chip, Empty, ErrorText, Loading, s, Temp } from "@/lib/ui";

type Lead = { id: string; householdId: string; student: string; guardian: string; mobile: string; grade: string; stage: string; color: string; temperature: string | null; score: number; owner: string; next: string | null; nextTitle: string | null; reenquired: boolean };

export default function Leads() {
  const { me, options } = useSession();
  const router = useRouter();
  const [term, setTerm] = useState("");
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState(me?.can.ownOnly ? "" : "my");
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  // Searching waits until typing pauses.
  useEffect(() => { const t = setTimeout(() => setQuery(term.trim()), 350); return () => clearTimeout(t); }, [term]);

  const load = useCallback(async (p = 1) => {
    try {
      const qs = new URLSearchParams({ page: String(p), ...(query ? { q: query } : {}), ...(chip ? { chip } : {}) });
      const r = await api<{ leads: Lead[] }>(`leads?${qs}`);
      setLeads((prev) => (p === 1 ? r.leads : [...(prev ?? []), ...r.leads]));
      setMore(r.leads.length === 30);
      setPage(p);
      setError("");
    } catch (e: any) { setError(e.message); }
  }, [query, chip]);

  useEffect(() => { load(1); }, [load]);
  useFocusEffect(useCallback(() => { load(1); }, [load]));

  return (
    <View style={s.screen}>
      <View style={{ padding: 12, paddingBottom: 6, gap: 8 }}>
        <TextInput value={term} onChangeText={setTerm} placeholder="Search name, mobile or email" placeholderTextColor="#94a3b8" style={s.input} autoCapitalize="none" accessibilityLabel="Search leads" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {(options?.chips ?? []).map(([k, label]) => <Chip key={k} label={label} on={chip === k} onPress={() => setChip(chip === k ? "" : k)} />)}
        </ScrollView>
      </View>
      <ErrorText>{error}</ErrorText>
      {!leads ? <Loading /> : (
        <FlatList
          data={leads}
          keyExtractor={(l) => l.id}
          contentContainerStyle={{ padding: 12, paddingTop: 4 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(1); setRefreshing(false); }} />}
          onEndReached={() => { if (more) load(page + 1); }}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={<Empty title={query || chip ? "No leads match" : "No leads yet"}>{query || chip ? "Try another search or remove the filter." : "New enquiries appear here."}</Empty>}
          ListFooterComponent={me?.can.createLeads ? <View style={{ marginTop: 8 }}><Button title="+ Quick add enquiry" onPress={() => router.push("/add")} /></View> : undefined}
          renderItem={({ item: l }) => (
            <Pressable onPress={() => router.push({ pathname: "/family/[id]", params: { id: l.householdId, e: l.id } })} style={[s.card, { padding: 12, marginBottom: 8 }]}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                <Text style={{ fontWeight: "700", color: C.text, flex: 1 }}>{l.student}</Text>
                <Badge tone={l.color}>{l.stage}</Badge>
              </View>
              <Text style={s.muted}>{l.grade} · {l.guardian} · {l.mobile}</Text>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}><Temp t={l.temperature} />{l.reenquired && <Badge tone="amber">Re-enquired</Badge>}</View>
                <Text style={[s.muted, l.next && isPast(l.next) && { color: C.red, fontWeight: "600" }]}>{l.next ? `${isPast(l.next) ? "Overdue" : "Next"} ${rel(l.next)}` : "No next action"}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
