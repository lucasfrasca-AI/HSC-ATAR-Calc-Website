// Share links that never touch a server. The projection is compressed into the
// URL *fragment* (#share=…), which browsers do not send in requests or Referer
// headers — Firebase never sees it. Decoding treats the link as hostile input:
// length caps before and after decompression, then the same sanitise() used for
// imports. The student's name is left out unless they opt in.
import { sanitise, type Data } from "./engine.ts";

export const SHARE_PREFIX = "#share=";
const MAX_LINK = 12_000; // characters of payload
const MAX_JSON = 64_000; // bytes after decompression

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/** Drops UI-only and empty fields so links stay short. */
function minimal(data: Data, includeName: boolean) {
  const strip = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== "" && !(Array.isArray(v) && !v.length)));
  return {
    ...(includeName && data.name ? { name: data.name } : {}),
    settings: data.settings,
    subjects: data.subjects.map(({ uid: _uid, ...s }) => strip({ ...s, name: s.courseId === "custom" ? s.name : "" })),
  };
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, limit: number): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new Error("too-large"); }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

export async function encodeShare(data: Data, includeName = false): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(minimal(data, includeName)));
  if (typeof CompressionStream === "undefined") return `v0.${b64url(json)}`;
  return `v1.${b64url(await pipe(json, new CompressionStream("deflate-raw"), MAX_JSON))}`;
}

export async function decodeShare(payload: string): Promise<Data> {
  if (payload.length > MAX_LINK) throw new Error("too-large");
  const [ver, body] = [payload.slice(0, 3), payload.slice(3)];
  if (!/^[A-Za-z0-9_-]*$/.test(body)) throw new Error("bad-link");
  let bytes: Uint8Array;
  try { bytes = unb64url(body); } catch { throw new Error("bad-link"); }
  let json: Uint8Array;
  if (ver === "v1.") {
    try { json = await pipe(bytes, new DecompressionStream("deflate-raw"), MAX_JSON); }
    catch (e) { throw e instanceof Error && e.message === "too-large" ? e : new Error("bad-link"); }
  } else if (ver === "v0.") json = bytes;
  else throw new Error("bad-link");
  if (json.length > MAX_JSON) throw new Error("too-large");
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(json)); } catch { throw new Error("bad-link"); }
  return sanitise(parsed);
}

export const shareUrl = (payload: string) => `${location.origin}${location.pathname}${SHARE_PREFIX}${payload}`;
export const readShareFromLocation = () => (location.hash.startsWith(SHARE_PREFIX) ? location.hash.slice(SHARE_PREFIX.length) : null);
