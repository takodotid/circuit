import { Catalog, type ModelName, type PlatformName, type PortName } from "../platforms/catalog";

/** One end of a cable: the device, and its platform and model, which name its ports. */
export type CableEnd<P extends PlatformName, M extends ModelName<P>> = {
    device: string;
    platform: P;
    model: M;
};

/** The far end of a port, for its description: the device, the port by Circuit's name, and by the name printed on the device. */
export type FarEnd = { device: string; port: string; label: string };

/** What every cable of one entry shares. */
type Shared = {
    /** What is between the two ends, such as a carrier's local loop. Both ends get it on their `link`. */
    through?: string;
    /** A port's description from its far end. The far device and the far port's label when absent, such as `firewall-1 port6`. */
    describe?: (far: FarEnd) => string;
};

/** A port a cable builds: what it is, the LAG it is in, and the other end. */
type CablePort<L extends string> = {
    description: string;
    link: { device: string; port: string; through?: string };
    lag?: L;
};

/** Ports for both ends of the cables between two of our devices, each cable written once. */
export class Cables {
    /**
     * One cable, both ends. Spread each end into its device's `ports`:
     *
     * ```ts
     * const uplink = Cables.link({ a: { device: "router-1", platform: "routeros", model: "CCR2216-1G-12XS-2XQ", port: "25g-1" }, b: { ... } });
     * // router-1: ports: { ...uplink.a }
     * ```
     */
    static link<
        const PA extends PlatformName,
        const MA extends ModelName<PA>,
        const NA extends PortName<PA, MA>,
        const PB extends PlatformName,
        const MB extends ModelName<PB>,
        const NB extends PortName<PB, MB>,
    >(spec: Shared & { a: CableEnd<PA, MA> & { port: NA }; b: CableEnd<PB, MB> & { port: NB } }) {
        return {
            a: { [spec.a.port]: Cables.end(spec, spec.b, spec.b.port) } as Record<NA, CablePort<never>>,
            b: { [spec.b.port]: Cables.end(spec, spec.a, spec.a.port) } as Record<NB, CablePort<never>>,
        };
    }

    /**
     * The cables of a LAG, both ends, from one list read from end A: `{ "25g-1": "10g-2" }` is a cable from A's 25g-1 to B's 10g-2. Each port is a member of its end's LAG. Spread each end into its device's `ports`; the LAG itself stays on each device.
     */
    static lag<
        const PA extends PlatformName,
        const MA extends ModelName<PA>,
        const LA extends string,
        const PB extends PlatformName,
        const MB extends ModelName<PB>,
        const LB extends string,
        const C extends Partial<Record<PortName<PA, MA>, PortName<PB, MB>>>,
    >(spec: Shared & { a: CableEnd<PA, MA> & { lag: LA }; b: CableEnd<PB, MB> & { lag: LB }; cables: C }) {
        const pairs = Object.entries(spec.cables) as [string, string][];

        const taken = new Map<string, string>();
        for (const [near, far] of pairs) {
            const other = taken.get(far);
            if (other) throw new Error(`Cables.lag: ${spec.b.device} ${far} is cabled to both ${other} and ${near} on ${spec.a.device}`);
            taken.set(far, near);
        }

        const a = Object.fromEntries(pairs.map(([near, far]) => [near, { ...Cables.end(spec, spec.b, far), lag: spec.a.lag }]));
        const b = Object.fromEntries(pairs.map(([near, far]) => [far, { ...Cables.end(spec, spec.a, near), lag: spec.b.lag }]));

        return {
            a: a as Record<keyof C & string, CablePort<LA>>,
            b: b as Record<NonNullable<C[keyof C]> & string, CablePort<LB>>,
        };
    }

    /** A port facing `port` on the far device. */
    private static end(shared: Shared, far: { device: string; platform: string; model: string }, port: string): CablePort<never> {
        const farEnd = { device: far.device, port, label: Catalog.spell(far.platform, far.model, port) };

        return {
            description: shared.describe ? shared.describe(farEnd) : `${farEnd.device} ${farEnd.label}`,
            link: { device: far.device, port, ...(shared.through ? { through: shared.through } : {}) },
        };
    }
}
