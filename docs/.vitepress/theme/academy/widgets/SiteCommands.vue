<script setup lang="ts">
// Lesson: project, a single site. The reader steps through the commands from an empty folder to a change on a device, with what each one prints. Output is shown only where Circuit was run for real; commands that need a device show the command alone.

type Step = { title: string; text: string; code: string; lang: "shell" | "text" };

const steps: Step[] = [
    {
        title: "Start the project",
        text: "circuit new copies the single-site pattern into a new folder, writes an .env with one empty line per password, and installs Circuit. Then it says what to do next.",
        lang: "shell",
        code: [
            "$ npx @takodotid/circuit new my-network --pattern single-site",
            'Created my-network from the pattern "A single site".',
            "",
            "Next:",
            "  1. cd my-network",
            "  2. Fill in each password in .env, then run: npx circuit secrets",
            "  3. Change the names, addresses and ports in the device files to your own.",
            "  4. npx circuit validate",
            "  5. npx circuit snapshot, then npx circuit diff, to see what would change on each device",
            "",
            "What each file does: https://circuit.tako.id/patterns/single-site",
        ].join("\n"),
    },
    {
        title: "Fill in the passwords",
        text: "Put each device’s password in .env, which git never sees. circuit secrets checks that every secret the files use can be read, without printing any of them.",
        lang: "shell",
        code: [
            "$ npx circuit secrets",
            "  ok       ROUTER_PASSWORD, from .env",
            "  ok       SWITCH_PASSWORD, from .env",
            "",
            "2 secret(s), 0 missing.",
        ].join("\n"),
    },
    {
        title: "Make the files your own, then validate",
        text: "Change the addresses in site.ts and router.ts to yours, and the switch’s ports to what is plugged in where. validate checks every file, both ends of every cable, and your own checks.",
        lang: "shell",
        code: ["$ npx circuit validate", "2 device(s), no errors."].join("\n"),
    },
    {
        title: "Read the devices",
        text: "snapshot logs in to each device and saves what it runs in .circuit/state/. It changes nothing. diff then compares your files with that, offline.",
        lang: "shell",
        code: ["$ npx circuit snapshot", "$ npx circuit diff"].join("\n"),
    },
    {
        title: "Apply the switch, then the router",
        text: "apply reads the device again and shows the plan. The first plan of a device set up by hand is long, because whatever the file leaves out is removed. Read every line, add to the file what must stay, and only then add --confirm.",
        lang: "shell",
        code: [
            "$ npx circuit apply switch",
            "$ npx circuit apply switch --confirm",
            "$ npx circuit apply router",
            "$ npx circuit apply router --confirm",
        ].join("\n"),
    },
    {
        title: "Later: a port for a printer",
        text: "A new printer goes on port 10g-5. You add one line to switch.ts, validate, and diff shows the plan: the port stops being shut down and joins VLAN 20. The router has nothing to change.",
        lang: "shell",
        code: [
            '# switch.ts: "10g-5": { description: "Printer", access_vlan: "home", stp: { edge: true } },',
            "$ npx circuit diff",
            "router: matches",
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
        text: "apply sends the change and saves a new snapshot. Commit the file and the snapshot together: git now says who added the printer port, when, and why.",
        lang: "shell",
        code: ["$ npx circuit apply switch --confirm", "$ git add switch.ts .circuit", '$ git commit -m "Add a port for the printer"'].join(
            "\n"
        ),
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
