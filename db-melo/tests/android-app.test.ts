// Application Android : signature v2 faite par le serveur, clé gardée, assetlinks.json.
import { createHash, generateKeyPairSync, verify, X509Certificate } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { certificateFingerprint, selfSignedCertificate, signApkV2 } from "@/lib/server/apk-sign";

/** Archive ZIP minimale (fichiers stockés sans compression), comme un APK non signé. */
function zip(files: Record<string, Buffer>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(10, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(10, 4);
    cd.writeUInt16LE(10, 6);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(n.length, 28);
    cd.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    central.push(cd, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(central.length / 2, 8);
  eocd.writeUInt16LE(central.length / 2, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const unsigned = zip({ "AndroidManifest.xml": Buffer.alloc(700, 1), "classes.dex": Buffer.alloc(2_500_000, 7), "resources.arsc": Buffer.alloc(900, 3) });

/** Lit une suite de valeurs précédées de leur longueur (uint32), le format des blocs de signature. */
function lpList(buf: Buffer): Buffer[] {
  const out: Buffer[] = [];
  for (let p = 0; p < buf.length; ) {
    const len = buf.readUInt32LE(p);
    out.push(buf.subarray(p + 4, p + 4 + len));
    p += 4 + len;
  }
  return out;
}

/** Relit le bloc de signature v2 inséré avant le répertoire central. */
function readV2(apk: Buffer) {
  const eocd = apk.length - 22;
  const cdOffset = apk.readUInt32LE(eocd + 16);
  expect(apk.subarray(cdOffset - 16, cdOffset).toString("latin1")).toBe("APK Sig Block 42");
  const size = Number(apk.readBigUInt64LE(cdOffset - 24));
  const start = cdOffset - size - 8;
  expect(Number(apk.readBigUInt64LE(start))).toBe(size);
  const pairLen = Number(apk.readBigUInt64LE(start + 8));
  expect(apk.readUInt32LE(start + 16)).toBe(0x7109871a);
  const value = apk.subarray(start + 20, start + 16 + pairLen);
  const [signers] = lpList(value);
  const [signer] = lpList(signers);
  const [signedData, signatures, publicKey] = lpList(signer);
  const [digests, certs] = lpList(signedData);
  const [sig] = lpList(signatures);
  return {
    start,
    cdOffset,
    block: apk.subarray(start, cdOffset),
    signedData,
    digest: lpList(lpList(digests)[0].subarray(4))[0],
    cert: lpList(certs)[0],
    signature: lpList(sig.subarray(4))[0],
    algorithm: sig.readUInt32LE(0),
    publicKey,
  };
}

describe("signature APK v2", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const cert = selfSignedCertificate(privateKey, publicKey, "DB.Mélo", "DB.Mélo");

  it("certificat X.509 lisible, autosigné, valable 50 ans", () => {
    const x = new X509Certificate(cert);
    expect(x.subject).toContain("CN=DB.Mélo");
    expect(x.verify(publicKey)).toBe(true);
    expect(new Date(x.validTo).getUTCFullYear() - new Date().getUTCFullYear()).toBe(50);
    expect(certificateFingerprint(cert)).toBe(x.fingerprint256);
  });

  it("bloc inséré avant le répertoire central, contenu d'origine intact, signature valable", () => {
    const signed = signApkV2(unsigned, privateKey, publicKey, cert);
    const { start, cdOffset, block } = readV2(signed);
    const origCd = unsigned.readUInt32LE(unsigned.length - 22 + 16);
    expect(start).toBe(origCd);
    expect(cdOffset).toBe(origCd + block.length);
    expect(signed.subarray(0, start).equals(unsigned.subarray(0, origCd))).toBe(true);
    expect(signed.subarray(cdOffset, signed.length - 22).equals(unsigned.subarray(origCd, unsigned.length - 22))).toBe(true);

    // Données signées : condensé et certificat ; signature RSA PKCS#1 SHA-256 vérifiable.
    const v2 = readV2(signed);
    expect(v2.algorithm).toBe(0x0103);
    expect(v2.cert.equals(cert)).toBe(true);
    expect(v2.publicKey.equals(publicKey.export({ type: "spki", format: "der" }))).toBe(true);
    expect(verify("sha256", v2.signedData, publicKey, v2.signature)).toBe(true);
  });

  it("condensé par morceaux de 1 Mo conforme à la spécification", () => {
    const signed = signApkV2(unsigned, privateKey, publicKey, cert);
    const eocdAt = unsigned.length - 22;
    const cdAt = unsigned.readUInt32LE(eocdAt + 16);
    const chunks: Buffer[] = [];
    for (const section of [unsigned.subarray(0, cdAt), unsigned.subarray(cdAt, eocdAt), unsigned.subarray(eocdAt)]) {
      for (let o = 0; o < section.length; o += 1 << 20) {
        const c = section.subarray(o, Math.min(o + (1 << 20), section.length));
        const len = Buffer.alloc(4);
        len.writeUInt32LE(c.length);
        chunks.push(createHash("sha256").update(Buffer.from([0xa5])).update(len).update(c).digest());
      }
    }
    const count = Buffer.alloc(4);
    count.writeUInt32LE(chunks.length);
    const digest = createHash("sha256").update(Buffer.from([0x5a])).update(count).update(Buffer.concat(chunks)).digest();
    expect(chunks.length).toBe(5); // 2,5 Mo d'entrées en 3 morceaux, puis le répertoire central, puis la fin
    expect(readV2(signed).digest.equals(digest)).toBe(true);
  });

  it("refuse un APK déjà signé ou une archive invalide", () => {
    const signed = signApkV2(unsigned, privateKey, publicKey, cert);
    expect(() => signApkV2(signed, privateKey, publicKey, cert)).toThrow(/déjà signé/);
    expect(() => signApkV2(Buffer.from("pas un zip"), privateKey, publicKey, cert)).toThrow(/invalide/);
  });
});

describe("application Android servie par le site", () => {
  let dir: string;
  let app: typeof import("@/lib/server/android-app");

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbmelo-android-"));
    fs.writeFileSync(path.join(dir, "non-signee.apk"), unsigned);
    vi.stubEnv("DATA_DIR", path.join(dir, "data"));
    vi.stubEnv("ANDROID_APK_PATH", path.join(dir, "non-signee.apk"));
    app = await import("@/lib/server/android-app");
  });

  it("signe avec la clé du serveur, gardée en privé, et réutilise le résultat", async () => {
    const apk = await app.androidApk();
    expect(apk).not.toBeNull();
    readV2(apk as Buffer);
    const keyFile = path.join(dir, "data", "android", "cle-signature.json");
    expect(fs.statSync(keyFile).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(path.join(dir, "data", "android")).filter((f) => f.endsWith(".apk"))).toHaveLength(1);
    expect((await app.androidApk())?.equals(apk as Buffer)).toBe(true);
  });

  it("assetlinks.json publie l'empreinte de cette clé", async () => {
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "data", "android", "cle-signature.json"), "utf8"));
    const [link] = await app.assetLinks();
    expect(link.target.package_name).toBe("com.dbmelo.app");
    expect(link.target.sha256_cert_fingerprints).toEqual([certificateFingerprint(Buffer.from(saved.cert, "base64"))]);
  });
});
