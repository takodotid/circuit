<script setup lang="ts">
// Lesson: project, a single site. The reader steps through the commands from an empty folder to a change on a device, with what each one prints. Output is shown only where Circuit was run for real; commands that need a device show the command alone.

type Step = { title: string; text: string; code: string; lang: "shell" | "text" };

const steps: Step[] = [
    {
        title: "Install Circuit and start the project",
        text: "One command installs Circuit and asks a few questions: the folder, your AS number, git, and where to keep the key that decrypts .env. Then copy the files of the single-site example into the project's folder.",
        lang: "shell",
        code: [
            "$ curl -fsSL https://circuit.tako.id/install | sh",
            "Circuit is installed: /home/you/.circuit/bin/circuit",
            "┌  A new Circuit project",
            "◇  Project folder: my-network",
            "◇  How should this project run Circuit? Simple (recommended)",
            "◇  Your network's AS number: 64500",
            "◇  Start a git repository? Yes",
            "└  The project is ready.",
            "",
            "Example files: https://circuit.tako.id/guide/examples#a-single-site",
        ].join("\n"),
    },
    {
        title: "Set the passwords",
        text: "circuit secret set asks for each password without showing it, and writes it to .env, encrypted. circuit secret lists every secret the files use, and says which are missing, without printing any of them.",
        lang: "shell",
        code: [
            "$ circuit secret set ROUTER_PASSWORD",
            "$ circuit secret set SWITCH_PASSWORD",
            "$ circuit secret",
            "  ROUTER_PASSWORD  encrypted",
            "  SWITCH_PASSWORD  encrypted",
            "",
            "Key that decrypts .env: .env.keys",
        ].join("\n"),
    },
    {
        title: "Make the files your own, then validate",
        text: "Change the addresses in site.ts and router.ts to yours, and the switch’s ports to what is plugged in where. validate checks every file, both ends of every cable, and your own checks.",
        lang: "shell",
        code: ["$ circuit validate", "✔ 2 device(s), no errors."].join("\n"),
    },
    {
        title: "See what would change",
        text: "diff logs in to the device, reads what it runs now, and shows the plan. It changes nothing.",
        lang: "shell",
        code: ["$ circuit diff switch", "$ circuit diff router"].join("\n"),
    },
    {
        title: "Apply the switch, then the router",
        text: "apply shows the same plan, then asks. The first plan of a device set up by hand is long, because whatever the file leaves out is removed. Read every line, add to the file what must stay, and only then answer yes.",
        lang: "shell",
        code: [
            "$ circuit apply switch",
            "◆  Send these changes to switch?  Yes",
            "$ circuit apply router",
            "◆  Send these changes to router?  Yes",
        ].join("\n"),
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
        text: "apply sends the change once you say yes. Commit the file: git now says who added the printer port, when, and why.",
        lang: "shell",
        code: [
            "$ circuit apply switch",
            "◆  Send these changes to switch?  Yes",
            "$ git add sites/home/switch.ts",
            '$ git commit -m "Add a port for the printer"',
        ].join("\n"),
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
