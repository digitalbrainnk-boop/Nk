// Application Android à télécharger (dbmelo.com/dbmelo.apk) : chaque version du site arrive avec
// l'application non signée (dossier android/ du paquet) ; le serveur la signe avec sa propre clé,
// créée au premier téléchargement dans DATA_DIR/android, et garde le résultat en cache.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { certificateFingerprint, selfSignedCertificate, signApkV2 } from "./apk-sign";
import { config } from "./env";

/** Identifiant de l'application, identique dans db-melo/android/app/build.gradle. */
export const ANDROID_PACKAGE = "com.dbmelo.app";

const unsignedApk = () => process.env.ANDROID_APK_PATH || path.join(process.cwd(), "android", "dbmelo-non-signee.apk");
const dir = () => path.join(path.resolve(config.dataDir()), "android");

interface SigningKey {
  privateKey: KeyObject;
  publicKey: KeyObject;
  cert: Buffer;
}

let keyMemo: SigningKey | null = null;
let apkMemo: { hash: string; apk: Buffer } | null = null;

/** Écrit le fichier seulement s'il n'existe pas encore (plusieurs processus peuvent démarrer ensemble). */
async function createOnce(file: string, data: string | Buffer): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, data, { mode: 0o600 });
  try {
    await fs.link(tmp, file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

/** Clé de signature du serveur : à garder, car Android n'accepte une mise à jour que signée par la même clé. */
async function signingKey(): Promise<SigningKey> {
  if (keyMemo) return keyMemo;
  const file = path.join(dir(), "cle-signature.json");
  await fs.mkdir(dir(), { recursive: true, mode: 0o700 });
  try {
    await fs.access(file);
  } catch {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const cert = selfSignedCertificate(privateKey, publicKey, "DB.Mélo", "DB.Mélo");
    await createOnce(file, JSON.stringify({ key: privateKey.export({ type: "pkcs8", format: "pem" }), cert: cert.toString("base64") }));
  }
  const saved = JSON.parse(await fs.readFile(file, "utf8")) as { key: string; cert: string };
  const privateKey = createPrivateKey(saved.key);
  keyMemo = { privateKey, publicKey: createPublicKey(privateKey), cert: Buffer.from(saved.cert, "base64") };
  return keyMemo;
}

/** L'application signée, ou null si ce paquet n'en contient pas. */
export async function androidApk(): Promise<Buffer | null> {
  let unsigned: Buffer;
  try {
    // Fichier du paquet lu à l'exécution : rien à embarquer à la compilation.
    unsigned = await fs.readFile(/*turbopackIgnore: true*/ unsignedApk());
  } catch {
    return null;
  }
  const hash = createHash("sha256").update(unsigned).digest("hex").slice(0, 16);
  if (apkMemo?.hash === hash) return apkMemo.apk;

  const file = path.join(dir(), `dbmelo-${hash}.apk`);
  let apk: Buffer;
  try {
    apk = await fs.readFile(file);
  } catch {
    const { privateKey, publicKey, cert } = await signingKey();
    apk = signApkV2(unsigned, privateKey, publicKey, cert);
    // La signature RSA est déterministe : deux processus qui signent en même temps écrivent le même fichier.
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, apk);
    await fs.rename(tmp, file);
    for (const old of await fs.readdir(dir())) {
      if (/^dbmelo-[0-9a-f]{16}\.apk$/.test(old) && path.join(dir(), old) !== file) await fs.rm(path.join(dir(), old), { force: true });
    }
  }
  apkMemo = { hash, apk };
  return apk;
}

/** Déclaration qui autorise l'application à ouvrir dbmelo.com en plein écran, sans barre d'adresse. */
export async function assetLinks() {
  const { cert } = await signingKey();
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: [certificateFingerprint(cert)] },
    },
  ];
}
