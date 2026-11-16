// Talks to the AutoED server's mobile API (/api/m/*) with the signed-in user's bearer token.
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const DEFAULT_SERVER: string = (Constants.expoConfig?.extra as any)?.defaultServer ?? "https://autoed-crm.vercel.app";

// SecureStore is native only; the web build (used for testing) falls back to localStorage.
const store = {
  get: async (k: string) => (Platform.OS === "web" ? globalThis.localStorage?.getItem(k) ?? null : SecureStore.getItemAsync(k)),
  set: async (k: string, v: string) => (Platform.OS === "web" ? globalThis.localStorage?.setItem(k, v) : SecureStore.setItemAsync(k, v)),
  del: async (k: string) => (Platform.OS === "web" ? globalThis.localStorage?.removeItem(k) : SecureStore.deleteItemAsync(k)),
};

let server = DEFAULT_SERVER;
let token: string | null = null;
let onUnauthorized: () => void = () => {};

export async function loadStored() {
  server = (await store.get("server")) || DEFAULT_SERVER;
  token = await store.get("token");
  return { server, token };
}
export const getServer = () => server;
export const defaultServer = DEFAULT_SERVER;
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

export async function setServer(url: string) {
  server = url.trim().replace(/\/+$/, "") || DEFAULT_SERVER;
  await store.set("server", server);
}
export async function setToken(t: string | null) {
  token = t;
  if (t) await store.set("token", t);
  else await store.del("token");
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public data: any = null) { super(message); }
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${server}/api/m/${path}`, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError("No connection. Check your internet and try again.", 0);
  }
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== "login") { onUnauthorized(); throw new ApiError(data.error ?? "Please sign in again.", 401); }
  if (!r.ok) throw new ApiError(data.error ?? data.message ?? `Something went wrong (${r.status}).`, r.status, data);
  return data as T;
}

/** Runs one action (call log, note, task, message, stage, visit, quick add) and returns the server's result. */
export const act = (kind: string, fields: Record<string, unknown>) => api<{ ok: boolean; error?: string; message?: string; missing?: string[]; [k: string]: any }>("action", { body: { kind, ...fields } });
