// Writes latest.json, which the installers and `circuit` read to learn the current Circuit, from every published release on GitHub. The docs site serves it at https://circuit.tako.id/latest.json; its workflow runs this on each build, and the release workflow builds the site after each release, so no version is missed.
//
//   bun scripts/latest.ts <file>
//
// `latest` is the newest stable release, or the newest of any while there is none. `next` is the newest of any, a release candidate too. `minimum` is the newest release whose title holds [critical]: an older Circuit stops until it is updated.

import { writeFileSync } from "node:fs";
import { Releases } from "../src/cli/releases";

type Release = { tag_name: string; name: string | null; draft: boolean; prerelease: boolean };

const out = process.argv[2] ?? "latest.json";
const headers: Record<string, string> = { accept: "application/vnd.github+json" };
if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const releases: Release[] = [];
for (let page = 1; ; page++) {
    const response = await fetch(`https://api.github.com/repos/takodotid/circuit/releases?per_page=100&page=${page}`, { headers });
    if (!response.ok) throw new Error(`GitHub answered ${response.status} for the releases`);

    const batch = (await response.json()) as Release[];
    releases.push(...batch);
    if (batch.length < 100) break;
}

// Circuit 1 and later: 0.x was installed from npm and reads no latest.json.
const published = releases
    .filter((release) => !release.draft && /^v\d+\.\d+\.\d+(-[\w.]+)?$/.test(release.tag_name))
    .map((release) => ({ ...release, version: release.tag_name.slice(1) }))
    .filter((release) => Releases.compare(release.version, "1.0.0-rc.0") >= 0)
    .sort((a, b) => Releases.compare(b.version, a.version));

if (!published.length) {
    console.log("No Circuit 1 release is published yet, so latest.json is not written.");
    process.exit(0);
}

const stable = published.find((release) => !release.version.includes("-"));
const critical = published.find((release) => release.name?.includes("[critical]"));

const latest = {
    latest: (stable ?? published[0]!).version,
    next: published[0]!.version,
    minimum: critical?.version ?? "0.0.0",
};

writeFileSync(out, `${JSON.stringify(latest, null, 4)}\n`);
console.log(`${out}: ${JSON.stringify(latest)}`);
