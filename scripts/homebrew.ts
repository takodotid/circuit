// For the release workflow: `bun scripts/homebrew.ts <version> dist/release/SHA256SUMS` prints the formula of Tako's Homebrew tap (takodotid/homebrew-tap, Formula/circuit.rb) for that release, with each binary's SHA-256 from SHA256SUMS.

import { readFileSync } from "node:fs";

export class HomebrewFormula {
    private static readonly RELEASES = "https://github.com/takodotid/circuit/releases/download";

    /** The binary Homebrew installs on each system, by `on_macos`/`on_linux` and `on_arm`/`on_intel`. */
    private static readonly BINARIES = {
        macos: { arm: "circuit-darwin-arm64", intel: "circuit-darwin-x64" },
        linux: { arm: "circuit-linux-arm64", intel: "circuit-linux-x64" },
    } as const;

    /** Each file's SHA-256, from SHA256SUMS as `scripts/build.ts --release` writes it: `<hex>  <file>`. */
    static sums(text: string): Map<string, string> {
        const sums = new Map<string, string>();
        for (const line of text.split("\n")) {
            const match = /^([0-9a-f]{64}) {2}(\S+)$/.exec(line.trim());
            if (match) sums.set(match[2]!, match[1]!);
        }
        return sums;
    }

    static render(version: string, sums: Map<string, string>): string {
        if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`${version} is not a stable version: the tap follows stable releases only.`);
        const binary = (file: string) => {
            const sum = sums.get(file);
            if (!sum) throw new Error(`SHA256SUMS has no ${file}.`);
            return `      url "${HomebrewFormula.RELEASES}/v${version}/${file}"\n      sha256 "${sum}"`;
        };
        const system = (name: "macos" | "linux") => {
            const files = HomebrewFormula.BINARIES[name];
            return `  on_${name} do\n    on_arm do\n${binary(files.arm)}\n    end\n    on_intel do\n${binary(files.intel)}\n    end\n  end`;
        };

        return `class Circuit < Formula
  desc "Declarative, vendor-neutral network configuration"
  homepage "https://circuit.tako.id"
  version "${version}"
  license "BUSL-1.1"

${system("macos")}

${system("linux")}

  def install
    bin.install Dir["circuit-*"].first => "circuit"
    # With this file beside it, Circuit leaves its updates and its removal to Homebrew.
    (pkgshare/"package-manager").write <<~EOS
      brew upgrade takodotid/tap/circuit
      brew uninstall takodotid/tap/circuit
    EOS
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/circuit --version").strip
  end
end
`;
    }
}

if (import.meta.main) {
    const [version, file] = process.argv.slice(2);
    if (!version || !file)
        throw new Error("Give the version and SHA256SUMS, such as: bun scripts/homebrew.ts 1.3.0 dist/release/SHA256SUMS");
    process.stdout.write(HomebrewFormula.render(version, HomebrewFormula.sums(readFileSync(file, "utf8"))));
}
