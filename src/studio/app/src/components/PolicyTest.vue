<!-- Test a route policy: a route a person describes, through one of a device's route policies, rule by rule and into each policy a rule calls. The route is in the page's address, such as `#tools/policy/device=edge-01&policy=transit-import&prefix=198.51.100.0%2F24`, to bookmark or send. -->
<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import type { StudioData } from "../../../types";
import { type Attributes, Evaluate, type Route } from "../lib/evaluate";
import { Format } from "../lib/format";
import { Net } from "../lib/net";
import { goParams, placeParams } from "../lib/store";
import DataTable from "./DataTable.vue";

const props = defineProps<{ data: StudioData }>();

const PLACE = "tools/policy";
const FIELDS = ["device", "policy", "prefix", "as_path", "rpki", "communities", "large_communities", "registry_sets"] as const;

const asked = computed(() => placeParams(PLACE));

const withPolicies = computed(() => props.data.devices.filter((device) => Object.keys(device.routing?.policies ?? {}).length));
const form = reactive(Object.fromEntries(FIELDS.map((field) => [field, ""])) as Record<(typeof FIELDS)[number], string>);
const ticked = reactive<Record<string, boolean>>({});

const device = computed(() => props.data.devices.find((candidate) => candidate.name === form.device));
const policies = computed(() => (device.value ? Evaluate.policiesOf(props.data, device.value) : []));

/** The device's prefix sets fetched from a registry: Studio doesn't fetch them, so the person ticks the ones the route is in. */
const registrySets = computed(() =>
    Object.entries(device.value?.routing?.prefix_sets ?? {}).flatMap(([name, set]) =>
        set && "source" in set ? [{ name, from: `${set.source.registry} ${set.source.query}, ${set.source.family}` }] : []
    )
);

// The form shows what the address asks, so a bookmark or the Back button fills it in.
watch(
    asked,
    (params) => {
        for (const field of FIELDS) form[field] = params.get(field) ?? "";
        if (!form.device) form.device = withPolicies.value[0]?.name ?? props.data.devices[0]?.name ?? "";
        if (!form.policy) form.policy = policies.value[0]?.policy ?? "";
        const sets = (params.get("registry_sets") ?? "").split(",");
        for (const key of Object.keys(ticked)) delete ticked[key];
        for (const name of sets.filter(Boolean)) ticked[name] = true;
    },
    { immediate: true }
);

// Another device has other policies.
watch(
    () => form.device,
    () => {
        if (!policies.value.some((entry) => entry.policy === form.policy)) form.policy = policies.value[0]?.policy ?? "";
    }
);

function test(): void {
    form.registry_sets = registrySets.value
        .filter((set) => ticked[set.name])
        .map((set) => set.name)
        .join(",");
    const params = new URLSearchParams(FIELDS.filter((field) => form[field].trim()).map((field) => [field, form[field].trim()]));
    goParams(PLACE, params);
}

/** Words in a list written with spaces or commas between them. */
const words = (text: string | null) => (text ?? "").split(/[\s,]+/).filter(Boolean);

/** The route the address describes, or what is wrong with it. */
const route = computed<{ route?: Route; problems: string[] }>(() => {
    const params = asked.value;
    if (!params.get("device")) return { problems: [] };

    const problems: string[] = [];
    const prefix = params.get("prefix") ?? "";
    if (!prefix.includes("/") || !Net.parseRange(prefix))
        problems.push("The prefix is an address with its length, such as 198.51.100.0/24.");

    const asPath = params.get("as_path") ? words(params.get("as_path")).map(Number) : undefined;
    if (asPath?.some((asn) => !Number.isInteger(asn) || asn < 0))
        problems.push("The AS path is AS numbers with spaces between them, such as 6939 13335.");

    const communities = words(params.get("communities"));
    if (communities.some((community) => !/^\d+:\d+$/.test(community))) problems.push("A community is asn:value, such as 64500:100.");
    const large = words(params.get("large_communities"));
    if (large.some((community) => !/^\d+:\d+:\d+$/.test(community)))
        problems.push("A large community is asn:function:parameter, such as 64500:1:6939.");

    const rpki = params.get("rpki");
    const found: Route = {
        prefix,
        ...(asPath ? { asPath } : {}),
        ...(rpki === "valid" || rpki === "invalid" || rpki === "not-found" ? { rpki } : {}),
        communities,
        largeCommunities: large,
        inRegistrySets: words(params.get("registry_sets")),
    };
    return problems.length ? { problems } : { route: found, problems };
});

const tested = computed(() => {
    const own = props.data.devices.find((candidate) => candidate.name === asked.value.get("device"));
    const policy = asked.value.get("policy") ?? "";
    if (!own || !route.value.route || !own.routing?.policies?.[policy]) return undefined;
    return { device: own, policy, ...Evaluate.policy(own, policy, route.value.route) };
});

/** What the route carries once the policy accepts it, as the policy left it. */
function carried(attributes: Attributes): string[] {
    return [
        attributes.localPref !== undefined ? `local_pref ${attributes.localPref}` : "",
        attributes.med !== undefined ? `med ${attributes.med}` : "",
        attributes.prepend ? `our AS prepended ${attributes.prepend} ${attributes.prepend === 1 ? "time" : "times"}` : "",
        `communities: ${attributes.communities.join(", ") || "none"}`,
        `large communities: ${attributes.largeCommunities.join(", ") || "none"}`,
        attributes.nextHop ? `next_hop ${attributes.nextHop}` : "",
        attributes.preferredSource ? `preferred_source ${attributes.preferredSource}` : "",
        attributes.blackhole ? "blackhole: traffic to it is dropped here" : "",
    ].filter(Boolean);
}
</script>

<template>
    <p class="muted">
        Describe a route, and Studio walks the policy rule by rule, into each policy a rule calls, and shows what matched, what changed and
        the decision. A route no rule accepts is rejected. A prefix set holds a route whose prefix is one of the set's prefixes, or inside
        one.
    </p>
    <form class="tool-form" @submit.prevent="test">
        <label class="field"
            >Device
            <select v-model="form.device">
                <option v-for="one in data.devices" :key="one.name" :value="one.name">{{ one.name }}</option>
            </select>
        </label>
        <label class="field"
            >Policy
            <select v-model="form.policy">
                <option v-for="entry in policies" :key="entry.policy" :value="entry.policy">
                    {{ entry.policy }}{{ entry.users.length ? `: ${entry.users.join(", ")}` : ", used by no session" }}
                </option>
            </select>
        </label>
        <label class="field">Prefix <input v-model="form.prefix" placeholder="198.51.100.0/24" /></label>
        <label class="field">AS path <input v-model="form.as_path" placeholder="6939 64501" /><small>each AS, prepends too</small></label>
        <label class="field"
            >RPKI
            <select v-model="form.rpki">
                <option value="">not given</option>
                <option value="valid">valid</option>
                <option value="invalid">invalid</option>
                <option value="not-found">not-found</option>
            </select>
        </label>
        <label class="field">Communities <input v-model="form.communities" placeholder="64500:100 64500:200" /></label>
        <label class="field">Large communities <input v-model="form.large_communities" placeholder="64500:1:6939" /></label>
        <fieldset v-if="registrySets.length" class="field">
            <legend>In these sets from a registry</legend>
            <span class="flags">
                <label v-for="set in registrySets" :key="set.name" class="flag" :title="set.from"
                    ><input v-model="ticked[set.name]" type="checkbox" /> {{ set.name }}</label
                >
            </span>
        </fieldset>
        <button class="primary" type="submit">Test</button>
    </form>
    <p v-if="device && !policies.length" class="muted">{{ device.name }} has no route policies.</p>

    <ul v-if="route.problems.length" class="findings">
        <li v-for="problem in route.problems" :key="problem"><span class="badge error">fix</span>{{ problem }}</li>
    </ul>

    <template v-if="tested">
        <p v-if="tested.decision" :class="['verdict', tested.decision]">
            {{ tested.decision === "accept" ? "Accepted" : "Rejected" }}, by {{ tested.by }}.
        </p>
        <p v-else class="verdict unknown">Stopped at {{ tested.by }}: it needs {{ tested.needs.join(", and ") }}. Fill that in to go on.</p>
        <template v-if="tested.decision === 'accept'">
            <h3>The route as the policy leaves it</h3>
            <ul class="findings">
                <li v-for="line in carried(tested.attributes)" :key="line">{{ line }}</li>
            </ul>
        </template>
        <DataTable
            v-if="tested.steps.length"
            :head="['Policy', 'Rule', 'Description', 'If', 'Set', 'Then', 'Matches', 'Changed']"
            :rows="
                tested.steps.map((step) => ({
                    muted: step.check?.answer === 'no',
                    cells: [
                        `${'› '.repeat(step.depth)}${step.policy}`,
                        step.rule,
                        'description' in step.written ? step.written.description : undefined,
                        'call' in step.written && step.written.call
                            ? `call ${step.written.call}`
                            : 'if' in step.written && step.written.if
                              ? Format.compact(step.written.if)
                              : 'every route',
                        'set' in step.written ? Format.compact(step.written.set) : undefined,
                        'then' in step.written ? step.written.then : undefined,
                        step.note ??
                            (step.check?.answer === 'yes'
                                ? 'matches'
                                : step.check?.answer === 'no'
                                  ? `no: ${step.check.why.join('; ')}`
                                  : `needs ${step.check?.why.join(', ')}`),
                        step.changed.join('; '),
                    ],
                }))
            "
            :csv="`${tested.device.name}-${tested.policy}-test`"
        />
    </template>
</template>
