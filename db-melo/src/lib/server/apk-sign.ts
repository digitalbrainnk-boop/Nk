// Signature d'une application Android (APK Signature Scheme v2), sans outil Android ni Java :
// le serveur signe lui-même l'application avec sa propre clé, qui ne quitte jamais le serveur.
// Spécification : https://source.android.com/docs/security/features/apksigning/v2
import { createHash, randomBytes, sign, type KeyObject } from "node:crypto";

/* ───────────── DER (certificat X.509 autosigné) ───────────── */

function der(tag: number, content: Buffer): Buffer {
  const n = content.length;
  const len =
    n < 0x80 ? Buffer.from([n]) : n < 0x100 ? Buffer.from([0x81, n]) : n < 0x10000 ? Buffer.from([0x82, n >> 8, n & 0xff]) : Buffer.from([0x83, n >> 16, (n >> 8) & 0xff, n & 0xff]);
  return Buffer.concat([Buffer.from([tag]), len, content]);
}
const seq = (...parts: Buffer[]) => der(0x30, Buffer.concat(parts));
const set = (...parts: Buffer[]) => der(0x31, Buffer.concat(parts));
const NULL = Buffer.from([0x05, 0x00]);

function oid(dotted: string): Buffer {
  const [a, b, ...rest] = dotted.split(".").map(Number);
  const bytes = [40 * a + b];
  for (const n of rest) {
    const chunk = [n & 0x7f];
    for (let v = n >>> 7; v > 0; v >>>= 7) chunk.unshift((v & 0x7f) | 0x80);
    bytes.push(...chunk);
  }
  return der(0x06, Buffer.from(bytes));
}

/** Nom distinctif : CN=…, O=… */
function name(cn: string, o: string): Buffer {
  return seq(set(seq(oid("2.5.4.3"), der(0x0c, Buffer.from(cn, "utf8")))), set(seq(oid("2.5.4.10"), der(0x0c, Buffer.from(o, "utf8")))));
}

/** Dates au format UTCTime avant 2050, GeneralizedTime ensuite (RFC 5280). */
function time(d: Date): Buffer {
  const iso = d.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return d.getUTCFullYear() < 2050 ? der(0x17, Buffer.from(`${iso.slice(2)}Z`)) : der(0x18, Buffer.from(`${iso}Z`));
}

const SHA256_WITH_RSA = seq(oid("1.2.840.113549.1.1.11"), NULL);

/** Certificat autosigné (v3, sans extension) valable 50 ans, comme ceux des clés de signature Android. */
export function selfSignedCertificate(privateKey: KeyObject, publicKey: KeyObject, cn: string, o: string): Buffer {
  const serial = randomBytes(8);
  serial[0] &= 0x7f;
  const now = new Date();
  const until = new Date(now);
  until.setUTCFullYear(now.getUTCFullYear() + 50);
  const tbs = seq(
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(0x02, serial),
    SHA256_WITH_RSA,
    name(cn, o),
    seq(time(now), time(until)),
    name(cn, o),
    publicKey.export({ type: "spki", format: "der" }),
  );
  const signature = sign("sha256", tbs, privateKey);
  return seq(tbs, SHA256_WITH_RSA, der(0x03, Buffer.concat([Buffer.from([0]), signature])));
}

/** Empreinte SHA-256 « AA:BB:… » du certificat, telle que la publie assetlinks.json. */
export function certificateFingerprint(cert: Buffer): string {
  return createHash("sha256").update(cert).digest("hex").toUpperCase().match(/../g)!.join(":");
}

/* ───────────── Signature v2 ───────────── */

const EOCD_SIG = 0x06054b50;
const BLOCK_MAGIC = Buffer.from("APK Sig Block 42", "latin1");
const V2_BLOCK_ID = 0x7109871a;
const RSA_PKCS1_SHA256 = 0x0103;
const CHUNK = 1024 * 1024;

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const u64 = (n: number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
/** Valeur précédée de sa longueur (uint32), la brique de tous les blocs de signature. */
const lp = (...parts: Buffer[]) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([u32(body.length), body]);
};

function findEocd(apk: Buffer): number {
  // L'enregistrement de fin fait 22 octets, plus un commentaire d'au plus 65 535 octets.
  for (let i = apk.length - 22; i >= Math.max(0, apk.length - 22 - 0xffff); i--) {
    if (apk.readUInt32LE(i) === EOCD_SIG && i + 22 + apk.readUInt16LE(i + 20) === apk.length) return i;
  }
  throw new Error("Fichier APK invalide : fin de l'archive introuvable");
}

/** Condensé « par morceaux » de la spécification v2 : morceaux de 1 Mo, puis condensé des condensés. */
function chunkedSha256(sections: Buffer[]): Buffer {
  const digests: Buffer[] = [];
  for (const section of sections) {
    for (let off = 0; off < section.length; off += CHUNK) {
      const chunk = section.subarray(off, Math.min(off + CHUNK, section.length));
      digests.push(createHash("sha256").update(Buffer.from([0xa5])).update(u32(chunk.length)).update(chunk).digest());
    }
  }
  return createHash("sha256").update(Buffer.from([0x5a])).update(u32(digests.length)).update(Buffer.concat(digests)).digest();
}

/**
 * Signe un APK non signé (aligné par zipalign) avec une clé RSA : bloc de signature v2 inséré
 * juste avant le répertoire central. Android 7.0 et plus récents (minSdk 24).
 */
export function signApkV2(apk: Buffer, privateKey: KeyObject, publicKey: KeyObject, cert: Buffer): Buffer {
  const eocd = findEocd(apk);
  const cdSize = apk.readUInt32LE(eocd + 12);
  const cdOffset = apk.readUInt32LE(eocd + 16);
  if (cdOffset + cdSize !== eocd) throw new Error("Fichier APK invalide : répertoire central mal placé");
  if (cdOffset >= 16 && apk.subarray(cdOffset - 16, cdOffset).equals(BLOCK_MAGIC)) throw new Error("Cet APK est déjà signé");

  const entries = apk.subarray(0, cdOffset);
  const centralDir = apk.subarray(cdOffset, eocd);
  const end = apk.subarray(eocd);
  const digest = chunkedSha256([entries, centralDir, end]);

  const signedData = Buffer.concat([
    lp(lp(u32(RSA_PKCS1_SHA256), lp(digest))), // condensés
    lp(lp(cert)), // certificats
    lp(), // attributs supplémentaires
  ]);
  const signer = lp(
    lp(signedData),
    lp(lp(u32(RSA_PKCS1_SHA256), lp(sign("sha256", signedData, privateKey)))),
    lp(publicKey.export({ type: "spki", format: "der" })),
  );
  const v2Value = lp(signer);

  const pair = Buffer.concat([u64(4 + v2Value.length), u32(V2_BLOCK_ID), v2Value]);
  const blockSize = pair.length + 8 + 16;
  const block = Buffer.concat([u64(blockSize), pair, u64(blockSize), BLOCK_MAGIC]);

  // Le répertoire central se trouve désormais après le bloc de signature.
  const newEnd = Buffer.from(end);
  newEnd.writeUInt32LE(cdOffset + block.length, 16);
  return Buffer.concat([entries, block, centralDir, newEnd]);
}
