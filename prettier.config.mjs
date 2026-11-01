// Based on the other @takodotid repositories, with a narrower printWidth so code is not packed into long lines. `proseWrap: "preserve"` keeps Markdown one paragraph per line.

/** @type {import("prettier").Config} */
const config = {
    trailingComma: "es5",
    bracketSpacing: true,
    arrowParens: "always",
    endOfLine: "auto",
    htmlWhitespaceSensitivity: "css",
    bracketSameLine: false,
    jsxSingleQuote: false,
    printWidth: 140,
    semi: true,
    tabWidth: 4,
    proseWrap: "preserve",
};

export default config;
