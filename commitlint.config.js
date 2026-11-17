// Conventional Commits. The scope says which part of the repo a commit changes.

export default {
    extends: ["@commitlint/config-conventional"],
    rules: {
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
