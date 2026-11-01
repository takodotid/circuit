<!-- A device's front panel: one square per port of its model, by speed, filled by how the port is used. A square scrolls to the port's row. -->
<script setup lang="ts">
import { computed } from "vue";
import type { Device, Port } from "../../../../model";

const props = defineProps<{ device: Device; ports: string[] }>();

type Use = "shut" | "lag" | "access" | "trunk" | "routed" | "plain";

const USES: Record<Use, string> = {
    shut: "shut down",
    lag: "in a LAG",
    access: "access",
    trunk: "trunk",
    routed: "routed",
    plain: "up, nothing on it",
};

const useOf = (port: Port | undefined): Use => {
    if (!port) return "shut";
    if (port.in_lag) return "lag";
    if (port.access_vlan) return "access";
    if (port.trunk_vlans) return "trunk";
    if (port.addresses) return "routed";
    return "plain";
};

const bySpeed = computed(() => {
    const groups = new Map<string, { name: string; use: Use; linked: boolean; label: string }[]>();

    for (const name of props.ports) {
        const port = props.device.interfaces?.ethernet?.[name];
        const use = useOf(port);
        const far = port?.link;
        const label = [name, USES[use], port?.description, far ? `to ${far.device} ${far.port}` : ""].filter(Boolean).join(", ");
        const speed = name.split("-")[0] ?? name;
        groups.set(speed, [...(groups.get(speed) ?? []), { name, use, linked: Boolean(far), label }]);
    }

    return [...groups];
});

function show(name: string): void {
    const row = document.getElementById(`port-${name}`);
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
    row?.classList.add("flash");
    setTimeout(() => row?.classList.remove("flash"), 1600);
}
</script>

<template>
    <div v-if="ports.length">
        <div class="faceplate" role="group" :aria-label="`${device.name}'s ports`">
            <div v-for="[speed, squares] in bySpeed" :key="speed" class="speed">
                <span class="speed-name">{{ speed }}</span>
                <div class="ports">
                    <button
                        v-for="square in squares"
                        :key="square.name"
                        :class="['port', square.use, { linked: square.linked }]"
                        :title="square.label"
                        :aria-label="square.label"
                        @click="show(square.name)"
                    >
                        {{ square.name.split("-")[1] ?? square.name }}
                    </button>
                </div>
            </div>
        </div>
        <ul class="faceplate-legend">
            <li v-for="(text, use) in USES" :key="use"><span :class="['port', use]"></span>{{ text }}</li>
            <li><span class="port plain linked"></span>linked to another device</li>
        </ul>
    </div>
</template>
