// Stockage : fichiers JSON sur disque (VPS, Render + disque) ou Upstash Redis (Vercel / serverless).
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./env";
import type { PaymentRecord, SongRecord, UploadRecord } from "../types";

interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

const SAFE = /^[A-Za-z0-9_-]+$/;

function keyPath(root: string, key: string): string {
  const parts = key.split(":");
  if (!parts.every((p) => SAFE.test(p))) throw new Error(`Clé de stockage invalide : ${key}`);
  return path.join(root, ...parts) + ".json";
}

class FileKV implements KV {
  constructor(private root: string) {}
  async get(key: string) {
    try {
      return await fs.readFile(keyPath(this.root, key), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  async set(key: string, value: string) {
    const file = keyPath(this.root, key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, value);
    await fs.rename(tmp, file); // écriture atomique
  }
}

class UpstashKV implements KV {
  constructor(
    private url: string,
    private token: string,
  ) {}
  private async cmd(args: string[]): Promise<unknown> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as { result?: unknown; error?: string };
    if (!res.ok || data.error) throw new Error(`Upstash : ${data.error ?? res.status}`);
    return data.result;
  }
  async get(key: string) {
    const r = await this.cmd(["GET", `dbmelo:${key}`]);
    return typeof r === "string" ? r : null;
  }
  async set(key: string, value: string) {
    await this.cmd(["SET", `dbmelo:${key}`, value]);
  }
}

let kv: KV | null = null;
function store(): KV {
  if (!kv) {
    const up = config.upstash();
    kv = up.url && up.token ? new UpstashKV(up.url, up.token) : new FileKV(path.resolve(config.dataDir(), "db"));
  }
  return kv;
}

// Verrou en mémoire : sérialise les mises à jour d'un même objet dans ce processus.
const locks = new Map<string, Promise<void>>();
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const chained = prev.then(() => mine);
  locks.set(key, chained);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === chained) locks.delete(key);
  }
}

function collection<T extends object>(prefix: string, idOf: (v: T) => string) {
  const key = (id: string) => `${prefix}:${id}`;
  return {
    async get(id: string): Promise<T | null> {
      if (!SAFE.test(id)) return null;
      const raw = await store().get(key(id));
      return raw ? (JSON.parse(raw) as T) : null;
    },
    async put(value: T): Promise<T> {
      await store().set(key(idOf(value)), JSON.stringify(value));
      return value;
    },
    /** Lecture-modification-écriture protégée par le verrou. */
    async update(id: string, mutate: (current: T) => T | void | Promise<T | void>): Promise<T | null> {
      return withLock(key(id), async () => {
        const raw = SAFE.test(id) ? await store().get(key(id)) : null;
        if (!raw) return null;
        const current = JSON.parse(raw) as T;
        const next = ((await mutate(current)) ?? current) as T;
        await store().set(key(id), JSON.stringify(next));
        return next;
      });
    },
  };
}

export const songs = collection<SongRecord>("songs", (s) => s.id);
export const payments = collection<PaymentRecord>("payments", (p) => p.reference);
export const uploads = collection<UploadRecord>("uploads", (u) => u.id);
export const gifts = collection<{ slug: string; songId: string }>("gifts", (g) => g.slug);

/* ───────────── Fichiers binaires (archives audio, photos) : disque uniquement ───────────── */

const filesRoot = () => path.resolve(config.dataDir(), "files");

export const files = {
  async write(name: string, data: Uint8Array): Promise<string | null> {
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) throw new Error("Nom de fichier invalide.");
    try {
      await fs.mkdir(filesRoot(), { recursive: true });
      const file = path.join(filesRoot(), name);
      await fs.writeFile(file, data);
      return file;
    } catch (e) {
      // Système de fichiers en lecture seule (serverless) : on continue sans copie locale.
      console.warn("[DB.Mélo] Copie locale impossible :", (e as Error).message);
      return null;
    }
  },
  async read(name: string): Promise<Uint8Array | null> {
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) return null;
    try {
      return new Uint8Array(await fs.readFile(path.join(filesRoot(), name)));
    } catch {
      return null;
    }
  },
};
