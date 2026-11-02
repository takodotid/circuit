---
title: Reaching the customer
description: How a provider reaches each customer, over fibre, copper, radio or satellite. Connect four sites, and see what each link does to speed and delay.
---

# Reaching the customer

Every customer is joined to a provider's network by one link: from the provider's nearest building to the customer's own. That link is called the <Term means="The link between a provider's nearest point and the customer's building. Also called the local loop.">last mile</Term>, or the local loop, whatever its length. It is made of one of four things: fibre, copper, radio, or a satellite.

The choice decides two things the customer feels every day: how much the link carries each second, and how long each message takes to get there and back. A faster plan changes the first and never the second.

## Speed and delay are different things

**Speed**, or bandwidth, is how many bits a link carries each second: 100 Mbit/s, 1 Gbit/s. **Delay**, or <Term means="The time a message takes to cross a link or a network. Usually given as the round trip: there and back, in milliseconds.">latency</Term>, is how long one bit takes to arrive. A wider road carries more cars, but each car still takes as long to drive the same distance.

Delay comes mostly from distance. Light in fibre covers about 200 km each millisecond, so 1,000 km of fibre adds about 5 ms one way and 10 ms there and back. Radio through the air is faster, at nearly the full speed of light. The equipment on the way adds some too, but over a long path, distance is most of it.

There is a second question for every link: is it **shared**? Most links to homes are shared with neighbours, so a home gets less when everyone is busy. A link of its own gives a customer its full rate all the time, which is what a business pays more for.

## Fibre to the home: GPON

Fibre all the way into a home is called <Term means="Fibre to the home: an optical fibre all the way into the customer's home.">FTTH</Term>, and a standard way to build it is <Term means="Gigabit-capable passive optical network, the ITU-T G.984 standard: one fibre from the provider, split without power to up to 64 or 128 homes, which share its capacity.">GPON</Term>. It has three parts:

1. The <Term means="Optical line terminal: the provider's equipment at the start of a GPON tree, in its building.">OLT</Term>, in the provider's building, sends light down one fibre.
2. A <Term means="A small glass part that divides the light from one fibre into many. It needs no power, which is the passive in passive optical network.">splitter</Term>, in the street or the building, divides that light between 32 or 64 fibres, sometimes 128. It needs no power at all.
3. An <Term means="Optical network terminal: the box where the fibre ends in the customer's home, which turns light into an Ethernet port. Often in one case with the home router.">ONT</Term> in each home turns the light back into an Ethernet port.

If your home internet comes in on a thin fibre cable to a small box, that box is an ONT, often in one case with the router. It belongs to the provider, which makes it <Term means="Customer premises equipment: the provider's equipment at the customer's site, such as an ONT or a router.">CPE</Term>, customer premises equipment.

One GPON fibre carries about 2.5 Gbit/s toward the homes and 1.25 Gbit/s back, and every home on the splitter shares it, taking turns. Homes can be up to about 20 km from the OLT. The newer XGS-PON carries 10 Gbit/s each way, and runs on the same fibre beside GPON, so a provider can move homes over one at a time.

<TryIt title="Share one fibre between homes">

Choose a splitter size and a plan, then bring homes online until the fibre runs out. Try the 1 to 64 splitter with 1,000 Mbit/s plans.

<PonSplitter />

</TryIt>

With a few homes busy, everyone gets their full plan. With many, they share. This is why home plans say "up to": the provider counts on most homes not downloading at full speed at the same moment, and usually they are not.

<Quiz
  question="64 homes share one GPON splitter, all on plans of up to 1,000 Mbit/s. In the evening 40 of them download at once. About how fast can each one go?"
  :choices="['1,000 Mbit/s, the speed of the plan', 'About 62 Mbit/s', 'About 39 Mbit/s']"
  :answer="1"
  :why="['The plan is the most a home can get. The fibre carries about 2,488 Mbit/s down, and 40 homes are sharing it.', '', 'That is 2,488 split 64 ways. Only the 40 busy homes share it now.']"
  explain="About 2,488 Mbit/s split between the 40 busy homes is about 62 Mbit/s each, a little less once the overheads are paid. Idle homes take nothing."
/>

## A fibre of its own

A business that needs a rate it can count on gets a fibre of its own: <Term means="A fibre from the provider's building to one customer, used by that customer alone.">point-to-point fibre</Term>, from the provider's router straight to the customer's. Nobody shares it, so its speed is set by the optics at both ends, and the provider can promise a rate and a repair time in the contract. It costs the provider a fibre and a router port for each customer, which is why it is kept for customers who pay for it. The [next lesson](/academy/professional/internet-products) shows what is sold over it.

## Copper: the old phone line

Where no fibre has reached, the phone line still can. <Term means="Very high speed digital subscriber line 2: internet over a telephone copper pair, from a cabinet or exchange near the customer.">VDSL2</Term> sends internet over the same pair of copper wires as a telephone, from a cabinet in the street or the phone exchange. Copper loses its signal quickly with length: VDSL2 reaches about 100 Mbit/s at 500 m from the cabinet, and about 50 Mbit/s at 1 km. A home far down the line gets much less than one next door.

## Radio: fixed wireless

A radio link can reach a building no cable runs to. With <Term means="A radio link between two fixed points, such as a provider's tower and a customer's roof, used in place of a cable.">fixed wireless</Term>, a provider puts a dish on the customer's roof, aimed at one on its tower. Nothing has to be dug, so it can reach a building long before a fibre could. It needs two things:

- **A clear line of sight.** Microwave radio does not bend around hills or buildings, and even the space around the straight line between the dishes must be clear.
- **Room for rain.** Heavy rain weakens radio signals above about 10 GHz, and more so at higher frequencies, so a link is planned with spare signal for the worst storm it should survive.

Some radios serve many customers from one tower, who then share it the way homes share a splitter.

## Satellite: VSAT and low orbit

Where nothing else reaches, such as an island, a ship or a mine, a satellite can. There are two kinds, and they behave very differently.

A <Term means="Very small aperture terminal: a satellite dish under 3.8 m across, usually 75 cm to 1.2 m, linked to a geostationary satellite.">VSAT</Term> talks to a **geostationary** satellite, 35,786 km above the equator. At that height a satellite circles once a day, so it stays above the same spot and the dish never moves. But every message climbs 35,786 km and comes back down, and a reply does the same: the round trip is over 480 ms from the distance alone, and measured round trips are around 600 ms or more. Calls feel awkward, and anything that waits for replies feels slow, whatever the plan's speed.

A **low-orbit** satellite flies far lower: Starlink's fly about 550 km up. The trip up and down takes only a few milliseconds, and measured round trips are tens of milliseconds, about 30 to 80 ms in one study. Low satellites move fast across the sky, so the dish is handed from one to the next, every 15 seconds or so in that study, and the delay shifts each time. The capacity is shared by the users nearby, and one study saw speeds several times higher off-peak than at the busiest hours.

Both kinds lose signal in heavy rain, as radio links do.

<TryIt title="Connect four sites">

Pick a way to connect each site, read what it brings, and compare the delays on the line above. Try a satellite for the flat in the city too.

<LastMileSites />

</TryIt>

The line shows the pattern: fibre, copper and radio add almost nothing to a round trip, the low satellite adds tens of milliseconds, and the geostationary one more than everything else put together.

<Quiz
  question="A plantation on a VSAT link to a geostationary satellite upgrades to a plan twice as fast. What happens to its round-trip delay?"
  :choices="['It halves, to about 300 ms', 'It stays at about 600 ms', 'It doubles']"
  :answer="1"
  :why="['A faster plan carries more bits each second, but each bit still travels to the satellite and back.', '', 'Nothing about a faster plan adds distance.']"
  explain="The delay comes from the distance to a satellite 35,786 km up, twice for every round trip. A faster plan moves more data each second; it cannot shorten the trip."
/>

## What each brings

| Link                    | Speed                                        | Shared?                     | Delay the link adds to a round trip |
| ----------------------- | -------------------------------------------- | --------------------------- | ----------------------------------- |
| GPON fibre              | About 2.5 Gbit/s down, 1.25 up, for the tree | Yes, by the splitter        | Well under 1 ms                     |
| Point-to-point fibre    | Whatever the optics at both ends run         | No                          | Well under 1 ms                     |
| VDSL2 copper            | About 100 Mbit/s at 500 m, 50 at 1 km        | No, but slows with distance | Under 1 ms on the line              |
| Fixed wireless          | Depends on the radio, distance and weather   | Point to point: no          | Under 1 ms on a link of a few km    |
| Low-orbit satellite     | Shared, and lower at busy hours              | Yes                         | Tens of milliseconds, and it varies |
| Geostationary satellite | Shared                                       | Yes                         | Over 480 ms, often 600 or more      |

<Quiz
  question="A bank's office in the city centre needs a rate written into its contract, and a repair time. Which link fits?"
  :choices="['GPON, like the homes on its street', 'A point-to-point fibre', 'A low-orbit satellite dish on the roof']"
  :answer="1"
  :why="['GPON is shared by every customer on the splitter, so a rate for one of them is hard to promise.', '', 'A satellite is shared with every user nearby, and its delay varies. It makes a good spare, not the main link.']"
  explain="A fibre of its own is shared with nobody, so the provider can commit to a rate and a repair time. A radio or satellite link makes a good second path beside it."
/>

Whatever the link, a box at the customer's end, such as an ONT, a modem or a radio, usually hands it to the router as an Ethernet port. From that port on, the router is configured like any other, and that is where Circuit takes over.

## Further reading

- [G.984](https://en.wikipedia.org/wiki/G.984) and [10G-PON](https://en.wikipedia.org/wiki/10G-PON): GPON's rates, splits and reach, and XGS-PON on the same fibre.
- [Local loop](https://en.wikipedia.org/wiki/Local_loop): what the last mile means.
- [VDSL2](https://en.wikipedia.org/wiki/VDSL2): how its speed falls with distance.
- [Microwave transmission](https://en.wikipedia.org/wiki/Microwave_transmission) and [Rain fade](https://en.wikipedia.org/wiki/Rain_fade): line of sight, and rain at high frequencies.
- [Very-small-aperture terminal](https://en.wikipedia.org/wiki/Very-small-aperture_terminal): what a VSAT is.
- Geoff Huston, [A transport protocol's view of Starlink](https://blog.apnic.net/2024/05/17/a-transport-protocols-view-of-starlink/), APNIC blog: low and geostationary orbits, measured delays and shared capacity.
- [Minimizing latency in long-haul networks](https://www.lightwaveonline.com/network-design/article/16649529/minimizing-latency-in-long-haul-networks), Lightwave: how far light travels in fibre each millisecond.

## In short

- The last mile, or local loop, is the link from the provider's nearest building to the customer: fibre, copper, radio or satellite.
- GPON shares one fibre between up to 64 or 128 homes through a splitter with no power: the OLT at the provider, an ONT in each home.
- A business that needs a committed rate gets a fibre of its own.
- Copper slows with distance; fixed wireless needs a clear line of sight and room for rain.
- Speed and delay are different: a geostationary satellite adds over half a second to every round trip, a low-orbit one tens of milliseconds, cables and radio almost nothing.
