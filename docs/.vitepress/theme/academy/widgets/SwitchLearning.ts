// Shared by the widgets of the switches, routers, DNS, ports and website lessons: the devices on the lesson's switch, a narrow-screen flag and pauses that stop with the page.

import { onBeforeUnmount, onMounted, ref } from "vue";

export type Host = {
    id: string;
    kind: "laptop" | "desktop" | "printer" | "camera" | "server";
    label: string;
    /** The hardware address, fixed in the device's network card. */
    mac: string;
    /** The switch port its cable is plugged into. */
    port: number;
};

export class Lan {
    /** The hardware address that means every device on the local network. */
    static readonly BROADCAST = "ff:ff:ff:ff:ff:ff";

    /** The five devices plugged into the switch in the switches lesson. */
    static readonly HOSTS: Host[] = [
        { id: "laptop", kind: "laptop", label: "Laptop", mac: "3a:91:5c:0e:72:1a", port: 1 },
        { id: "desktop", kind: "desktop", label: "Desktop", mac: "6e:04:b8:9d:23:2b", port: 2 },
        { id: "printer", kind: "printer", label: "Printer", mac: "02:7c:e1:46:a8:3c", port: 3 },
        { id: "camera", kind: "camera", label: "Camera", mac: "aa:18:f3:6b:05:4d", port: 4 },
        { id: "server", kind: "server", label: "Server", mac: "0e:c2:7d:31:9e:5e", port: 5 },
    ];

    /** The device on the switch with this id. */
    static host(id: string) {
        return Lan.HOSTS.find((host) => host.id === id)!;
    }
}

/** True while the page is narrower than `width`, so a drawing can lay itself out for a phone. Always false on the server. */
export function useNarrow(width = 640) {
    const narrow = ref(false);
    let query: MediaQueryList | undefined;

    const update = () => {
        narrow.value = query?.matches ?? false;
    };

    onMounted(() => {
        query = matchMedia(`(max-width: ${width}px)`);
        update();
        query.addEventListener("change", update);
    });

    onBeforeUnmount(() => query?.removeEventListener("change", update));

    return narrow;
}

/** A pause of some milliseconds that is cleared when the widget leaves the page. */
export function usePause() {
    const timers = new Set<ReturnType<typeof setTimeout>>();

    onBeforeUnmount(() => {
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
    });

    return (milliseconds: number) =>
        new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
                timers.delete(timer);
                resolve();
            }, milliseconds);
            timers.add(timer);
        });
}

export class Motion {
    /** Whether the reader asked for less motion. Only call it from a handler or after mounting. */
    static still() {
        return matchMedia("(prefers-reduced-motion: reduce)").matches;
    }
}
