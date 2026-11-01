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

test("a stable Circuit updates to the newest stable one, a release candidate to the newest of any", () => {
    const latest = { latest: "1.0.0", next: "1.1.0-rc.1", minimum: "1.0.0" };

    expect(Releases.target(latest, "1.0.0")).toBe("1.0.0");
    expect(Releases.target(latest, "1.1.0-rc.0")).toBe("1.1.0-rc.1");
    expect(Releases.target({ ...latest, next: "1.0.0" }, "1.0.0-rc.3")).toBe("1.0.0");
});

test("each system has its release file", () => {
    expect(Releases.asset("linux", "x64")).toBe("circuit-linux-x64");
    expect(Releases.asset("linux", "arm64")).toBe("circuit-linux-arm64");
    expect(Releases.asset("darwin", "arm64")).toBe("circuit-darwin-arm64");
    expect(Releases.asset("win32", "x64")).toBe("circuit-windows-x64.exe");
    expect(Releases.asset("win32", "arm64")).toBeUndefined();
    expect(Releases.asset("freebsd", "x64")).toBeUndefined();
});
