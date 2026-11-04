// Signs a release's SHA256SUMS with Circuit's release key, for the release workflow: `bun scripts/sign.ts dist/release/SHA256SUMS` writes SHA256SUMS.sig beside it, which Circuit checks, and SHA256SUMS.sshsig, the same key's signature as ssh-keygen makes one, which the installers check. The key comes from RELEASE_SIGNING_KEY, an Ed25519 private key in PEM, and the signature is checked against the public keys Circuit carries before it is written.

import { createPrivateKey, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { Signing } from "../src/cli/signing";
import { SshSig } from "./sshsig";

const file = process.argv[2];
const key = process.env.RELEASE_SIGNING_KEY;
if (!file) throw new Error("Name the file to sign, such as dist/release/SHA256SUMS.");
if (!key) throw new Error("RELEASE_SIGNING_KEY is not set: the release cannot be signed.");

const data = readFileSync(file);
const privateKey = createPrivateKey(key);
const signature = sign(null, data, privateKey).toString("base64");
if (!Signing.verify(data, signature))
    throw new Error("RELEASE_SIGNING_KEY is not one of the keys in src/cli/signing.ts: Circuit would refuse this release.");

writeFileSync(`${file}.sig`, `${signature}\n`);
writeFileSync(`${file}.sshsig`, SshSig.sign(data, privateKey));
console.log(`Signed ${file}.`);
