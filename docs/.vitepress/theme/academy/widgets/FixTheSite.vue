<script setup lang="ts">
// Lesson: project, a single site. The reader runs circuit validate on five deliberate mistakes in the single-site example, reads what it says, and picks the fix. Every output is what Circuit printed for that one mistake.

import { computed, ref } from "vue";

type Fix = { label: string; right: boolean; why: string };

type Mistake = {
    title: string;
    file: string;
    wrong: string;
    fixed: string;
    /** The line that is wrong, and later fixed, counted from 1. */
    line: number;
    output: string;
    /** What the editor says before validate is even run, when it says anything. */
    editor?: string;
    fixes: Fix[];
};

const CLEAN = "$ circuit validate\n✔ 2 device(s), no errors.";

const mistakes: Mistake[] = [
    {
        title: "A VLAN missing on one end of the trunk",
        file: "sites/home/switch.ts",
        wrong: [
            '"10g-1": {',
            '    description: "router sfp28-1",',
            '    trunk_vlans: ["mgmt", "home"],',
            '    link: { device: "router", port: "25g-1" },',
            "},",
        ].join("\n"),
        fixed: [
            '"10g-1": {',
            '    description: "router sfp28-1",',
            '    trunk_vlans: ["mgmt", "home", "guests"],',
            '    link: { device: "router", port: "25g-1" },',
            "},",
        ].join("\n"),
        line: 3,
        output: [
            "$ circuit validate",
            "  error  router: interfaces.ethernet.25g-1.link: interfaces.ethernet.25g-1 carries VLANs 10, 20, 30 tagged, and switch interfaces.ethernet.10g-1 carries VLANs 10, 20 tagged",
            "  error  switch: interfaces.ethernet.10g-1.link: interfaces.ethernet.10g-1 carries VLANs 10, 20 tagged, and router interfaces.ethernet.25g-1 carries VLANs 10, 20, 30 tagged",
            "",
            "2 error(s).",
        ].join("\n"),
        fixes: [
            {
                label: "Add guests to the switch’s trunk_vlans",
                right: true,
                why: "Both ends now carry VLANs 10, 20 and 30, so the guest VLAN reaches its gateway on the router.",
            },
            {
                label: "Delete link from both ports",
                right: false,
                why: "Circuit would stop comparing the two ends, but the cable would still not carry guests, and the guest access point would get no address.",
            },
            {
                label: "Remove guests from the router’s trunk_vlans",
                right: false,
                why: "The two ends would match, but no cable would carry guests to the router, which is their gateway and DHCP server.",
            },
        ],
    },
    {
        title: "Management on a socket anyone can use",
        file: "sites/home/switch.ts",
        wrong: [
            '"10g-2": { description: "Desk", access_vlan: "home", stp: { edge: true } },',
            '"10g-3": { description: "Living room", access_vlan: "home", stp: { edge: true } },',
            '"10g-4": { description: "Guest access point", access_vlan: "mgmt", stp: { edge: true } },',
        ].join("\n"),
        fixed: [
            '"10g-2": { description: "Desk", access_vlan: "home", stp: { edge: true } },',
            '"10g-3": { description: "Living room", access_vlan: "home", stp: { edge: true } },',
            '"10g-4": { description: "Guest access point", access_vlan: "guests", stp: { edge: true } },',
        ].join("\n"),
        line: 3,
        output: [
            "$ circuit validate",
            "sites/home/switch.ts:30: management_stays_on_trunks: switch: interfaces.ethernet.10g-4: gives management to whatever plugs in. Put the port in another VLAN.",
            "",
            "1 error(s).",
        ].join("\n"),
        fixes: [
            {
                label: "Put the port back on guests",
                right: true,
                why: "The access point is on guests again, and the management VLAN only travels on the trunk between the two devices.",
            },
            {
                label: "Delete the check from lib/checks.ts",
                right: false,
                why: "The error goes away and the hole stays: whoever plugs into that socket is on the management network.",
            },
            {
                label: "Turn the check off in circuit.ts",
                right: false,
                why: "Same hole, quieter: validate stops looking, and diff and apply send the port to the switch as it is.",
            },
        ],
    },
    {
        title: "A typo in a VLAN name",
        file: "sites/home/switch.ts",
        wrong: '"10g-4": { description: "Guest access point", access_vlan: "guest", stp: { edge: true } },',
        fixed: '"10g-4": { description: "Guest access point", access_vlan: "guests", stp: { edge: true } },',
        line: 1,
        editor: `Type '"guest"' is not assignable to type '"guests" | "home" | "mgmt" | undefined'. Did you mean '"guests"'?`,
        output: [
            "$ circuit validate",
            "sites/home/switch.ts:30: switch: interfaces.ethernet.10g-4.access_vlan: no VLAN guest. Did you mean guests?",
            "",
            "1 error(s).",
        ].join("\n"),
        fixes: [
            {
                label: "Write guests, the name site.ts declares",
                right: true,
                why: "The name now matches a VLAN the switch declares, and the editor’s red line goes away too.",
            },
            {
                label: "Add a VLAN called guest to site.ts",
                right: false,
                why: "The name would exist, but the port would be on a new, empty VLAN with no gateway and no DHCP server.",
            },
        ],
    },
    {
        title: "Two devices with one address",
        file: "sites/home/switch.ts",
        wrong: ["vlan_interface: {", '    mgmt: { vlan: "mgmt", addresses: ["192.168.10.1/24"] },', "},"].join("\n"),
        fixed: ["vlan_interface: {", '    mgmt: { vlan: "mgmt", addresses: [home.addresses.switch] },', "},"].join("\n"),
        line: 2,
        output: [
            "$ circuit validate",
            "  error  switch: 192.168.10.1 on interfaces.vlan_interface.mgmt is also on router interfaces.vlan_interface.mgmt",
            "",
            "1 error(s).",
        ].join("\n"),
        fixes: [
            {
                label: "Use home.addresses.switch, 192.168.10.2, its address in connection",
                right: true,
                why: "Each address is on one device again, and it is the address Circuit logs in to the switch at.",
            },
            {
                label: "Give the router 192.168.10.2 instead",
                right: false,
                why: "site.ts says 192.168.10.1 is the router: it is the switch’s gateway and where Circuit logs in to the router. Move the switch, not the router.",
            },
        ],
    },
    {
        title: "A cable described in your own words",
        file: "sites/home/switch.ts",
        wrong: [
            '"10g-1": {',
            '    description: "Router",',
            '    trunk_vlans: ["mgmt", "home", "guests"],',
            '    link: { device: "router", port: "25g-1" },',
            "},",
        ].join("\n"),
        fixed: [
            '"10g-1": {',
            '    description: "router sfp28-1",',
            '    trunk_vlans: ["mgmt", "home", "guests"],',
            '    link: { device: "router", port: "25g-1" },',
            "},",
        ].join("\n"),
        line: 2,
        output: [
            "$ circuit validate",
            '  warn   sites/home/switch.ts:23: switch: interfaces.ethernet.10g-1.description: "Router", which doesn\'t name the far end of its link as printed there: router sfp28-1.',
            "✔ 2 device(s), no errors.",
        ].join("\n"),
        fixes: [
            {
                label: "Describe it as router sfp28-1, the far end as the router prints it",
                right: true,
                why: "The warning goes away, and whoever traces that cable later reads where its other end is, in the router's own words.",
            },
            {
                label: "Leave it: a warning does not stop diff or apply",
                right: false,
                why: "True, a warning stops nothing. It is there for the next person who has to trace that cable, so let the description say where it goes.",
            },
        ],
    },
];

const current = ref(0);
const ran = ref<boolean[]>(mistakes.map(() => false));
const fixedOnes = ref<boolean[]>(mistakes.map(() => false));
const picked = ref<(number | undefined)[]>(mistakes.map(() => undefined));

const mistake = computed(() => mistakes[current.value]!);
const isFixed = computed(() => fixedOnes.value[current.value]);
const pick = computed(() => {
    const index = picked.value[current.value];
    return index === undefined ? undefined : mistake.value.fixes[index];
});
const fixedCount = computed(() => fixedOnes.value.filter(Boolean).length);

function run() {
    ran.value[current.value] = true;
}

function choose(index: number) {
    picked.value[current.value] = index;
    if (mistake.value.fixes[index]!.right) fixedOnes.value[current.value] = true;
}

function go(index: number) {
    current.value = index;
}

function startOver() {
    ran.value = mistakes.map(() => false);
    fixedOnes.value = mistakes.map(() => false);
    picked.value = mistakes.map(() => undefined);
    current.value = 0;
}
</script>

<template>
    <div class="fix-the-site">
        <div class="ac-row tabs" role="group" aria-label="Mistakes">
            <button
                v-for="(entry, index) in mistakes"
                :key="index"
                type="button"
                class="ac-button small"
                :aria-pressed="index === current"
                :aria-label="`Mistake ${index + 1}: ${entry.title}${fixedOnes[index] ? ', fixed' : ''}`"
                @click="go(index)"
            >
                {{ index + 1 }}{{ fixedOnes[index] ? " fixed" : "" }}
            </button>
        </div>

        <h4 class="title">Mistake {{ current + 1 }} of {{ mistakes.length }}: {{ mistake.title }}</h4>

        <CodeView :code="isFixed ? mistake.fixed : mistake.wrong" :title="mistake.file" :highlight="[mistake.line]" />

        <div v-if="!ran[current]" class="ac-row">
            <button type="button" class="ac-button primary" @click="run">Run circuit validate</button>
        </div>

        <template v-else>
            <CodeView v-if="mistake.editor && !isFixed" :code="mistake.editor" lang="text" title="Your editor, before you even run it" />
            <CodeView :code="isFixed ? CLEAN : mistake.output" lang="shell" title="Terminal" />

            <fieldset class="fixes">
                <legend>{{ isFixed ? "Fixed with:" : "How do you fix it?" }}</legend>
                <div class="options">
                    <button
                        v-for="(fix, index) in mistake.fixes"
                        :key="index"
                        type="button"
                        class="ac-button"
                        :aria-pressed="picked[current] === index"
                        :disabled="isFixed && !fix.right"
                        @click="choose(index)"
                    >
                        {{ fix.label }}
                    </button>
                </div>
            </fieldset>
        </template>

        <p
            v-if="pick"
            class="ac-say"
            :class="pick.right ? 'good' : 'bad'"
            :data-word="pick.right ? 'Fixed' : 'Not quite'"
            aria-live="polite"
        >
            {{ pick.why }}
        </p>
        <p v-else class="ac-say hint" aria-live="polite">
            {{
                ran[current]
                    ? "Read what Circuit says, then pick a fix."
                    : "Find what is wrong in the file, then run validate and read what it says."
            }}
        </p>

        <div class="ac-row next">
            <button v-if="isFixed && current < mistakes.length - 1" type="button" class="ac-button primary" @click="go(current + 1)">
                Next mistake
            </button>
            <span class="count">{{ fixedCount }} of {{ mistakes.length }} fixed</span>
            <button v-if="fixedCount === mistakes.length" type="button" class="ac-button small" @click="startOver">Start over</button>
        </div>
    </div>
</template>

<style scoped>
.tabs {
    margin-bottom: 12px;
}

.title {
    margin: 0 !important;
    font-size: 17px;
}

.fixes {
    min-width: 0;
    margin: 4px 0 0;
    padding: 0;
    border: 0;
}

legend {
    margin-bottom: 6px;
    padding: 0;
    color: var(--circuit-soft);
    font-size: 13px;
    font-weight: 600;
}

.options {
    display: grid;
    gap: 8px;
}

.options .ac-button {
    justify-content: flex-start;
    white-space: normal;
    text-align: left;
}

.hint {
    color: var(--circuit-soft);
}

.next {
    margin-top: 12px;
}

.count {
    color: var(--circuit-soft);
    font-size: 14px;
    font-weight: 600;
}
</style>
