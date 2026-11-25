import { expect, test } from "bun:test";
import { HomebrewFormula } from "../../scripts/homebrew";

// v1.2.1's SHA256SUMS, as the release carries it.
const SUMS = `696bfd008da82ff0361f02832a75dbf3a930583c1069ab241bb975e849fbe07e  circuit-linux-x64
92a92ce3e2e9a7d53ae3e98005acf1f4479f247588fe2cb5493b475cf2a70995  circuit-linux-arm64
9f55692097794b13cfe2d8c070a1c08d560758f413e9449221eaac142548f593  circuit-darwin-x64
d56dba773dae8581c0b0e34578d3a3c352fa19cf218dbdb6bad13b07a66d06b0  circuit-darwin-arm64
57345c1dc27e3fcb60c4e19d267d4d319bf31fc101716b4c2eef7dca9b5ea08d  circuit-windows-x64.exe
`;

test("the formula installs each system's binary of the release, with its SHA-256", () => {
    const formula = HomebrewFormula.render("1.2.1", HomebrewFormula.sums(SUMS));

    expect(formula).toContain('  version "1.2.1"\n');
    expect(formula).toContain(
        '    on_arm do\n      url "https://github.com/takodotid/circuit/releases/download/v1.2.1/circuit-darwin-arm64"\n      sha256 "d56dba773dae8581c0b0e34578d3a3c352fa19cf218dbdb6bad13b07a66d06b0"\n'
    );
    expect(formula).toContain(
        '    on_intel do\n      url "https://github.com/takodotid/circuit/releases/download/v1.2.1/circuit-linux-x64"\n      sha256 "696bfd008da82ff0361f02832a75dbf3a930583c1069ab241bb975e849fbe07e"\n'
    );
    expect(formula).not.toContain("windows");
});

test("the formula follows stable releases only, and needs every binary it names", () => {
    expect(() => HomebrewFormula.render("1.3.0-rc.1", HomebrewFormula.sums(SUMS))).toThrow("not a stable version");
    expect(() => HomebrewFormula.render("1.3.0", HomebrewFormula.sums(SUMS.replace(/.*circuit-linux-arm64\n/, "")))).toThrow(
        "SHA256SUMS has no circuit-linux-arm64."
    );
});
