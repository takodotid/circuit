// Conventional Commits. The scope says which part of the repo a commit changes.

// The subject is a command, as git and Conventional Commits write it: "add", "fix", "remove" (decision 109).
const imperative = ({ subject }) => {
    const first = (subject ?? "").split(" ")[0].toLowerCase();
    const descriptive = ["a", "an", "the", "each", "every"].includes(first) || first.endsWith("ed");
    return [!descriptive, 'write the subject as a command, such as "add ..." or "fix ...", not as a description'];
};

export default {
    extends: ["@commitlint/config-conventional"],
    plugins: [{ rules: { "subject-imperative": imperative } }],
    rules: {
        "subject-imperative": [2, "always"],
        "scope-empty": [2, "never"],
        "scope-enum": [
            2,
            "always",
            [
                "repo", // tooling, CI, AGENTS.md and other files at the root
                "deps", // dependency updates
                "docs", // the website in docs/
                "config", // src/config and src/model.ts
                "project", // src/project.ts
                "checks", // src/checks
                "core", // src/core
                "platforms", // src/platforms, including TRAPS.md
                "transport", // src/transport
                "integrations", // src/integrations
                "cli", // src/cli
                "studio", // src/studio
                "examples", // examples/
                "release", // version bumps
            ],
        ],
        "body-max-line-length": [0, "always"],
        "footer-max-line-length": [0, "always"],
        "subject-case": [2, "never", ["upper-case", "pascal-case", "start-case"]],
    },
};
