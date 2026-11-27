/* eslint-disable @typescript-eslint/no-explicit-any -- Firestore wire JSON and document fields are untyped by design. */
// Firestore over its REST API, with only the calls this app makes. firebase-admin/firestore loads google-gax, whose
// protobuf codegen calls Function(), and Cloudflare Workers forbids that at module load. fetch works everywhere.
// Auth: a service-account JWT signed with WebCrypto (or the emulator's "owner" token when FIRESTORE_EMULATOR_HOST is set).

export class Timestamp {
  seconds: number;
  nanoseconds: number;
  constructor(seconds: number, nanoseconds: number) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }
  static now() {
    return Timestamp.fromMillis(Date.now());
  }
  static fromDate(d: Date) {
    return Timestamp.fromMillis(d.getTime());
  }
  static fromMillis(ms: number) {
    const s = Math.floor(ms / 1000);
    return new Timestamp(s, Math.round((ms - s * 1000) * 1e6));
  }
  toMillis() {
    return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6);
  }
  toDate() {
    return new Date(this.toMillis());
  }
  toJSON() {
    return { seconds: this.seconds, nanoseconds: this.nanoseconds };
  }
}

type Transform = { fieldPath: string; setToServerValue: "REQUEST_TIME" } | { fieldPath: string; increment: unknown };

class Sentinel {
  kind: "ts" | "inc";
  n: number;
  constructor(kind: "ts" | "inc", n: number) {
    this.kind = kind;
    this.n = n;
  }
}

export const FieldValue = {
  serverTimestamp: () => new Sentinel("ts", 0),
  increment: (n: number) => new Sentinel("inc", n),
};

export type AggregateSpec = { kind: "sum"; field: string };
export const AggregateField = {
  sum: (field: string): AggregateSpec => ({ kind: "sum", field }),
};

export type DocumentData = Record<string, any>;

export interface Snapshot {
  id: string;
  ref: DocumentReference;
  exists: boolean;
  data(): Record<string, any> | undefined;
  get(field: string): any;
}
export interface QueryDocSnapshot extends Snapshot {
  exists: true;
  data(): Record<string, any>;
}
export interface QuerySnapshot {
  docs: QueryDocSnapshot[];
  empty: boolean;
  size: number;
  forEach(fn: (d: QueryDocSnapshot) => void): void;
}
export interface DocumentReference {
  kind: "doc";
  id: string;
  path: string;
  collection(name: string): Query;
  get(): Promise<Snapshot>;
  set(data: object, opts?: { merge?: boolean }): Promise<void>;
  update(data: object): Promise<void>;
  create(data: object): Promise<void>;
  delete(): Promise<void>;
}
export interface Query {
  kind: "query";
  _path: string;
  _q: QState;
  where(field: string, op: string, value: unknown): Query;
  orderBy(field: string, dir?: "asc" | "desc"): Query;
  limit(n: number): Query;
  select(...fields: string[]): Query;
  get(): Promise<QuerySnapshot>;
  count(): { get(): Promise<{ data(): { count: number } }> };
  aggregate(spec: Record<string, AggregateSpec>): { get(): Promise<{ data(): Record<string, number> }> };
  doc(id?: string): DocumentReference;
  add(data: object): Promise<DocumentReference>;
}

export class FirestoreError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}
// gRPC codes, as firebase-admin reports them (evaluations/route.ts checks code 6 = ALREADY_EXISTS).
const CODES: Record<string, number> = { CANCELLED: 1, INVALID_ARGUMENT: 3, NOT_FOUND: 5, ALREADY_EXISTS: 6, PERMISSION_DENIED: 7, FAILED_PRECONDITION: 9, ABORTED: 10, UNAUTHENTICATED: 16 };

// ---- configuration and auth ----

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;
let cachedSa: { client_email: string; private_key: string; project_id: string } | undefined;
function serviceAccount() {
  if (!cachedSa) {
    const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64 ?? "";
    cachedSa = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
  }
  return cachedSa!;
}
const projectId = () => (EMULATOR ? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "demo" : serviceAccount().project_id);
const docsUrl = () => `${EMULATOR ? `http://${EMULATOR}` : "https://firestore.googleapis.com"}/v1/projects/${projectId()}/databases/(default)/documents`;
const rootName = () => `projects/${projectId()}/databases/(default)/documents`;

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
let token: { value: string; exp: number } | undefined;
async function accessToken(): Promise<string> {
  if (EMULATOR) return "owner";
  if (token && token.exp > Date.now() + 60_000) return token.value;
  const sa = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: object) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const input = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/datastore", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----|\s/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${input}.${b64url(new Uint8Array(sig))}` }),
  });
  const j = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!res.ok || !j.access_token) throw new FirestoreError(16, `token-exchange-${res.status}`);
  token = { value: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return token.value;
}

async function post(url: string, body: object): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${await accessToken()}` },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { status?: string; message?: string } };
  if (!res.ok) throw new FirestoreError(CODES[json.error?.status ?? ""] ?? 2, json.error?.message ?? `firestore-${res.status}`);
  return json;
}

// ---- values ----

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && Object.getPrototypeOf(v) === Object.prototype;

export function encode(v: unknown): any {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (v instanceof Timestamp) return { timestampValue: new Date(v.toMillis()).toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  if (typeof v === "object") return { mapValue: { fields: encodeFields(v as Record<string, unknown>) } };
  throw new Error(`firestore: unsupported value ${typeof v}`);
}
const encodeFields = (o: Record<string, unknown>) => split(o, [], { fields: {}, paths: [], transforms: [] });

export function decode(v: any): any {
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("stringValue" in v) return v.stringValue;
  if ("timestampValue" in v) return Timestamp.fromMillis(Date.parse(v.timestampValue));
  if ("arrayValue" in v) return (v.arrayValue.values ?? []).map(decode);
  if ("mapValue" in v) return decodeFields(v.mapValue.fields ?? {});
  throw new Error(`firestore: unsupported value ${Object.keys(v).join(",")}`);
}
const decodeFields = (f: Record<string, any>) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, decode(v)]));

// Field paths: plain names stay bare, anything else is backtick-quoted (what the REST API expects).
const seg = (s: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : `\`${s.replace(/\\/g, "\\\\").replace(/`/g, "\\`")}\``);
const fieldPath = (parts: string[]) => parts.map(seg).join(".");

type Parts = { fields: Record<string, any>; paths: string[]; transforms: Transform[] };
/** Encodes a map: sentinels become transforms, and every non-sentinel leaf path is recorded for merge masks. */
function split(obj: Record<string, unknown>, prefix: string[], parts: Parts): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    const p = [...prefix, k];
    if (v instanceof Sentinel) {
      parts.transforms.push(v.kind === "ts" ? { fieldPath: fieldPath(p), setToServerValue: "REQUEST_TIME" } : { fieldPath: fieldPath(p), increment: encode(v.n) });
    } else if (isPlain(v)) {
      const sub = split(v, p, parts);
      if (Object.keys(v).length === 0) {
        out[k] = { mapValue: { fields: {} } };
        parts.paths.push(fieldPath(p));
      } else if (Object.keys(sub).length) {
        out[k] = { mapValue: { fields: sub } };
      }
    } else {
      out[k] = encode(v);
      parts.paths.push(fieldPath(p));
    }
  }
  return out;
}

type WriteKind = "set" | "merge" | "update" | "create";
function writeOf(path: string, data: object, kind: WriteKind): any {
  const parts: Parts = { fields: {}, paths: [], transforms: [] };
  const fields = split(data as Record<string, unknown>, [], parts);
  const name = `${rootName()}/${path}`;
  const w: any = { update: { name, fields } };
  if (kind === "merge") w.updateMask = { fieldPaths: [...new Set(parts.paths)] };
  if (kind === "update") w.updateMask = { fieldPaths: Object.keys(fields).map((k) => fieldPath([k])) };
  if (kind === "update") w.currentDocument = { exists: true };
  if (kind === "create") w.currentDocument = { exists: false };
  if (parts.transforms.length) w.updateTransforms = parts.transforms;
  return w;
}

// ---- snapshots ----

function snapshot(path: string, doc?: { fields?: Record<string, any> }): Snapshot {
  const ref = docRef(path);
  const data = doc ? decodeFields(doc.fields ?? {}) : undefined;
  return {
    id: path.split("/").at(-1)!,
    ref,
    exists: !!doc,
    data: () => data,
    get: (field: string) => field.split(".").reduce<any>((o, k) => o?.[k], data),
  };
}
const pathOf = (name: string) => name.slice(name.indexOf("/documents/") + "/documents/".length);
const randomId = () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => chars[b % chars.length]).join("");
};

// ---- reads ----

async function getDocs(refs: DocumentReference[], transaction?: string): Promise<Snapshot[]> {
  if (!refs.length) return [];
  const res = (await post(`${docsUrl()}:batchGet`, { documents: refs.map((r) => `${rootName()}/${r.path}`), transaction })) as any[];
  const byPath = new Map<string, Snapshot>();
  for (const item of res) {
    if (item.found) byPath.set(pathOf(item.found.name), snapshot(pathOf(item.found.name), item.found));
    else if (item.missing) byPath.set(pathOf(item.missing), snapshot(pathOf(item.missing)));
  }
  return refs.map((r) => byPath.get(r.path) ?? snapshot(r.path));
}

type QState = { filters: { field: string; op: string; value: unknown }[]; orders: { field: string; dir: "asc" | "desc" }[]; limitN?: number; fields?: string[] };
const OPS: Record<string, string> = { "==": "EQUAL", "!=": "NOT_EQUAL", "<": "LESS_THAN", "<=": "LESS_THAN_OR_EQUAL", ">": "GREATER_THAN", ">=": "GREATER_THAN_OR_EQUAL", in: "IN", "array-contains": "ARRAY_CONTAINS" };

function structured(path: string, q: QState): any {
  const i = path.lastIndexOf("/");
  const sq: any = { from: [{ collectionId: path.slice(i + 1) }] };
  const filters = q.filters.map((f) => ({ fieldFilter: { field: { fieldPath: fieldPath([f.field]) }, op: OPS[f.op], value: encode(f.value) } }));
  if (filters.length) sq.where = filters.length === 1 ? filters[0] : { compositeFilter: { op: "AND", filters } };
  if (q.orders.length) sq.orderBy = q.orders.map((o) => ({ field: { fieldPath: fieldPath([o.field]) }, direction: o.dir === "desc" ? "DESCENDING" : "ASCENDING" }));
  if (q.fields?.length) sq.select = { fields: q.fields.map((f) => ({ fieldPath: fieldPath([f]) })) };
  if (q.limitN !== undefined) sq.limit = q.limitN;
  return sq;
}

// The parent document (or the database root) a collection query runs under.
function runUrl(path: string, op: string) {
  const i = path.lastIndexOf("/");
  return i < 0 ? `${docsUrl()}:${op}` : `${docsUrl()}/${path.slice(0, i)}:${op}`;
}

async function runQuery(path: string, q: QState, transaction?: string): Promise<QuerySnapshot> {
  const res = (await post(runUrl(path, "runQuery"), { structuredQuery: structured(path, q), transaction })) as any[];
  const docs = res.filter((r) => r.document).map((r) => snapshot(pathOf(r.document.name), r.document) as QueryDocSnapshot);
  return { docs, empty: docs.length === 0, size: docs.length, forEach: (fn) => docs.forEach(fn) };
}

function queryOf(path: string, q: QState): Query {
  const next = (patch: Partial<QState>) => queryOf(path, { ...q, ...patch });
  const aggregate = async (aggs: Record<string, any>) => {
    const res = (await post(runUrl(path, "runAggregationQuery"), { structuredAggregationQuery: { structuredQuery: structured(path, q), aggregations: Object.entries(aggs).map(([alias, a]) => ({ alias, ...a })) } })) as any[];
    const fields = res[0]?.result?.aggregateFields ?? {};
    return Object.fromEntries(Object.keys(aggs).map((k) => [k, fields[k] ? decode(fields[k]) : 0]));
  };
  return {
    kind: "query",
    _path: path,
    _q: q,
    where: (field, op, value) => next({ filters: [...q.filters, { field, op, value }] }),
    orderBy: (field, dir = "asc") => next({ orders: [...q.orders, { field, dir }] }),
    limit: (n) => next({ limitN: n }),
    select: (...fields) => next({ fields }),
    get: () => runQuery(path, q),
    count: () => ({
      get: async () => {
        const n = (await aggregate({ count: { count: {} } })).count;
        return { data: () => ({ count: n as number }) };
      },
    }),
    aggregate: (spec) => ({
      get: async () => {
        const aggs = Object.fromEntries(Object.entries(spec).map(([k, s]) => [k, { sum: { field: { fieldPath: fieldPath([s.field]) } } }]));
        const data = await aggregate(aggs);
        return { data: () => data };
      },
    }),
    doc: (id) => docRef(`${path}/${id ?? randomId()}`),
    add: async (data) => {
      const ref = docRef(`${path}/${randomId()}`);
      await commit([writeOf(ref.path, data, "create")]);
      return ref;
    },
  };
}

// ---- writes ----

async function commit(writes: any[], transaction?: string) {
  await post(`${docsUrl()}:commit`, { writes, transaction });
}

function docRef(path: string): DocumentReference {
  const ref: DocumentReference = {
    kind: "doc",
    id: path.split("/").at(-1)!,
    path,
    collection: (name) => queryOf(`${path}/${name}`, { filters: [], orders: [] }),
    get: async () => (await getDocs([ref]))[0],
    set: (data, opts) => commit([writeOf(path, data, opts?.merge ? "merge" : "set")]),
    update: (data) => commit([writeOf(path, data, "update")]),
    create: (data) => commit([writeOf(path, data, "create")]),
    delete: () => commit([{ delete: `${rootName()}/${path}` }]),
  };
  return ref;
}

function collectionQuery(path: string): Query {
  return queryOf(path, { filters: [], orders: [] });
}

/** A write list shared by batch() and transactions: set, update, create and delete buffer, commit sends. */
function writer() {
  const writes: any[] = [];
  const w = {
    set: (ref: DocumentReference, data: object, opts?: { merge?: boolean }) => void writes.push(writeOf(ref.path, data, opts?.merge ? "merge" : "set")),
    update: (ref: DocumentReference, data: object) => void writes.push(writeOf(ref.path, data, "update")),
    create: (ref: DocumentReference, data: object) => void writes.push(writeOf(ref.path, data, "create")),
    delete: (ref: DocumentReference) => void writes.push({ delete: `${rootName()}/${ref.path}` }),
  };
  return { writes, w };
}

export type Tx = {
  get(target: DocumentReference): Promise<Snapshot>;
  get(target: Query): Promise<QuerySnapshot>;
  getAll(...refs: DocumentReference[]): Promise<Snapshot[]>;
  set(ref: DocumentReference, data: object, opts?: { merge?: boolean }): Tx;
  update(ref: DocumentReference, data: object): Tx;
  create(ref: DocumentReference, data: object): Tx;
  delete(ref: DocumentReference): Tx;
};

async function runTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const { transaction } = (await post(`${docsUrl()}:beginTransaction`, { options: { readWrite: {} } })) as { transaction: string };
    const { writes, w } = writer();
    const tx: Tx = {
      get: ((target: DocumentReference | Query) =>
        target.kind === "query" ? runQuery(target._path, target._q, transaction) : getDocs([target], transaction).then((s) => s[0])) as Tx["get"],
      getAll: (...refs) => getDocs(refs, transaction),
      set: (ref, data, opts) => (w.set(ref, data, opts), tx),
      update: (ref, data) => (w.update(ref, data), tx),
      create: (ref, data) => (w.create(ref, data), tx),
      delete: (ref) => (w.delete(ref), tx),
    };
    try {
      const result = await fn(tx);
      if (writes.length) await commit(writes, transaction);
      return result;
    } catch (e) {
      // ABORTED: another writer touched a document we read. Run the whole transaction again, as firebase-admin does.
      if (e instanceof FirestoreError && e.code === 10 && attempt < 5) {
        await new Promise((r) => setTimeout(r, 50 * 2 ** attempt + Math.random() * 50));
        continue;
      }
      throw e;
    }
  }
}

const dbApi = {
  collection: (path: string) => collectionQuery(path),
  doc: (path: string) => docRef(path),
  getAll: (...refs: DocumentReference[]) => getDocs(refs),
  batch: () => {
    const { writes, w } = writer();
    const b = {
      set: (ref: DocumentReference, data: object, opts?: { merge?: boolean }) => (w.set(ref, data, opts), b),
      update: (ref: DocumentReference, data: object) => (w.update(ref, data), b),
      create: (ref: DocumentReference, data: object) => (w.create(ref, data), b),
      delete: (ref: DocumentReference) => (w.delete(ref), b),
      commit: async () => {
        if (writes.length) await commit(writes);
      },
    };
    return b;
  },
  runTransaction,
};

/** The app's Firestore handle (same calls as firebase-admin's Firestore, over REST). */
export function db() {
  return dbApi;
}
