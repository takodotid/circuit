// Circuit Academy: the levels and lessons, in the order they are taught. The sidebar, the Academy's own page and the home page read them from here.

import type { DefaultTheme } from "vitepress";

export type Lesson = {
    /** The page's file name in the level's directory, without `.md`. */
    slug: string;
    title: string;
    /** One sentence on what the reader can do after it, shown on the Academy's page. */
    outcome: string;
};

export type Level = {
    /** The level's directory under `docs/academy/`. */
    slug: string;
    name: string;
    title: string;
    /** Who the level is for, in one sentence. */
    audience: string;
    illustration: string;
    lessons: Lesson[];
};

export class Academy {
    static readonly LEVELS: Level[] = [
        {
            slug: "beginner",
            name: "Beginner",
            title: "How networks talk",
            audience: "For anyone who has never studied networking. No words you have not met before.",
            illustration: "/illustrations/academy/level-1.webp",
            lessons: [
                {
                    slug: "what-is-a-network",
                    title: "What is a network?",
                    outcome: "Say what a network is, and what the internet is made of.",
                },
                {
                    slug: "cables",
                    title: "Cables, light and radio",
                    outcome: "Tell a LAN cable from a fibre and an optic module, and say how far and how fast each one goes.",
                },
                {
                    slug: "packets",
                    title: "Messages in pieces",
                    outcome: "Explain why data travels in small packets, and how they are put back together.",
                },
                {
                    slug: "addresses",
                    title: "Addresses",
                    outcome: "Tell a device's hardware address from its IP address, and say what each is for.",
                },
                { slug: "binary", title: "Counting like a computer", outcome: "Read and write the numbers 0 to 255 in bits." },
                {
                    slug: "ip-addresses",
                    title: "Reading an IP address",
                    outcome: "Split an address into its network and host parts, and read a prefix such as /24.",
                },
                { slug: "switches", title: "Switches", outcome: "Describe how a switch learns where each device is and delivers a frame." },
                {
                    slug: "routers",
                    title: "Routers and the gateway",
                    outcome: "Follow a packet from one network to another through a gateway.",
                },
                {
                    slug: "dns",
                    title: "Names and numbers: DNS",
                    outcome: "Follow a name like circuit.tako.id to the address it stands for.",
                },
                {
                    slug: "ports",
                    title: "Ports and protocols",
                    outcome: "Say how one device runs many services, and when TCP or UDP is used.",
                },
                {
                    slug: "opening-a-website",
                    title: "Opening a website",
                    outcome: "Walk through every step from typing an address to seeing the page.",
                },
            ],
        },
        {
            slug: "elementary",
            name: "Elementary",
            title: "Build a small network",
            audience: "For readers who finished Beginner. You build a home or office network, and write it down in Circuit.",
            illustration: "/illustrations/academy/level-2.webp",
            lessons: [
                { slug: "layers", title: "Layers", outcome: "Name the layers a message is wrapped in, and what each one adds." },
                {
                    slug: "writing-it-down",
                    title: "Writing a network down",
                    outcome: "Read a Circuit device file and the plan Circuit makes from it.",
                },
                { slug: "vlans", title: "VLANs", outcome: "Split one switch into separate networks, and write the VLANs in Circuit." },
                { slug: "trunks", title: "Trunks", outcome: "Carry several VLANs over one cable between two devices." },
                {
                    slug: "dhcp",
                    title: "Handing out addresses: DHCP",
                    outcome: "Give every device on a VLAN an address and a gateway automatically.",
                },
                {
                    slug: "nat",
                    title: "Sharing one address: NAT",
                    outcome: "Explain how a whole home reaches the internet through one public address.",
                },
                {
                    slug: "firewall",
                    title: "Firewalls",
                    outcome: "Write rules that decide which traffic may pass, and read them in order.",
                },
                {
                    slug: "management",
                    title: "Keeping the keys",
                    outcome: "Lock down who may log in to a device, and keep its passwords out of the files.",
                },
                {
                    slug: "project-single-site",
                    title: "Project: a single site",
                    outcome: "Write, check and apply a router and a switch for a small site.",
                },
            ],
        },
        {
            slug: "intermediate",
            name: "Intermediate",
            title: "Routing and the internet",
            audience: "For readers who can build a site. You learn how networks reach each other, up to running your own edge router.",
            illustration: "/illustrations/academy/level-3.webp",
            lessons: [
                {
                    slug: "routing-tables",
                    title: "Routing tables",
                    outcome: "Pick the route a router uses for an address, by the longest match.",
                },
                { slug: "ipv6", title: "IPv6", outcome: "Read, shorten and plan IPv6 addresses." },
                {
                    slug: "ospf",
                    title: "Routers that talk: OSPF",
                    outcome: "Explain how routers find the shortest path, and around a broken link.",
                },
                {
                    slug: "autonomous-systems",
                    title: "Networks of networks",
                    outcome: "Tell transit from peering, and say what an AS number and an exchange are.",
                },
                { slug: "bgp", title: "BGP", outcome: "Follow a route as it is announced from one AS to the next." },
                {
                    slug: "best-path",
                    title: "Choosing the best route",
                    outcome: "Predict which of several routes BGP picks, and change its choice.",
                },
                {
                    slug: "route-policy",
                    title: "Route policies",
                    outcome: "Accept only the routes you mean to, and announce only your own.",
                },
                {
                    slug: "redundancy",
                    title: "Staying up",
                    outcome: "Join links into a LAG, and keep a loop of switches from melting down.",
                },
                {
                    slug: "project-edge-router",
                    title: "Project: an edge router",
                    outcome: "Run your own AS with a transit and an exchange, written in Circuit.",
                },
            ],
        },
        {
            slug: "professional",
            name: "Professional",
            title: "Running a provider network",
            audience:
                "For readers who can run an edge router. You learn what providers sell, the hardware, routing at scale, the security of routing, and how a network is run day to day.",
            illustration: "/illustrations/academy/level-4.webp",
            lessons: [
                {
                    slug: "last-mile",
                    title: "Reaching the customer",
                    outcome:
                        "Say how a customer is connected, over fibre, copper, radio or satellite, and what each does to speed and delay.",
                },
                {
                    slug: "internet-products",
                    title: "What an ISP sells",
                    outcome: "Tell broadband from DIA, and DIA from IP transit and IX transit, and read how each is billed.",
                },
                {
                    slug: "private-circuits",
                    title: "Carrying your own traffic",
                    outcome: "Choose between Metro-E, L2 transport, IP VPN, IPLC, IEPL, dark fibre and a wavelength for a need.",
                },
                {
                    slug: "who-is-who",
                    title: "Who runs the internet",
                    outcome: "Name the kinds of networks a packet crosses, and where addresses and AS numbers come from.",
                },
                {
                    slug: "device-roles",
                    title: "Roles in a network",
                    outcome: "Lay a network out by role, from core to access, and name devices so the name says the role.",
                },
                {
                    slug: "choosing-hardware",
                    title: "Choosing a device",
                    outcome: "Pick a device and the optics for a role, from what it must forward and how many routes it must hold.",
                },
                {
                    slug: "ibgp-at-scale",
                    title: "BGP inside a network",
                    outcome: "Run iBGP between loopbacks with route reflectors, and keep it fast with ECMP and BFD.",
                },
                {
                    slug: "vrfs-and-overlays",
                    title: "Separate networks on one",
                    outcome: "Keep customers apart with VRFs, and say what MPLS and VXLAN with EVPN solve.",
                },
                {
                    slug: "routing-security",
                    title: "Hijacks and leaks",
                    outcome: "Tell a hijack from a leak, and stop both with RPKI, IRR filters and MANRS.",
                },
                {
                    slug: "ddos-and-spoofing",
                    title: "Attacks on the network",
                    outcome: "Stop spoofed traffic, shed a flood with blackholing, and protect the router itself.",
                },
                {
                    slug: "monitoring",
                    title: "Watching the network",
                    outcome: "Graph traffic, see who sends what, and alert on what matters.",
                },
                {
                    slug: "operations",
                    title: "Running it day to day",
                    outcome: "Change the network through review, handle an incident, and keep the plant written down.",
                },
                {
                    slug: "project-colocation",
                    title: "Project: a colocation",
                    outcome: "Host tenants with their own VLANs, addresses and ports, written in Circuit.",
                },
                {
                    slug: "project-internet-exchange",
                    title: "Project: an internet exchange",
                    outcome: "Run an exchange's peering LAN and route servers, written in Circuit.",
                },
            ],
        },
    ];

    /** A lesson's address on the site. */
    static link(level: Level, lesson: Lesson) {
        return `/academy/${level.slug}/${lesson.slug}`;
    }

    /** Every lesson in teaching order, each with its level and address. */
    static readonly LESSONS = Academy.LEVELS.flatMap((level) =>
        level.lessons.map((lesson, index) => ({ ...lesson, level, number: index + 1, link: Academy.link(level, lesson) }))
    );

    /** The Academy's own sidebar, kept apart from the documentation's. */
    static readonly SIDEBAR: DefaultTheme.SidebarItem[] = [
        {
            text: "Circuit Academy",
            items: [
                { text: "Start here", link: "/academy/" },
                { text: "Certification", link: "/academy/certification" },
                { text: "Graduates", link: "/academy/graduates" },
                { text: "Glossary", link: "/academy/glossary" },
            ],
        },
        ...Academy.LEVELS.map((level, place) => ({
            text: `${level.name}: ${level.title}`,
            collapsed: false,
            items: [
                // Every level after the first opens with an entry check about the one before it.
                ...(place > 0 ? [{ text: "Entry check", link: `/academy/checks/${level.slug}` }] : []),
                ...level.lessons.map((lesson, index) => ({ text: `${index + 1}. ${lesson.title}`, link: Academy.link(level, lesson) })),
            ],
        })),
    ];
}
