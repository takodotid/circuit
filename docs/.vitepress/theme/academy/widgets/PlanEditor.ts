// The router file the PlanEditor widget edits, and the plan Circuit made for each set of edits.
// Each plan is the real output of `circuit diff router` for that file, run against a snapshot of the router before the edits.

export type Edits = {
    /** Give port 25g-1 a description. */
    describe: boolean;
    /** Take the intern's login out of the file. */
    removeIntern: boolean;
    /** Give the router a DNS server to ask. */
    dns: boolean;
    /** Someone turned on port 25g-5 by hand, so the router runs something the file does not hold. */
    drift: boolean;
};

/** The router's file with these edits, line by line, each line marked when an edit wrote it. */
export function routerFile(edits: Edits): { text: string; changed: number[] } {
    const lines: { text: string; changed?: boolean }[] = [
        { text: 'import { defineDevice, secret } from "@takodotid/circuit";' },
        { text: "" },
        { text: "export default defineDevice({" },
        { text: '    name: "router",' },
        { text: '    platform: "routeros",' },
        { text: '    model: "CCR2216-1G-12XS-2XQ",' },
        { text: '    connection: { host: "192.168.10.1", user: "operator" },' },
        { text: "    users: {" },
        { text: '        operator: { role: "admin", password: secret("ROUTER_PASSWORD") },' },
    ];

    if (!edits.removeIntern) lines.push({ text: '        intern: { role: "read-only", password: secret("INTERN_PASSWORD") },' });

    lines.push({ text: "    }," });

    if (edits.dns) lines.push({ text: '    system: { dns: { servers: ["203.0.113.53"] } },', changed: true });

    lines.push(
        { text: '    management: { allow: ["192.168.10.0/24"], ssh: {} },' },
        { text: "" },
        { text: "    ports: {" },
        { text: '        "1g-1": { description: "Internet provider", addresses: ["203.0.113.2/30"] },' }
    );

    lines.push(
        edits.describe
            ? { text: '        "25g-1": { description: "Office", addresses: ["192.168.10.1/24"] },', changed: true }
            : { text: '        "25g-1": { addresses: ["192.168.10.1/24"] },' }
    );

    lines.push({ text: "    }," }, { text: '    routing: { static: [{ prefix: "0.0.0.0/0", via: "203.0.113.1" }] },' }, { text: "});" });

    return {
        text: lines.map((line) => line.text).join("\n"),
        changed: lines.flatMap((line, index) => (line.changed ? [index + 1] : [])),
    };
}

/** The key of a set of edits in `plans`. */
export const planKey = (edits: Edits) =>
    [edits.describe, edits.removeIntern, edits.dns, edits.drift].map((on) => (on ? "1" : "0")).join("");

/** What `circuit diff router` printed for each set of edits. */
export const plans: Record<string, string> = {
    "0000": "router: matches\n",
    "0001": "router: 1 command(s) in 1 step(s)\n  /interface ethernet\n    ~ set [ find default-name=sfp28-5 ] disabled=yes comment=\n",
    "0010": "router: 1 command(s) in 1 step(s)\n  /ip dns\n    ~ set servers=203.0.113.53\n",
    "0011": "router: 2 command(s) in 2 step(s)\n  /interface ethernet\n    ~ set [ find default-name=sfp28-5 ] disabled=yes comment=\n  /ip dns\n    ~ set servers=203.0.113.53\n",
    "0100": "router: 1 command(s) in 1 step(s)\n  /user\n    - add group=read name=intern\n",
    "0101": "router: 2 command(s) in 2 step(s)\n  /interface ethernet\n    ~ set [ find default-name=sfp28-5 ] disabled=yes comment=\n  /user\n    - add group=read name=intern\n",
    "0110": "router: 2 command(s) in 2 step(s)\n  /ip dns\n    ~ set servers=203.0.113.53\n  /user\n    - add group=read name=intern\n",
    "0111": "router: 3 command(s) in 3 step(s)\n  /interface ethernet\n    ~ set [ find default-name=sfp28-5 ] disabled=yes comment=\n  /ip dns\n    ~ set servers=203.0.113.53\n  /user\n    - add group=read name=intern\n",
    "1000": 'router: 2 command(s) in 2 step(s)\n  /interface ethernet\n    ~ set [ find default-name=sfp28-1 ] comment=Office\n  /ip address\n    ~ {"address":"192.168.10.1/24"} comment=Office\n',
    "1001": 'router: 3 command(s) in 2 step(s)\n  /interface ethernet\n    ~ set [ find default-name=sfp28-1 ] comment=Office\n    ~ set [ find default-name=sfp28-5 ] disabled=yes comment=\n  /ip address\n    ~ {"address":"192.168.10.1/24"} comment=Office\n',
    "1010": 'router: 3 command(s) in 3 step(s)\n  /interface ethernet\n    ~ set [ find default-name=sfp28-1 ] comment=Office\n  /ip address\n    ~ {"address":"192.168.10.1/24"} comment=Office\n  /ip dns\n    ~ set servers=203.0.113.53\n',
    "1011": 'router: 4 command(s) in 3 step(s)\n  /interface ethernet\n    ~ set [ find default-name=sfp28-1 ] comment=Office\n    ~ set [ find default-name=sfp28-5 ] disabled=yes comment=\n  /ip address\n    ~ {"address":"192.168.10.1/24"} comment=Office\n  /ip dns\n    ~ set servers=203.0.113.53\n',
    "1100": 'router: 3 command(s) in 3 step(s)\n  /interface ethernet\n    ~ set [ find default-name=sfp28-1 ] comment=Office\n  /ip address\n    ~ {"address":"192.168.10.1/24"} comment=Office\n  /user\n    - add group=read name=intern\n',
    "1101": 'router: 4 command(s) in 3 step(s)\n  /interface ethernet\n    ~ set [ find default-name=sfp28-1 ] comment=Office\n    ~ set [ find default-name=sfp28-5 ] disabled=yes comment=\n  /ip address\n    ~ {"address":"192.168.10.1/24"} comment=Office\n  /user\n    - add group=read name=intern\n',
    "1110": 'router: 4 command(s) in 4 step(s)\n  /interface ethernet\n    ~ set [ find default-name=sfp28-1 ] comment=Office\n  /ip address\n    ~ {"address":"192.168.10.1/24"} comment=Office\n  /ip dns\n    ~ set servers=203.0.113.53\n  /user\n    - add group=read name=intern\n',
    "1111": 'router: 5 command(s) in 4 step(s)\n  /interface ethernet\n    ~ set [ find default-name=sfp28-1 ] comment=Office\n    ~ set [ find default-name=sfp28-5 ] disabled=yes comment=\n  /ip address\n    ~ {"address":"192.168.10.1/24"} comment=Office\n  /ip dns\n    ~ set servers=203.0.113.53\n  /user\n    - add group=read name=intern\n',
};
