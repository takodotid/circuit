<script setup lang="ts">
// Lesson: keeping the keys. The reader changes the router's services, its allowed sources, its users and one switch port, and sees who can log in from where, with the device file written beside it.

import { computed, ref } from "vue";

type Service = "ssh" | "telnet";
type Result = "in" | "prompt" | "refused" | "locked";

/** Someone trying to log in to the router. */
type Attempt = {
    id: string;
    who: string;
    source: string;
    service: Service;
    /** The user they log in as. Without one, they only guess passwords. */
    user?: string;
    /** What should happen. */
    should: "in" | "out";
};

const ALLOW_CHOICES = [
    { prefix: "192.168.10.0/24", label: "192.168.10.0/24, the management VLAN" },
    { prefix: "192.168.0.0/16", label: "192.168.0.0/16, every VLAN on the site" },
    { prefix: "0.0.0.0/0", label: "0.0.0.0/0, anywhere" },
];

const sshOn = ref(true);
const telnetOn = ref(true);
const allow = ref("192.168.0.0/16");
const monitorListed = ref(false);
const internListed = ref(true);
const wallPortVlan = ref<"guests" | "mgmt">("guests");

/** The address a visitor ends up with on the wall socket: one the guest network hands out, or one they type in for management. */
const visitorSource = computed(() => (wallPortVlan.value === "mgmt" ? "192.168.10.99" : "192.168.30.110"));

const attempts = computed<Attempt[]>(() => [
    { id: "you", who: "You, on the admin laptop, as operator", source: "192.168.10.20", service: "ssh", user: "operator", should: "in" },
    { id: "monitor", who: "The monitoring server, as monitor", source: "192.168.10.30", service: "ssh", user: "monitor", should: "in" },
    {
        id: "intern",
        who: "The intern who left last month, at the old desk in the server room, as intern",
        source: "192.168.10.40",
        service: "ssh",
        user: "intern",
        should: "out",
    },
    { id: "guest", who: "A guest phone guessing passwords", source: "192.168.30.57", service: "ssh", should: "out" },
    { id: "stranger", who: "A stranger on the internet", source: "192.0.2.66", service: "ssh", should: "out" },
    {
        id: "script",
        who: "An old script on the admin laptop, as operator",
        source: "192.168.10.20",
        service: "telnet",
        user: "operator",
        should: "out",
    },
    {
        id: "visitor",
        who: "A visitor who unplugs the guest access point and plugs in a laptop",
        source: visitorSource.value,
        service: "ssh",
        should: "out",
    },
]);

/** Whether an IPv4 address is inside a prefix. */
function within(address: string, prefix: string): boolean {
    const [network, length] = prefix.split("/");
    const toNumber = (text: string) => text.split(".").reduce((sum, part) => sum * 256 + Number(part), 0);
    const size = 2 ** (32 - Number(length));
    return Math.floor(toNumber(address) / size) === Math.floor(toNumber(network!) / size);
}

const users = computed(() => ["operator", ...(monitorListed.value ? ["monitor"] : []), ...(internListed.value ? ["intern"] : [])]);

/** What happens to one attempt with the settings as they are, and why. */
function outcome(attempt: Attempt): { result: Result; why: string } {
    const serviceOn = attempt.service === "ssh" ? sshOn.value : telnetOn.value;
    const name = attempt.service === "ssh" ? "SSH" : "Telnet";

    if (!serviceOn) {
        return attempt.id === "you"
            ? { result: "locked", why: "SSH is off, so nothing answers. That includes you, and Circuit, which logs in the same way." }
            : { result: "refused", why: `${name} is off, so nothing answers.` };
    }

    if (!within(attempt.source, allow.value))
        return { result: "refused", why: `${attempt.source} is not in ${allow.value}, so the router does not answer.` };

    if (!attempt.user)
        return {
            result: "prompt",
            why: `${attempt.source} is allowed, so it reaches the login prompt. Only the password stands in the way.`,
        };

    if (!users.value.includes(attempt.user))
        return { result: "refused", why: `There is no user called ${attempt.user}: a user not in the file is removed.` };

    const role = attempt.user === "monitor" ? " As a read-only user, it can look but not change anything." : "";
    const clear = attempt.service === "telnet" ? " Telnet is not encrypted: the password crossed the network as plain text." : "";
    return { result: "in", why: `Logged in as ${attempt.user}.${role}${clear}` };
}

const isRight = (attempt: Attempt) => {
    const result = outcome(attempt).result;
    return attempt.should === "in" ? result === "in" : result === "refused";
};

const rightCount = computed(() => attempts.value.filter(isRight).length);

const RESULT_WORDS: Record<Result, string> = { in: "Logged in", prompt: "Can try passwords", refused: "Turned away", locked: "Locked out" };

/** The part of router.ts these settings write. */
const code = computed(() => {
    const services = [...(sshOn.value ? ["ssh: {}"] : []), ...(telnetOn.value ? ["telnet: {}"] : [])];
    const lines = [
        'connection: { host: "192.168.10.1", user: "operator" },',
        "users: {",
        '    operator: { role: "admin", password: secret("ROUTER_PASSWORD") },',
        ...(monitorListed.value ? ['    monitor: { role: "read-only", password: secret("MONITOR_PASSWORD") },'] : []),
        ...(internListed.value ? ['    intern: { role: "admin", password: secret("INTERN_PASSWORD") },'] : []),
        "},",
        `management: { allow: ["${allow.value}"]${services.length ? ", " + services.join(", ") : ""} },`,
    ];
    return lines.join("\n");
});

const switchCode = computed(
    () => `"10g-4": { description: "Guest access point", access_vlan: "${wallPortVlan.value}", stp: { edge: true } },`
);

// Real output of `circuit validate` on the single-site template with this one change.
const VALIDATE_MGMT_PORT = [
    "$ npx circuit validate",
    "  error  switch: port 10g-4 gives management to whatever plugs in",
    "",
    "1 error(s).",
].join("\n");

const lockedOut = computed(() => !sshOn.value);
</script>

<template>
    <div class="login-gate">
        <div class="settings">
            <fieldset class="group">
                <legend>Ways in</legend>
                <div class="ac-row">
                    <button type="button" class="ac-button small" :aria-pressed="sshOn" @click="sshOn = !sshOn">
                        SSH {{ sshOn ? "on" : "off" }}
                    </button>
                    <button type="button" class="ac-button small" :aria-pressed="telnetOn" @click="telnetOn = !telnetOn">
                        Telnet {{ telnetOn ? "on" : "off" }}
                    </button>
                </div>
            </fieldset>

            <label class="ac-field group">
                <span>Allowed sources, management.allow</span>
                <select v-model="allow" class="ac-select">
                    <option v-for="choice in ALLOW_CHOICES" :key="choice.prefix" :value="choice.prefix">{{ choice.label }}</option>
                </select>
            </label>

            <fieldset class="group">
                <legend>Users in the file</legend>
                <div class="ac-row">
                    <button type="button" class="ac-button small" aria-pressed="true" disabled>
                        operator, admin, Circuit logs in as it
                    </button>
                    <button type="button" class="ac-button small" :aria-pressed="monitorListed" @click="monitorListed = !monitorListed">
                        monitor, read-only
                    </button>
                    <button type="button" class="ac-button small" :aria-pressed="internListed" @click="internListed = !internListed">
                        intern, admin
                    </button>
                </div>
            </fieldset>

            <label class="ac-field group">
                <span>On the switch, port 10g-4 (the guest access point) is in VLAN</span>
                <select v-model="wallPortVlan" class="ac-select">
                    <option value="guests">guests</option>
                    <option value="mgmt">mgmt</option>
                </select>
            </label>
        </div>

        <div class="frame">
            <table class="ac-table">
                <caption>
                    Who tries to log in to the router
                </caption>
                <thead>
                    <tr>
                        <th scope="col">Who, from where</th>
                        <th scope="col">What happens</th>
                        <th scope="col">Should</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="attempt in attempts" :key="attempt.id">
                        <td>
                            {{ attempt.who }}
                            <span class="detail ac-mono">{{ attempt.source }}, {{ attempt.service === "ssh" ? "SSH" : "Telnet" }}</span>
                        </td>
                        <td>
                            <strong>{{ RESULT_WORDS[outcome(attempt).result] }}</strong>
                            <span class="mark" :class="isRight(attempt) ? 'right' : 'wrong'">{{
                                isRight(attempt) ? "right" : "wrong"
                            }}</span>
                            <span class="detail">{{ outcome(attempt).why }}</span>
                        </td>
                        <td>{{ attempt.should === "in" ? "log in" : "be turned away" }}</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <p v-if="rightCount === attempts.length" class="ac-say good" data-word="Locked down" aria-live="polite">
            Every attempt ends the way it should. Only the management network can reach the router, over SSH, as a user the file lists.
        </p>
        <p v-else-if="lockedOut" class="ac-say warn" aria-live="polite">
            With SSH off, nobody can log in, not even Circuit. Applied for real, Circuit would fail to log in again afterwards, and the
            router would undo the change by itself. The next widget shows how.
        </p>
        <p v-else class="ac-say hint" aria-live="polite">
            {{ rightCount }} of {{ attempts.length }} attempts end the way they should. Change the settings above until all of them do.
        </p>

        <CodeView :code="code" title="router.ts" />
        <template v-if="wallPortVlan === 'mgmt'">
            <CodeView :code="switchCode" title="switch.ts" :highlight="[1]" />
            <CodeView :code="VALIDATE_MGMT_PORT" lang="shell" title="Terminal" />
        </template>
    </div>
</template>

<style scoped>
.settings {
    display: grid;
    gap: 14px;
}

.group {
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
}

legend {
    margin-bottom: 4px;
    padding: 0;
    color: var(--circuit-soft);
    font-size: 13px;
    font-weight: 600;
}

.group .ac-select {
    max-width: 100%;
}

.frame {
    margin-top: 14px;
    overflow-x: auto;
}

caption {
    padding-bottom: 4px;
    color: var(--circuit-soft);
    font-size: 13px;
    font-weight: 600;
    text-align: left;
}

.detail {
    display: block;
    margin-top: 2px;
    color: var(--circuit-soft);
    font-size: 13px;
    line-height: 1.45;
}

.mark {
    display: inline-block;
    margin-left: 6px;
    padding: 0 6px;
    color: #ffffff;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    line-height: 18px;
    text-transform: uppercase;
    vertical-align: 1px;
}

.mark.right {
    background: var(--circuit-added);
}

.mark.wrong {
    background: var(--circuit-removed);
}

.hint {
    color: var(--circuit-soft);
}
</style>
