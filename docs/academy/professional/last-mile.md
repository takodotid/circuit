---
title: Reaching the customer
description: How a provider reaches each customer, over fiber, copper, radio, or satellite. Connect four sites, and see what each link does to speed and delay.
---

# Reaching the customer

A provider joins each customer to its network with one link, from the provider's nearest building to the customer's. This link is the <Term means="The link from the provider's nearest point to the customer's building.">last mile</Term>, or the local loop, whatever its length. It is fiber, copper, radio, or a satellite.

The choice sets two things the customer feels every day: how much the link carries each second, and how long each message takes to get there and back. A faster plan changes the first, never the second.

## Speed and delay are different things

**Speed**, or bandwidth, is how many bits a link carries each second, such as 100 Mbit/s or 1 Gbit/s. **Delay**, or <Term means="The time a message takes to cross a link or a network, usually given as the round trip in milliseconds.">latency</Term>, is how long one bit takes to arrive. A wider road carries more cars, but each car still needs the same time to drive the same distance.

Delay comes mostly from distance. Light in fiber covers about 200 km each millisecond. So 1,000 km of fiber adds about 5 ms one way, and 10 ms there and back. Radio through the air is faster, at nearly the full speed of light. The equipment on the way adds a little, but over a long path most of the delay is distance.

Every link also has a second question: is it **shared**? Most links to homes are shared with the neighbors, so each home gets less when everyone is busy. A link of its own gives a customer its full rate all the time. Businesses pay more for that.

## Fiber to the home with GPON

Fiber all the way into a home is <Term means="Fiber to the home: an optical fiber all the way into the customer's home, instead of copper for the last part.">FTTH</Term>. A standard way to build it is <Term means="The common kind of fiber to the home, where one fiber from the provider is split between many homes; the OLT is the provider's end of it.">GPON</Term>, which has three parts:

1. The OLT (optical line terminal), in the provider's building, sends light down one fiber.
2. A <Term means="A small glass part that splits the light from one fiber into many. It needs no power.">splitter</Term>, in the street or the building, divides that light between 32 or 64 fibers, sometimes 128. It needs no power.
3. An <Term means="The box at the customer's end of a fiber line, which turns light into a network port.">ONT</Term> in each home turns the light back into an Ethernet port.

If your home internet comes in on a thin fiber cable to a small box, that box is an ONT. It is often in one case with the router. It belongs to the provider, so it is <Term means="Customer premises equipment: the provider's device at the customer's site, such as the ONT or a router.">CPE</Term>, customer premises equipment.

One GPON fiber carries about 2.5 Gbit/s toward the homes and 1.25 Gbit/s back. Every home on the splitter shares it, taking turns. A home can be up to about 20 km from the OLT. The newer XGS-PON carries 10 Gbit/s each way on the same fiber, beside GPON, so a provider can move homes over one at a time.

<TryIt title="Share one fiber between homes">

Choose a splitter size and a plan, then add busy homes until the fiber runs out. Try the 1 to 64 splitter with 1,000 Mbit/s plans.

<PonSplitter />

</TryIt>

This is why home plans say "up to." The provider counts on most homes not downloading at full speed at the same time, and usually they don't.

<Quiz
  question="64 homes share one GPON splitter, all on plans of up to 1,000 Mbit/s. In the evening 40 of them download at once. About how fast can each one go?"
  :choices="['1,000 Mbit/s, the speed of the plan', 'About 62 Mbit/s', 'About 39 Mbit/s']"
  :answer="1"
  :why="['The plan is the most a home can get. The fiber carries about 2,488 Mbit/s down, and 40 homes are sharing it.', '', 'That is 2,488 split 64 ways. Only the 40 busy homes share it now.']"
  explain="About 2,488 Mbit/s split between the 40 busy homes is about 62 Mbit/s each, a little less after the overheads. Idle homes take nothing."
/>

## A fiber of its own

A business that needs a rate it can count on gets a fiber of its own. This <Term means="A fiber from the provider's building to one customer, used by that customer alone.">point-to-point fiber</Term> runs from the provider's router straight to the customer's. Nobody shares it, so the optics at both ends set its speed. The provider can then promise a rate and a repair time in the contract. It costs the provider a fiber and a router port for each customer, so it is kept for customers who pay for it. The [next lesson](/academy/professional/internet-products) shows what is sold over it.

## Copper: the old phone line

Where no fiber has reached, the phone line still can. <Term means="Very high speed digital subscriber line 2: internet over a telephone copper pair, from a cabinet or exchange near the customer.">VDSL2</Term> sends internet over the same pair of copper wires as a telephone, from a cabinet in the street or from the phone exchange. Copper loses its signal quickly with length. VDSL2 reaches about 100 Mbit/s at 500 m from the cabinet, and about 50 Mbit/s at 1 km. A home far down the line gets much less than one next door.

## Radio: fixed wireless

A radio link can reach a building that no cable runs to. With <Term means="A radio link between two fixed points, such as a provider's tower and a customer's roof, used in place of a cable.">fixed wireless</Term>, a provider puts a dish on the customer's roof, aimed at one on its tower. Nothing has to be dug, so it can reach a building long before a fiber could. It needs two things:

- **A clear line of sight.** Microwave radio doesn't bend around hills or buildings. Even the space around the straight line between the dishes must be clear.
- **Room for rain.** Heavy rain weakens radio signals over about 10 GHz, and more so at higher frequencies. So a link is planned with spare signal for the worst storm it should survive.

Some radios serve many customers from one tower. Those customers share it, the way homes share a splitter.

## Satellite: geostationary and low orbit

Where nothing else reaches, such as an island, a ship, or a mining camp, a satellite can. There are two kinds, and they behave very differently.

<Term means="Internet over a satellite dish, for places no cable reaches; geostationary links bring a long delay.">VSAT</Term> is internet over a dish that talks to a **geostationary** satellite, 35,786 km over the equator. At that height a satellite circles once a day, so it stays over the same spot and the dish never moves. But every message climbs 35,786 km and comes back down, and so does its reply. The distance alone makes the round trip over 480 ms, and measured round trips are around 600 ms or more. Calls feel awkward, and anything that waits for replies feels slow, whatever the plan's speed.

A **low-orbit** satellite flies far lower. Starlink satellites fly about 550 km up. The trip up and down takes only a few milliseconds, and one study measured round trips of about 30 to 80 ms. Low satellites cross the sky fast, so the dish moves from one to the next about every 15 seconds in that study. The delay shifts each time. Users nearby share the capacity, and one study saw speeds several times higher off-peak than at the busiest hours.

Both kinds lose signal in heavy rain, as radio links do.

<TryIt title="Connect four sites">

<LastMileSites />

</TryIt>

The line shows the pattern. Fiber, copper, and radio add almost nothing to a round trip. The low satellite adds tens of milliseconds, and the geostationary one more than all the others together.

<Quiz
  question="A plantation on a VSAT link to a geostationary satellite upgrades to a plan twice as fast. What happens to its round-trip delay?"
  :choices="['It halves, to about 300 ms', 'It stays at about 600 ms', 'It doubles']"
  :answer="1"
  :why="['A faster plan carries more bits each second, but each bit still travels to the satellite and back.', '', 'Nothing about a faster plan adds distance.']"
  explain="The delay comes from the distance to a satellite 35,786 km up, twice for every round trip. A faster plan moves more data each second, but it can't shorten the trip."
/>

## What each brings

| Link                    | Speed                                        | Shared?                     | Delay the link adds to a round trip |
| ----------------------- | -------------------------------------------- | --------------------------- | ----------------------------------- |
| GPON fiber              | About 2.5 Gbit/s down, 1.25 up, for the tree | Yes, by the splitter        | Well under 1 ms                     |
| Point-to-point fiber    | Whatever the optics at both ends run         | No                          | Well under 1 ms                     |
| VDSL2 copper            | About 100 Mbit/s at 500 m, 50 at 1 km        | No, but slows with distance | Under 1 ms on the line              |
| Fixed wireless          | Depends on the radio, distance, and weather  | Point to point: no          | Under 1 ms on a link of a few km    |
| Low-orbit satellite     | Shared, and lower at busy hours              | Yes                         | Tens of milliseconds, and it varies |
| Geostationary satellite | Shared                                       | Yes                         | Over 480 ms, often 600 or more      |

<Quiz
  question="A bank's office in the city center needs a rate written into its contract, and a repair time. Which link fits?"
  :choices="['GPON, like the homes on its street', 'A point-to-point fiber', 'A low-orbit satellite dish on the roof']"
  :answer="1"
  :why="['GPON is shared by every customer on the splitter, so a rate for one of them is hard to promise.', '', 'A satellite is shared with every user nearby, and its delay varies. It makes a good spare, not the main link.']"
  explain="A fiber of its own is shared with nobody, so the provider can commit to a rate and a repair time. A radio or satellite link makes a good second path beside it."
/>

Whatever the link, a box at the customer's end usually hands it to the router as an Ethernet port. That box is an ONT, a modem, or a radio. From that port on, the router is set up like any other, and Circuit takes over.

## Further reading

- [G.984](https://en.wikipedia.org/wiki/G.984) and [10G-PON](https://en.wikipedia.org/wiki/10G-PON): the rates, splits, and reach of GPON, and XGS-PON on the same fiber.
- [Local loop](https://en.wikipedia.org/wiki/Local_loop): what the last mile means.
- [VDSL2](https://en.wikipedia.org/wiki/VDSL2): how its speed falls with distance.
- [Microwave transmission](https://en.wikipedia.org/wiki/Microwave_transmission) and [Rain fade](https://en.wikipedia.org/wiki/Rain_fade): line of sight, and rain at high frequencies.
- [Very-small-aperture terminal](https://en.wikipedia.org/wiki/Very-small-aperture_terminal): what a VSAT is.
- [A transport protocol's view of Starlink](https://blog.apnic.net/2024/05/17/a-transport-protocols-view-of-starlink/), APNIC blog: low and geostationary orbits, measured delays, and shared capacity.
- [Minimizing latency in long-haul networks](https://www.lightwaveonline.com/network-design/article/16649529/minimizing-latency-in-long-haul-networks): how far light travels in fiber each millisecond.

## In short

- The last mile, or local loop, is the link from the provider's nearest building to the customer. It is fiber, copper, radio, or satellite.
- GPON shares one fiber between up to 64 or 128 homes through a splitter with no power. The OLT is at the provider, and an ONT is in each home.
- A business that needs a committed rate gets a fiber of its own.
- Copper slows with distance. Fixed wireless needs a clear line of sight and room for rain.
- Speed and delay are different. A geostationary satellite adds over half a second to every round trip, a low-orbit one tens of milliseconds, and cables and radio almost nothing.
