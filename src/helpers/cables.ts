/** The far end of a port, for a description of your own: the device and its port by Circuit's name. */
export type FarEnd = { device: string; port: string };

/** What every cable of one entry shares. */
type Shared = {
    /** What is between the two ends, such as a carrier's local loop. Both ends get it on their `link`. */
    through?: string;
    /** A port's description from its far end. When absent, Circuit writes the far device and the far port as printed on it, such as `firewall-1 port6`, from the far device's own file. */
    describe?: (far: FarEnd) => string;
};

/** A port a cable builds: the other end, the LAG it is in, and a description when `describe` gives one. */
type CablePort<L extends string> = {
    link: { device: string; port: string; through?: string };
    lag?: L;
    description?: string;
};

/** Ports for both ends of the cables between two of our devices, each cable written once. */
export class Cables {
    /**
     * One cable, both ends. Spread each end into its device's `ports`:
     *
     * ```ts
     * const uplink = Cables.link({ a: { device: "router-1", port: "25g-1" }, b: { device: "switch-1", port: "10g-48" } });
     * // router-1: ports: { ...uplink.a }
     * ```
     */
    static link<const NA extends string, const NB extends string>(
        spec: Shared & { a: { device: string; port: NA }; b: { device: string; port: NB } }
    ) {
        return {
            a: { [spec.a.port]: Cables.end(spec, spec.b.device, spec.b.port) } as Record<NA, CablePort<never>>,
            b: { [spec.b.port]: Cables.end(spec, spec.a.device, spec.a.port) } as Record<NB, CablePort<never>>,
        };
    }

    /**
     * The cables of a LAG, both ends, from one list read from end A: `{ "25g-1": "10g-2" }` is a cable from A's 25g-1 to B's 10g-2. Each port is a member of its end's LAG. Spread each end into its device's `ports`; the LAG itself stays on each device.
     */
    static lag<const LA extends string, const LB extends string, const C extends Readonly<Record<string, string>>>(
        spec: Shared & { a: { device: string; lag: LA }; b: { device: string; lag: LB }; cables: C }
    ) {
        const pairs = Object.entries(spec.cables);

        const taken = new Map<string, string>();
        for (const [near, far] of pairs) {
            const other = taken.get(far);
            if (other) throw new Error(`Cables.lag: ${spec.b.device} ${far} is cabled to both ${other} and ${near} on ${spec.a.device}`);
            taken.set(far, near);
        }

        const a = Object.fromEntries(pairs.map(([near, far]) => [near, { ...Cables.end(spec, spec.b.device, far), lag: spec.a.lag }]));
        const b = Object.fromEntries(pairs.map(([near, far]) => [far, { ...Cables.end(spec, spec.a.device, near), lag: spec.b.lag }]));

        return {
            a: a as Record<keyof C & string, CablePort<LA>>,
            b: b as Record<C[keyof C], CablePort<LB>>,
        };
    }

    /** A port facing `port` on the far device. */
    private static end(shared: Shared, device: string, port: string): CablePort<never> {
        return {
            link: { device, port, ...(shared.through ? { through: shared.through } : {}) },
            ...(shared.describe ? { description: shared.describe({ device, port }) } : {}),
        };
    }
}
