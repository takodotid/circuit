// Which Circuit is current: versions compared as semver orders them, the version to update to, and the release file for each system.

import { expect, test } from "bun:test";
import { Releases } from "../../src/cli/releases";

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

test("each system has its release file", () => {
    expect(Releases.asset("linux", "x64")).toBe("circuit-linux-x64");
    expect(Releases.asset("linux", "arm64")).toBe("circuit-linux-arm64");
    expect(Releases.asset("darwin", "arm64")).toBe("circuit-darwin-arm64");
    expect(Releases.asset("win32", "x64")).toBe("circuit-windows-x64.exe");
    expect(Releases.asset("win32", "arm64")).toBeUndefined();
    expect(Releases.asset("freebsd", "x64")).toBeUndefined();
});
