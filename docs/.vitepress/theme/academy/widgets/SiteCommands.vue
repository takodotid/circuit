<script setup lang="ts">
// Lesson: project, a single site. The reader steps through the commands from the example's files to a change on a device, with what each one prints. Output is shown only where Circuit printed it for this example: a command that needs a device to answer shows the command alone. The printer's plan is what Circuit plans against a switch that runs the example.

type Step = { title: string; text: string; code: string; lang: "shell" | "text" };

const steps: Step[] = [
    {
        title: "Set the passwords",
        text: "secrets set keeps each password encrypted in .circuit/secrets. secrets list checks that every password the files use is there.",
        lang: "shell",
        code: [
            "$ circuit secrets set ROUTER_PASSWORD",
            "✔ Set ROUTER_PASSWORD in .circuit/secrets.",
            "$ circuit secrets set SWITCH_PASSWORD",
            "✔ Set SWITCH_PASSWORD in .circuit/secrets.",
            "$ circuit secrets list",
            "┌─────────────────┬───────────┐",
            "│ Name            │ Stored as │",
            "├─────────────────┼───────────┤",
            "│ ROUTER_PASSWORD │ encrypted │",
            "│ SWITCH_PASSWORD │ encrypted │",
            "└─────────────────┴───────────┘",
        ].join("\n"),
    },
    {
        title: "Make the files your own, then validate",
        text: "Change the addresses in site.ts and router.ts to yours, and the switch’s ports to what is plugged in where.",
        lang: "shell",
        code: ["$ circuit validate", "✔ 2 device(s), no errors."].join("\n"),
    },
    {
        title: "See what would change",
        text: "diff shows the plan against what the device runs now. It changes nothing.",
        lang: "shell",
        code: ["$ circuit diff switch", "$ circuit diff router"].join("\n"),
    },
    {
        title: "Apply the switch, then the router",
        text: "A mistake on the router can cut you off from both, so the switch goes first. apply shows the same plan, and sends it only when you answer yes.",
        lang: "shell",
        code: ["$ circuit apply switch", "$ circuit apply router"].join("\n"),
    },
    {
        title: "Later: a port for a printer",
        text: "A new printer goes on port 10g-5. You add one line to switch.ts, validate, and diff shows the plan: the port stops being shut down and joins VLAN 20.",
        lang: "shell",
        code: [
            '# switch.ts: "10g-5": { description: "Printer", access_vlan: "home", stp: { edge: true } },',
            "$ circuit diff switch",
            "switch: 6 command(s) in 1 step(s)",
            "  interface 10GE1/0/5",
            "    - shutdown",
            "    + description Printer",
            "    + port default vlan 20",
            "    + stp edged-port enable",
        ].join("\n"),
    },
    {
        title: "Apply it, and commit",
        text: "Commit the file once the apply is done.",
        lang: "shell",
        code: ["$ circuit apply switch", "$ git add sites/home/switch.ts", '$ git commit -m "Add a port for the printer"'].join("\n"),
    },
];
</script>

<template>
    <div class="site-commands">
        <StepThrough :steps="steps" v-slot="{ step }">
            <CodeView :code="steps[step]?.code ?? ''" :lang="steps[step]?.lang" title="Terminal" />
        </StepThrough>
    </div>
</template>
