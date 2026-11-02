// Conventional Commits, with a scope naming the part of the repository a change touches.

export default {
    extends: ["@commitlint/config-conventional"],
    rules: {
        "scope-empty": [2, "never"],
        "scope-enum": [
            2,
            "always",
            [
                "repo", // tooling and meta files
                "docs", // README, AGENTS.md, docs/, TRAPS.md
                "config", // src/config, the language a project is written in, and src/model.ts
                "project", // src/project, reading a project
                "checks", // src/checks, validation and built-in checks
                "core", // src/core, addresses, secrets, cabling, registries
                "platforms", // src/platforms, one adapter per device operating system
                "transport", // src/transport, sessions to devices
                "cli", // src/cli
                "studio", // src/studio, Circuit Studio
                "examples", // tests and fixtures
                "release", // version bumps
            ],
        ],
        "body-max-line-length": [0, "always"],
        "footer-max-line-length": [0, "always"],
        "subject-case": [2, "never", ["upper-case", "pascal-case", "start-case"]],
    },
};
