// BGP inside a network: how many iBGP sessions a network of routers needs, with a full mesh or with route reflectors.

export class IbgpSessions {
    /** Every router has a session with every other: n(n-1)/2. */
    static fullMesh(routers: number): number {
        return (routers * (routers - 1)) / 2;
    }

    /** Every client has a session with each reflector, and the reflectors have a full mesh among themselves. The reflectors are counted among the routers. */
    static withReflectors(routers: number, reflectors: number): number {
        const clients = routers - reflectors;
        return clients * reflectors + IbgpSessions.fullMesh(reflectors);
    }

    /** The sessions themselves, as pairs of router numbers from 1. With reflectors, routers 1 to `reflectors` are the reflectors. */
    static pairs(routers: number, reflectors: number): [number, number][] {
        const pairs: [number, number][] = [];

        for (let a = 1; a <= routers; a++) {
            for (let b = a + 1; b <= routers; b++) {
                // With reflectors, two clients have no session of their own.
                const bothClients = a > reflectors && b > reflectors;
                if (reflectors > 0 && bothClients) continue;
                pairs.push([a, b]);
            }
        }

        return pairs;
    }
}
