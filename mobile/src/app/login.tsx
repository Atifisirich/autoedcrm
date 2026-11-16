import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { defaultServer, getServer } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button, C, ErrorText, Field, s } from "@/lib/ui";

export default function Login() {
  const { signIn } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [server, setServer] = useState(getServer());
  const [showServer, setShowServer] = useState(getServer() !== defaultServer);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError("");
    setBusy(true);
    try { await signIn(server, email, password, code); }
    catch (e: any) {
      if (e.data?.need2fa) setNeedCode(true);
      setError(needCode || !e.data?.need2fa ? e.message : "");
    }
    finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: C.brandDark }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 20 }} keyboardShouldPersistTaps="handled">
        <View style={[s.card, { padding: 20 }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 18 }}>
            <View style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: C.brand, alignItems: "center", justifyContent: "center" }}><Text style={{ color: C.white, fontWeight: "800", fontSize: 18 }}>A</Text></View>
            <Text style={{ fontSize: 20, fontWeight: "700", color: C.brand }}>AutoED CRM</Text>
          </View>
          <Text style={[s.h1, { marginBottom: 4 }]}>Sign in</Text>
          <Text style={[s.muted, { marginBottom: 16 }]}>Use the same email and password as the web app.</Text>
          <Field label="Work email" value={email} onChangeText={(v) => setEmail(v.trim())} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" testID="email" />
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false} autoComplete="password" onSubmitEditing={submit} testID="password" />
          <Pressable onPress={() => setShowPassword(!showPassword)} style={{ marginTop: -6, marginBottom: 12 }} accessibilityRole="button"><Text style={[s.muted, { color: C.brand }]}>{showPassword ? "Hide password" : "Show password"}</Text></Pressable>
          {needCode && <Field label="6-digit code from your authenticator app" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" autoFocus testID="code" />}
          {showServer && <Field label="School server address" value={server} onChangeText={setServer} autoCapitalize="none" keyboardType="url" />}
          <ErrorText>{error}</ErrorText>
          <Button title={busy ? "Signing in…" : needCode ? "Verify" : "Sign in"} kind="primary" onPress={submit} disabled={busy || !email || !password || (needCode && code.length < 6)} testID="signin" />
          {!showServer && <Pressable onPress={() => setShowServer(true)} style={{ marginTop: 14 }}><Text style={[s.muted, { textAlign: "center" }]}>Using a different server?</Text></Pressable>}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
