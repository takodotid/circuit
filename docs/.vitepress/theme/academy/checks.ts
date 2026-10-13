// The entry check of each level after the first: questions about the level before it. A check draws a few at random, so a second try asks different ones.

export type Question = {
    question: string;
    choices: string[];
    /** The right choice, counted from 0. */
    answer: number;
    /** The lesson that teaches it, offered when the answer was wrong. */
    lesson: string;
};

export type Check = {
    /** The level the check opens. */
    level: string;
    /** The level it asks about. */
    about: string;
    /** How many questions one try asks. */
    asks: number;
    /** How many right answers pass. */
    pass: number;
    questions: Question[];
};

export const checks: Check[] = [
    {
        level: "elementary",
        about: "beginner",
        asks: 10,
        pass: 8,
        questions: [
            {
                question: "A switch gets a frame for a hardware address it has not seen yet. What does it do?",
                choices: [
                    "Drops the frame",
                    "Sends it out of every port except the one it came in on",
                    "Sends it back to the sender",
                    "Sends it to the router",
                ],
                answer: 1,
                lesson: "/academy/beginner/switches",
            },
            {
                question: "How does a switch learn which device is behind which port?",
                choices: [
                    "Someone types the list in",
                    "It reads the sender's hardware address of every frame that comes in",
                    "It asks every device for its IP address",
                    "It reads the IP address inside each packet",
                ],
                answer: 1,
                lesson: "/academy/beginner/switches",
            },
            {
                question: "A laptop is 192.168.1.20/24. Which of these is on the same network?",
                choices: ["192.168.2.20", "192.168.1.200", "10.168.1.20", "192.169.1.20"],
                answer: 1,
                lesson: "/academy/beginner/ip-addresses",
            },
            {
                question: "How many addresses does a /24 hold?",
                choices: ["24", "254", "256", "65,536"],
                answer: 2,
                lesson: "/academy/beginner/ip-addresses",
            },
            {
                question: "In the network 192.168.1.0/24, what is 192.168.1.255?",
                choices: [
                    "The router",
                    "The last device",
                    "The address that reaches every device on the network at once",
                    "Not an address at all",
                ],
                answer: 2,
                lesson: "/academy/beginner/ip-addresses",
            },
            {
                question: "Which of these is a private address, used inside homes and offices?",
                choices: ["8.8.8.8", "10.20.30.40", "203.0.113.9", "1.1.1.1"],
                answer: 1,
                lesson: "/academy/beginner/ip-addresses",
            },
            {
                question: "What number is 11000000 in bits?",
                choices: ["110", "192", "128", "3"],
                answer: 1,
                lesson: "/academy/beginner/binary",
            },
            {
                question: "What is the biggest number one byte can hold?",
                choices: ["128", "255", "256", "1,000"],
                answer: 1,
                lesson: "/academy/beginner/binary",
            },
            {
                question: "Your laptop sends a packet to an address on another network. Where does the packet go first?",
                choices: [
                    "Straight to that address",
                    "To the default gateway, the router",
                    "To the DNS server",
                    "To every device on your network",
                ],
                answer: 1,
                lesson: "/academy/beginner/routers",
            },
            {
                question: "What stops a packet from going round between two routers forever?",
                choices: [
                    "The switch",
                    "The TTL, which each router lowers by one until it reaches 0",
                    "The DNS server",
                    "Nothing stops it",
                ],
                answer: 1,
                lesson: "/academy/beginner/routers",
            },
            {
                question: "A letter goes from a laptop through two routers to a server. Which addresses on it change at every router?",
                choices: ["The IP addresses", "The hardware addresses", "Both", "Neither"],
                answer: 1,
                lesson: "/academy/beginner/addresses",
            },
            {
                question: "What does DNS do?",
                choices: [
                    "Gives each device an IP address",
                    "Turns a name such as circuit.tako.id into an IP address",
                    "Encrypts the page",
                    "Connects your home to the internet",
                ],
                answer: 1,
                lesson: "/academy/beginner/dns",
            },
            {
                question: "You look up the same name twice, and the second answer is instant. Why?",
                choices: [
                    "The website moved closer",
                    "The answer was remembered, for as long as its TTL allows",
                    "The second lookup skips the internet",
                    "DNS is always instant",
                ],
                answer: 1,
                lesson: "/academy/beginner/dns",
            },
            {
                question: "On one server, what tells the web program and the remote login program apart?",
                choices: ["Their hardware addresses", "Their port numbers, such as 443 and 22", "Their IP addresses", "Their DNS names"],
                answer: 1,
                lesson: "/academy/beginner/ports",
            },
            {
                question: "Which one checks that every piece arrived, in order, and sends a lost piece again?",
                choices: ["UDP", "TCP", "DNS", "Both TCP and UDP"],
                answer: 1,
                lesson: "/academy/beginner/ports",
            },
            {
                question: "Why is data sent in small packets instead of one long message?",
                choices: [
                    "Small packets travel faster than light",
                    "So many devices can share a link, and only a lost piece has to be sent again",
                    "Cables cannot carry long messages",
                    "So the message is encrypted",
                ],
                answer: 1,
                lesson: "/academy/beginner/packets",
            },
            {
                question:
                    "You plug a computer into a socket on the back of your home router. Which part of the box joins it to the other devices at home?",
                choices: ["The router", "A small switch built into the box", "The Wi-Fi access point", "The provider"],
                answer: 1,
                lesson: "/academy/beginner/what-is-a-network",
            },
        ],
    },
    {
        level: "intermediate",
        about: "elementary",
        asks: 10,
        pass: 8,
        questions: [
            {
                question: "What does an access port carry?",
                choices: ["Every VLAN, tagged", "One VLAN, without a tag", "No VLAN at all", "Only the management VLAN"],
                answer: 1,
                lesson: "/academy/elementary/vlans",
            },
            {
                question: "A laptop in VLAN 20 sends to a recorder in VLAN 40 on the same switch. What does it need?",
                choices: ["Nothing, they share a switch", "A router with an address in each VLAN", "A longer cable", "A second switch"],
                answer: 1,
                lesson: "/academy/elementary/vlans",
            },
            {
                question: "What tells the switch at the far end of a trunk which VLAN a frame belongs to?",
                choices: ["The port it arrives on", "A tag in the frame with the VLAN's number", "The IP address", "The frame's length"],
                answer: 1,
                lesson: "/academy/elementary/trunks",
            },
            {
                question: "Which numbers can a VLAN have?",
                choices: ["0 to 255", "1 to 4094", "1 to 65535", "Any number"],
                answer: 1,
                lesson: "/academy/elementary/trunks",
            },
            {
                question: "In what order are the four DHCP messages sent?",
                choices: [
                    "Request, offer, discover, acknowledge",
                    "Discover, offer, request, acknowledge",
                    "Offer, discover, acknowledge, request",
                    "Discover, request, offer, acknowledge",
                ],
                answer: 1,
                lesson: "/academy/elementary/dhcp",
            },
            {
                question: "With NAT, why can a stranger on the internet not open a connection to your laptop at home?",
                choices: [
                    "NAT encrypts everything",
                    "The router has no row in its table that says which device at home it is for",
                    "Private addresses are secret",
                    "The laptop has no IP address",
                ],
                answer: 1,
                lesson: "/academy/elementary/nat",
            },
            {
                question:
                    "A forward chain drops by default, and its only rule accepts home to the internet. The laptop opens a website. What happens?",
                choices: [
                    "The page loads",
                    "The request goes out, but the answer is dropped, since no rule accepts it",
                    "The request is dropped",
                    "The router asks what to do",
                ],
                answer: 1,
                lesson: "/academy/elementary/firewall",
            },
            {
                question:
                    "Rules are read from the top. Rule 1 accepts everything from guests; rule 2 drops guests to the home network. A guest opens the printer at home. What happens?",
                choices: ["It is dropped by rule 2", "It is accepted by rule 1", "Both rules apply", "The default decides"],
                answer: 1,
                lesson: "/academy/elementary/firewall",
            },
            {
                question: "You log in to the router itself over SSH. Which chain decides?",
                choices: ["forward", "input", "nat", "Both input and forward"],
                answer: 1,
                lesson: "/academy/elementary/firewall",
            },
            {
                question: "A switch reads a frame. Up to which layer does it look?",
                choices: [
                    "Physical only",
                    "Link: the frame and its hardware addresses",
                    "Network: the IP addresses",
                    "Application: the web page",
                ],
                answer: 1,
                lesson: "/academy/elementary/layers",
            },
            {
                question: "In Circuit, what happens to a port the device's file does not mention?",
                choices: ["It is left as it is", "It is shut down", "It joins VLAN 1", "Circuit asks what to do"],
                answer: 1,
                lesson: "/academy/elementary/writing-it-down",
            },
            {
                question: "In Circuit, how do you turn a setting off?",
                choices: ["Write enabled: false", "Leave the field out", "Write null", "Comment it out and keep it"],
                answer: 1,
                lesson: "/academy/elementary/writing-it-down",
            },
            {
                question: "Which command shows what would change on a device, without sending anything?",
                choices: ["circuit apply --confirm", "circuit diff", "circuit snapshot", "circuit new"],
                answer: 1,
                lesson: "/academy/elementary/writing-it-down",
            },
            {
                question: "How is a device's password written in a Circuit file?",
                choices: [
                    "As the password itself",
                    'As secret("NAME"), with the value kept in .env or 1Password',
                    "In a comment",
                    "It is not written anywhere",
                ],
                answer: 1,
                lesson: "/academy/elementary/management",
            },
            {
                question: "What does management.allow decide?",
                choices: ["Which VLANs exist", "Which addresses may log in to the device", "Which ports are on", "Which users exist"],
                answer: 1,
                lesson: "/academy/elementary/management",
            },
            {
                question:
                    "Two switches are joined by a trunk. One end carries VLANs 10 and 20, the other only 10. What does circuit validate do?",
                choices: [
                    "Nothing, VLAN 10 works",
                    "Reports an error naming both ends, before anything is sent",
                    "Adds VLAN 20 to the other end",
                    "Removes VLAN 20",
                ],
                answer: 1,
                lesson: "/academy/elementary/trunks",
            },
        ],
    },
    {
        level: "professional",
        about: "intermediate",
        asks: 10,
        pass: 8,
        questions: [
            {
                question:
                    "A router has routes for 0.0.0.0/0 via A, 10.0.0.0/8 via B and 10.1.0.0/16 via C. Where does it send a packet for 10.1.2.3?",
                choices: ["A, the default route", "B", "C, the longest match", "All three"],
                answer: 2,
                lesson: "/academy/intermediate/routing-tables",
            },
            {
                question: "Why does an edge router hold a blackhole route for the block it announces?",
                choices: [
                    "To drop every packet for it",
                    "So the block is in its routing table, and announced, even when nothing inside it is up",
                    "To hide the block from BGP",
                    "To save memory",
                ],
                answer: 1,
                lesson: "/academy/intermediate/routing-tables",
            },
            {
                question: "What is 2001:0db8:0000:0000:0000:0000:0000:0001 written short?",
                choices: ["2001:db8::1", "2001:db8:0:1", "2001:0db8::0001", "2001::db8::1"],
                answer: 0,
                lesson: "/academy/intermediate/ipv6",
            },
            {
                question: "How big is the IPv6 network one LAN usually gets?",
                choices: ["/24", "/48", "/64", "/128"],
                answer: 2,
                lesson: "/academy/intermediate/ipv6",
            },
            {
                question: "How does OSPF choose the path to a network?",
                choices: ["The fewest routers", "The lowest total cost of the links", "The newest link", "The router with the highest ID"],
                answer: 1,
                lesson: "/academy/intermediate/ospf",
            },
            {
                question: "An OSPF link fails. What happens next?",
                choices: [
                    "Nothing until someone changes a static route",
                    "The routers tell each other, and each works out its paths again",
                    "Every router restarts",
                    "The cost of the link doubles",
                ],
                answer: 1,
                lesson: "/academy/intermediate/ospf",
            },
            {
                question: "What tells IP transit from peering?",
                choices: [
                    "Transit is faster",
                    "With transit a customer pays a provider to reach the whole internet; with peering two networks exchange their own routes, usually without paying",
                    "Peering needs BGP and transit does not",
                    "There is no difference",
                ],
                answer: 1,
                lesson: "/academy/intermediate/autonomous-systems",
            },
            {
                question: "What does a route server at an internet exchange save you?",
                choices: ["Buying transit", "A session with each member: one session to it reaches many", "Your AS number", "Running BGP"],
                answer: 1,
                lesson: "/academy/intermediate/autonomous-systems",
            },
            {
                question: "A router gets a BGP announcement whose AS path already holds its own AS number. What does it do?",
                choices: ["Prefers it", "Drops it, so routes cannot loop", "Sends it back", "Lowers its local preference"],
                answer: 1,
                lesson: "/academy/intermediate/bgp",
            },
            {
                question: "Which transport does a BGP session run over?",
                choices: ["UDP port 53", "TCP port 179", "TCP port 22", "None, it is broadcast"],
                answer: 1,
                lesson: "/academy/intermediate/bgp",
            },
            {
                question: "In the simplified order the Academy teaches, what does BGP compare first between two routes for one prefix?",
                choices: ["The shortest AS path", "The highest local preference", "The lowest MED", "The oldest route"],
                answer: 1,
                lesson: "/academy/intermediate/best-path",
            },
            {
                question: "Your exchange and your transit both reach a network. How do you send your traffic for it through the exchange?",
                choices: [
                    "Prepend your AS towards the exchange",
                    "Give routes learned from the exchange a higher local preference",
                    "Lower the MED of the transit",
                    "Remove the transit",
                ],
                answer: 1,
                lesson: "/academy/intermediate/best-path",
            },
            {
                question: "What does AS path prepending towards one provider do?",
                choices: [
                    "Makes your route through it look longer to others, so less traffic comes in that way",
                    "Makes your route shorter",
                    "Hides your prefix",
                    "Raises your local preference",
                ],
                answer: 0,
                lesson: "/academy/intermediate/best-path",
            },
            {
                question: "What should an edge router announce to its transit provider?",
                choices: ["Every route it knows", "Only its own prefixes, and its customers'", "Only the default route", "Nothing"],
                answer: 1,
                lesson: "/academy/intermediate/route-policy",
            },
            {
                question: "What does max_prefixes on a BGP neighbor do?",
                choices: [
                    "Limits how many routes you announce",
                    "Closes the session if the neighbor sends more routes than the limit",
                    "Sets the local preference",
                    "Turns on RPKI",
                ],
                answer: 1,
                lesson: "/academy/intermediate/route-policy",
            },
            {
                question: "Two switches are joined by two cables, with spanning tree off. A broadcast is sent. What happens?",
                choices: [
                    "It is delivered once",
                    "It goes round the loop without end, the copies multiplying: a broadcast storm",
                    "The second cable is ignored",
                    "The switches join the cables into a LAG",
                ],
                answer: 1,
                lesson: "/academy/intermediate/redundancy",
            },
            {
                question: "What is a LAG?",
                choices: [
                    "A slow link",
                    "Several links joined into one, for more capacity and a spare",
                    "A VLAN on a trunk",
                    "A routing protocol",
                ],
                answer: 1,
                lesson: "/academy/intermediate/redundancy",
            },
        ],
    },
];
