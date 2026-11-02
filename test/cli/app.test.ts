// Uninstalling takes out of a shell's startup file the line the installer added, and nothing else.

import { expect, test } from "bun:test";
import { App } from "../../src/cli/app";

test("only the line the installer marked goes", () => {
    const profile = ['export PATH="$HOME/bin:$PATH"', `export PATH="$HOME/.local/bin:$PATH" ${App.MARKER}`, "alias ll='ls -la'", ""].join(
        "\n"
    );

    expect(App.withoutMarked(profile)).toBe(['export PATH="$HOME/bin:$PATH"', "alias ll='ls -la'", ""].join("\n"));
});
