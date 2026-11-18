// Conventional Commits. The scope says which part of the repo a commit changes.

// The subject is a command, as git and Conventional Commits write it: "add", "fix", "remove" (decision 109).
const imperative = ({ subject }) => {
    const first = (subject ?? "").split(" ")[0].toLowerCase();
    const descriptive = ["a", "an", "the", "each", "every"].includes(first) || first.endsWith("ed");
    return [!descriptive, 'write the subject as a command, such as "add ..." or "fix ...", not as a description'];
};

// A commit says what changed, not which tool wrote it.
const unsigned = ({ raw }) => [
    !/^\W*generated with\b|^co-authored-by:/im.test(raw ?? ""),
    'remove the "Generated with" or "Co-authored-by" line',
];

const config = {
    extends: ["@commitlint/config-conventional"],
    plugins: [{ rules: { "subject-imperative": imperative, "body-unsigned": unsigned } }],
    rules: {
        "subject-imperative": [2, "always"],
        "body-unsigned": [2, "always"],
        "scope-empty": [2, "never"],
        "scope-enum": [
            2,
            "always",
            [
                "repo", // Tooling, CI, AGENTS.md, and other files at the root
                "deps", // Dependency updates
                "docs", // The website in docs/
                "config", // The language in src/config, and src/model.ts
                "project", // Src/project.ts
                "checks", // Src/checks
                "core", // Src/core
                "platforms", // Src/platforms, including TRAPS.md
                "transport", // Src/transport
                "integrations", // Src/integrations
                "cli", // Src/cli
                "studio", // Src/studio
                "examples", // Examples/
                "release", // Version bumps
            ],
        ],
        "body-max-line-length": [0, "always"],
        "footer-max-line-length": [0, "always"],
        "subject-case": [2, "never", ["upper-case", "pascal-case", "start-case"]],
    },
};

export default config;
