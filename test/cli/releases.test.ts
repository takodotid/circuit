// Which Circuit is current: versions compared as semver orders them, the version to update to, and the release file for each system.

import { expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { type Advisory, Advisories } from "../../src/cli/advisories";
import { type Release, Releases } from "../../src/cli/releases";
import { Signing } from "../../src/cli/signing";

test("versions compare as semver orders them, a release candidate before its release", () => {
    const ordered = ["0.43.1", "1.0.0-rc.0", "1.0.0-rc.2", "1.0.0-rc.10", "1.0.0", "1.0.1", "1.1.0", "2.0.0"];

    for (let i = 0; i < ordered.length - 1; i++) {
        expect(Releases.compare(ordered[i]!, ordered[i + 1]!)).toBeLessThan(0);
        expect(Releases.compare(ordered[i + 1]!, ordered[i]!)).toBeGreaterThan(0);
    }

    expect(Releases.compare("1.0.0-rc.1", "1.0.0-rc.1")).toBe(0);
    expect(Releases.compare("v1.2.3", "1.2.3")).toBe(0);
});

test("an update stays within the major version: the newest stable one, or the newest release candidate while on one", () => {
    const tags = { latest: "1.0.0", rc: "1.1.0-rc.1" };

    expect(Releases.target({ tags }, "1.0.0")).toBe("1.0.0");
    expect(Releases.target({ tags }, "1.1.0-rc.0")).toBe("1.1.0-rc.1");
    expect(Releases.target({ tags: { latest: "1.0.0" } }, "1.0.0-rc.3")).toBe("1.0.0");

    // While 0.x is still the stable release, a release candidate of 1 updates to the newest candidate.
    expect(Releases.target({ tags: { latest: "0.43.1", rc: "1.0.0-rc.1" } }, "1.0.0-rc.0")).toBe("1.0.0-rc.1");

    // A new major version is only told about.
    expect(Releases.target({ tags: { latest: "2.0.0" } }, "1.4.0")).toBeUndefined();
    expect(Releases.newerMajor({ tags: { latest: "2.0.0" } }, "1.4.0")).toBe("2.0.0");
    expect(Releases.newerMajor({ tags: { latest: "0.43.1" } }, "1.0.0-rc.1")).toBeUndefined();
});

// Two release lines with one problem: 1.15.1 and 1.9.4 are affected, fixed in 1.16.0 and, backported, 1.9.5.
const advisory: Advisory = {
    id: "GHSA-test-test-test",
    summary: "A password sent in plain text",
    severity: "critical",
    url: "https://github.com/advisories/GHSA-test-test-test",
    affected: [">= 1.10.0, < 1.16.0", "< 1.9.5"],
    patched: ["1.16.0", "1.9.5"],
};
const releases = ["0.43.1", "1.9.3", "1.9.4", "1.9.5", "1.10.0", "1.15.0", "1.15.1", "1.16.0", "1.17.0", "1.18.0-rc.1", "2.0.0"].map(
    (version): Release => ({ version })
);
const offered = (current: string, count?: number) =>
    Releases.choices(releases, current, [advisory], count).map((release) => release.version);

test("an advisory affects the versions in its ranges, as GitHub writes them", () => {
    expect(Releases.affecting([advisory], "1.15.1")).toEqual([advisory]);
    expect(Releases.affecting([advisory], "1.9.4")).toEqual([advisory]);
    expect(Releases.affecting([advisory], "1.9.5")).toEqual([]);
    expect(Releases.affecting([advisory], "1.16.0")).toEqual([]);

    expect(Advisories.inRange("= 1.2.3", "1.2.3", Releases.compare)).toBe(true);
    expect(Advisories.inRange("<= 1.0.0", "1.0.0-rc.1", Releases.compare)).toBe(true);
    expect(Advisories.inRange("> 1.0.0, <= 1.1.0", "1.0.0", Releases.compare)).toBe(false);
});

test("update offers the newest few of the major version, newest first, never one an advisory affects, and always the closest fix", () => {
    // From the old line: the newest, and its own line's fix, the least that changes.
    expect(offered("1.9.4")).toEqual(["1.17.0", "1.16.0", "1.9.5"]);
    expect(offered("1.9.4", 2)).toEqual(["1.17.0", "1.9.5"]);
    expect(offered("1.15.1")).toEqual(["1.17.0", "1.16.0"]);
    // On a release candidate, candidates too; never across a major version.
    expect(offered("1.17.0")).toEqual([]);
    expect(Releases.choices(releases, "1.17.0-rc.1", [advisory]).map((release) => release.version)).toEqual(["1.18.0-rc.1", "1.17.0"]);
});

test("GitHub's advisories are read for this package only", () => {
    const answer = [
        {
            ghsa_id: "GHSA-aaaa-bbbb-cccc",
            summary: "Something",
            severity: "high",
            html_url: "https://github.com/takodotid/circuit/security/advisories/GHSA-aaaa-bbbb-cccc",
            vulnerabilities: [
                {
                    package: { ecosystem: "npm", name: "@takodotid/circuit" },
                    vulnerable_version_range: "< 1.9.5",
                    patched_versions: "1.9.5",
                },
                { package: { ecosystem: "npm", name: "another" }, vulnerable_version_range: "< 9.0.0", patched_versions: "9.0.0" },
            ],
        },
        { ghsa_id: "GHSA-dddd-eeee-ffff", vulnerabilities: [{ package: { name: "another" } }] },
    ];

    expect(Advisories.parse(answer)).toEqual([
        {
            id: "GHSA-aaaa-bbbb-cccc",
            summary: "Something",
            severity: "high",
            url: "https://github.com/takodotid/circuit/security/advisories/GHSA-aaaa-bbbb-cccc",
            affected: ["< 1.9.5"],
            patched: ["1.9.5"],
        },
    ]);
    expect(Advisories.parse({ message: "API rate limit exceeded" })).toEqual([]);
});

test("a download is trusted only with SHA256SUMS signed by a release key", () => {
    const pair = generateKeyPairSync("ed25519");
    const keys = [pair.publicKey.export({ type: "spki", format: "pem" }).toString()];
    const sums = Buffer.from("abc123  circuit-linux-x64\ndef456  circuit-windows-x64.exe\n");
    const signature = sign(null, sums, pair.privateKey).toString("base64");

    expect(Releases.expectedHash(sums, signature, "circuit-windows-x64.exe", keys)).toBe("def456");
    expect(() => Releases.expectedHash(Buffer.from(`${sums}evil  circuit-linux-x64\n`), signature, "circuit-linux-x64", keys)).toThrow(
        "not signed"
    );
    expect(() => Releases.expectedHash(sums, signature, "circuit-linux-x64")).toThrow("not signed");
    expect(() => Releases.expectedHash(sums, signature, "circuit-darwin-arm64", keys)).toThrow("names no circuit-darwin-arm64");
    expect(Signing.KEYS.length).toBeGreaterThan(0);
});

test("each system has its release file", () => {
    expect(Releases.asset("linux", "x64")).toBe("circuit-linux-x64");
    expect(Releases.asset("linux", "arm64")).toBe("circuit-linux-arm64");
    expect(Releases.asset("darwin", "arm64")).toBe("circuit-darwin-arm64");
    expect(Releases.asset("win32", "x64")).toBe("circuit-windows-x64.exe");
    expect(Releases.asset("win32", "arm64")).toBeUndefined();
    expect(Releases.asset("freebsd", "x64")).toBeUndefined();
});
