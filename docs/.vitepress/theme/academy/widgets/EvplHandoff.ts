// The Circuit excerpt the widget EvplHandoff writes: an office router's port toward a provider, carrying one EPL or several EVPLs.

export type Mode = "epl" | "evpl";

export type Service = {
    id: "branch" | "dc";
    /** Where the circuit goes. */
    place: string;
    /** The VLAN number agreed with the provider for this circuit. */
    vlan: number;
    /** The VLAN's and the interface's name in the device file. */
    name: string;
    /** The office's address on the circuit, a /30 shared with the far end. */
    address: string;
};

export const SERVICES: readonly Service[] = [
    { id: "branch", place: "the branch office", vlan: 2010, name: "to-branch", address: "10.255.0.1/30" },
    { id: "dc", place: "the data centre", vlan: 2020, name: "to-dc", address: "10.255.0.5/30" },
];

/** The port the provider's circuit is handed over on. */
export const PORT = "25g-1";

/** The part of the office router's device file that the circuits change. */
export function handoffCode(mode: Mode, bought: readonly Service["id"][]): string {
    if (mode === "epl") {
        return [
            "ports: {",
            `    "${PORT}": { description: "EPL to the branch office", addresses: ["${SERVICES[0]!.address}"] },`,
            "},",
        ].join("\n");
    }

    const services = SERVICES.filter((service) => bought.includes(service.id));

    if (services.length === 0) return "// Buy at least one EVPL, and the port has something to carry.";

    const names = services.map((service) => `"${service.name}"`).join(", ");

    return [
        "vlans: {",
        ...services.map((service) => `    "${service.name}": { id: ${service.vlan}, description: "EVPL to ${service.place}" },`),
        "},",
        "",
        "ports: {",
        `    "${PORT}": { description: "Provider hand-off", trunk_vlans: [${names}] },`,
        "},",
        "",
        "interfaces: {",
        ...services.map(
            (service) => `    "${service.name}": { type: "vlan", vlan: "${service.name}", addresses: ["${service.address}"] },`
        ),
        "},",
    ].join("\n");
}
