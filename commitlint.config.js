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
                "docs", // README, AGENTS.md, TRAPS.md
                "schema", // src/schema, the neutral model
                "core", // src/core, definition, validation, secrets, addresses
                "adapters", // src/adapters, platforms and registries
                "transport", // src/transport, sessions to devices
                "cli", // src/cli
                "examples", // examples and tests
            ],
        ],
        "body-max-line-length": [0, "always"],
        "footer-max-line-length": [0, "always"],
        "subject-case": [2, "never", ["upper-case", "pascal-case", "start-case"]],
    },
};
