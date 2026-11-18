<script setup lang="ts">
// Lesson: running it day to day. The reader steps through one change to the colocation example, from the request to the check, with what each command prints. Output is Circuit's own, run on the example; diff compares against the example's own render, which stands in for the device, and commands that need a device show the command alone.

type Step = { title: string; text: string; code: string; lang: "shell" | "text" | "ts"; file: string; highlight?: number[] };

const steps: Step[] = [
    {
        title: "The request",
        file: "Ticket",
        lang: "text",
        text: "Every change starts as a request someone can point to later: who asked, for what, and by when.",
        code: [
            "From:     Netflix",
            "Asks for: a port for a third server, server 3, rack A1",
            "Needs:    the same two networks as servers 1 and 2",
            "By:       Thursday",
        ].join("\n"),
    },
    {
        title: "A branch of its own",
        file: "Terminal",
        lang: "shell",
        text: "Make the change on a git branch, not on main, so nothing reaches a device until someone else has read it.",
        code: ["$ git switch -c netflix-server-3", "Switched to a new branch 'netflix-server-3'"].join("\n"),
    },
    {
        title: "Change the file",
        file: "tenants/netflix.ts",
        lang: "ts",
        highlight: [6],
        text: "One line in the tenant's own file, in its part for tor-01. Port 10g-3 is free: no tenant's file lists it.",
        code: [
            '"tor-01": part("device", {',
            "    switching: { vlans },",
            "    interfaces: {",
            "        ethernet: {",
            '            "10g-2": { description: "netflix server 2", trunk_vlans: ["netflix-internet", "netflix-private"] },',
            '            "10g-3": { description: "netflix server 3", trunk_vlans: ["netflix-internet", "netflix-private"] },',
            "        },",
            "    },",
            "}),",
        ].join("\n"),
    },
    {
        title: "Validate",
        file: "Terminal",
        lang: "shell",
        text: "validate runs every check, your own included. An error here stops the change before anyone reviews it.",
        code: ["$ circuit validate", "✔ 2 device(s), no errors."].join("\n"),
    },
    {
        title: "Diff",
        file: "Terminal",
        lang: "shell",
        text: "diff reads the switch and plans the change against what it runs now. One port stops being shut down, and carries the two VLANs of Netflix. Paste this into the pull request.",
        code: [
            "$ circuit diff tor-01",
            "tor-01: 7 command(s) in 1 step(s)",
            "  interface 10GE1/0/3",
            "    - shutdown",
            "    + description netflix server 3",
            "    + port link-type trunk",
            "    + undo port trunk allow-pass vlan 1",
            "    + port trunk allow-pass vlan 1001 2001",
        ].join("\n"),
    },
    {
        title: "A pull request",
        file: "Terminal",
        lang: "shell",
        text: "Push the branch and open a pull request. Link the request and paste the plan, so the reviewer reads the network change and not only the file.",
        code: [
            '$ git commit -am "Give Netflix a port for server 3"',
            "$ git push -u origin netflix-server-3",
            "$ gh pr create --base main",
        ].join("\n"),
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
            "Who notices?                         Netflix, whose server 3 comes up",
            "How is it undone?                    revert the commit and apply",
        ].join("\n"),
    },
    {
        title: "Apply, in the window",
        file: "Terminal",
        lang: "shell",
        text: "Merge, then apply at the time agreed with whoever it touches. Compare the plan with the one in the pull request before you answer.",
        code: ["$ git switch main && git pull", "$ circuit apply tor-01", "◆  Send these changes to tor-01?  Yes"].join("\n"),
    },
    {
        title: "Check",
        file: "Terminal",
        lang: "shell",
        text: "Watch the port come up in your monitoring, and ask Netflix to confirm the server answers. diff now plans nothing: the switch runs what main says.",
        code: ["$ circuit diff tor-01", "✔ tor-01 already matches its config."].join("\n"),
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
