<script setup lang="ts">
// Lesson: running it day to day. The reader steps through one change to the colocation template, from the request to the commit, with what each command prints. Output is Circuit's own, run on the template; the snapshot diff compares against is the template's build, and commands that need a device show the command alone.

type Step = { title: string; text: string; code: string; lang: "shell" | "text" | "ts"; file: string; highlight?: number[] };

const steps: Step[] = [
    {
        title: "The request",
        file: "Ticket",
        lang: "text",
        text: "Every change starts as a request someone can point to later: who asked, for what, and by when. Here a tenant wants a third server on the network.",
        code: [
            "From:     acme",
            "Asks for: a port for a third server, server 3, rack A1",
            "Needs:    the same two networks as servers 1 and 2",
            "By:       Thursday",
        ].join("\n"),
    },
    {
        title: "A branch of its own",
        file: "Terminal",
        lang: "shell",
        text: "The change is made on a git branch, not on main, so nothing reaches a device until someone else has read it.",
        code: ["$ git switch -c acme-server-3", "Switched to a new branch 'acme-server-3'"].join("\n"),
    },
    {
        title: "Change the file",
        file: "tenants/acme.ts",
        lang: "ts",
        highlight: [4],
        text: "One line in the tenant's own file. Port 10g-3 on tor-01 is free: no tenant's file names it.",
        code: [
            "ports: {",
            '    "tor-01": {',
            '        "10g-2": { description: "acme server 2", trunk: ["internet", "private"] },',
            '        "10g-3": { description: "acme server 3", trunk: ["internet", "private"] },',
            "    },",
            "},",
        ].join("\n"),
    },
    {
        title: "Validate",
        file: "Terminal",
        lang: "shell",
        text: "validate checks every file and your own checks. An error here stops the change before anyone reviews it.",
        code: ["$ npx circuit validate", "2 device(s), no errors."].join("\n"),
    },
    {
        title: "Diff",
        file: "Terminal",
        lang: "shell",
        text: "diff plans the change against the last snapshot, offline. The router has nothing to do. On the switch, one port stops being shut down and carries acme's two VLANs. Paste this into the pull request.",
        code: [
            "$ npx circuit diff",
            "edge-01: matches",
            "tor-01: 7 command(s) in 1 step(s)",
            "  interface 10GE1/0/3",
            "    - shutdown",
            "    + description acme server 3",
            "    + port link-type trunk",
            "    + undo port trunk allow-pass vlan 1",
            "    + port trunk allow-pass vlan 1001 2001",
        ].join("\n"),
    },
    {
        title: "A pull request",
        file: "Terminal",
        lang: "shell",
        text: "Push the branch and open a pull request. Say what the change is for, link the request, and paste the plan, so the reviewer reads the network change and not only the file.",
        code: ['$ git commit -am "Give acme a port for server 3"', "$ git push -u origin acme-server-3", "$ gh pr create --base main"].join(
            "\n"
        ),
    },
    {
        title: "Review",
        file: "What the reviewer checks",
        lang: "text",
        text: "Someone else reads it. Studio's Compare, against main, shows the same change device by device and on the graph. Approve only when every answer is yes.",
        code: [
            "Does validate pass?                  yes",
            "Does the plan do only what was asked? yes: one port, 10GE1/0/3",
            "Does anything get removed?           only the port's shutdown",
            "Who notices?                         acme, whose server 3 comes up",
            "How is it undone?                    revert the commit and apply",
        ].join("\n"),
    },
    {
        title: "Apply, in the window",
        file: "Terminal",
        lang: "shell",
        text: "Merge, then apply at the time agreed with whoever it touches. apply reads the switch again first: if its plan is longer than the diff, someone changed the switch by hand, so stop and find out why.",
        code: ["$ git switch main && git pull", "$ npx circuit apply tor-01", "$ npx circuit apply tor-01 --confirm"].join("\n"),
    },
    {
        title: "Check, and commit the snapshot",
        file: "Terminal",
        lang: "shell",
        text: "Watch the port come up in your monitoring, and ask acme to confirm the server answers. Then commit the new snapshot, so git holds what the switch runs now.",
        code: ["$ git add .circuit", '$ git commit -m "Snapshot after acme server 3"', "$ git push"].join("\n"),
    },
];
</script>

<template>
    <div class="change-walk">
        <StepThrough :steps="steps" v-slot="{ step }">
            <CodeView
                :code="steps[step]?.code ?? ''"
                :lang="steps[step]?.lang"
                :title="steps[step]?.file"
                :highlight="steps[step]?.highlight"
            />
        </StepThrough>
    </div>
</template>
