// Signs a release's SHA256SUMS with Circuit's release key, for the release workflow: `bun scripts/sign.ts dist/release/SHA256SUMS` writes SHA256SUMS.sig beside it. The key comes from RELEASE_SIGNING_KEY, an Ed25519 private key in PEM, and the signature is checked against the public keys Circuit carries before it is written.

import { createPrivateKey, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { Signing } from "../src/cli/signing";

const file = process.argv[2];
const key = process.env.RELEASE_SIGNING_KEY;
if (!file) throw new Error("Name the file to sign, such as dist/release/SHA256SUMS.");
if (!key) throw new Error("RELEASE_SIGNING_KEY is not set: the release cannot be signed.");

const data = readFileSync(file);
const signature = sign(null, data, createPrivateKey(key)).toString("base64");
if (!Signing.verify(data, signature))
    throw new Error("RELEASE_SIGNING_KEY is not one of the keys in src/cli/signing.ts: Circuit would refuse this release.");

writeFileSync(`${file}.sig`, `${signature}\n`);
console.log(`Signed ${file}.`);
