// Contrôle de la compilation (GitHub) : signe l'application Android avec une clé jetable, comme le
// fera le serveur, pour que apksigner vérifie le résultat.
// Usage : node --experimental-strip-types scripts/signer-apk-essai.mts non-signee.apk signee.apk
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import { selfSignedCertificate, signApkV2 } from "../src/lib/server/apk-sign.ts";

const [input, output] = process.argv.slice(2);
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const cert = selfSignedCertificate(privateKey, publicKey, "DB.Mélo (essai)", "DB.Mélo");
fs.writeFileSync(output, signApkV2(fs.readFileSync(input), privateKey, publicKey, cert));
console.log(`Signée : ${output}`);
