<!-- Why: a network configured by hand drifts, and with Circuit the file is the record. -->

<template>
    <section class="chapter why" aria-labelledby="why">
        <h2 id="why" data-reveal><span>Why</span></h2>
        <div class="body">
            <p>
                A network configured by hand drifts. Someone adds a VLAN during an outage, someone else tests a firewall rule and forgets
                it, and a year later nobody knows why a port is on. The device is the only record, and it does not say who changed what, or
                why.
            </p>
            <p>With Circuit the record is the file. Whatever the file leaves out does not stay on the device:</p>
            <table class="ledger" data-reveal>
                <thead>
                    <tr>
                        <th scope="col">Not in the file</th>
                        <th scope="col">On the device</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <th scope="row">A port</th>
                        <td>is shut down</td>
                    </tr>
                    <tr>
                        <th scope="row">A user</th>
                        <td>is removed</td>
                    </tr>
                    <tr>
                        <th scope="row">A service</th>
                        <td>is off</td>
                    </tr>
                </tbody>
            </table>
            <p>And git keeps every change, with its author and its reason.</p>
        </div>
    </section>
</template>

<style scoped>
.ledger {
    width: 100%;
    margin: calc(6 * var(--px)) 0 calc(24 * var(--px));
    border-collapse: collapse;
    font-size: max(16px, calc(18 * var(--px)));
}

.ledger thead th {
    padding: calc(10 * var(--px)) calc(16 * var(--px));
    background: var(--circuit-head);
    font-size: max(11px, calc(12 * var(--px)));
    font-weight: 700;
    font-stretch: 115%;
    letter-spacing: 0.1em;
    text-align: left;
    text-transform: uppercase;
}

.ledger tbody th,
.ledger td {
    padding: calc(14 * var(--px)) calc(16 * var(--px));
    border-bottom: 1px solid var(--circuit-line);
    text-align: left;
}

.ledger tbody th {
    width: 42%;
    font-weight: 700;
}

@media (prefers-reduced-motion: no-preference) {
    /* A cause, then its effect: what the file leaves out, then what happens to it on the device. */
    .ledger tbody tr:nth-child(2) {
        --i: 1;
    }

    .ledger tbody tr:nth-child(3) {
        --i: 2;
    }

    .ledger.shown tbody th {
        animation: home-fade 0.5s var(--ease) backwards;
        animation-delay: calc(0.15s + var(--i, 0) * 0.18s);
    }

    .ledger.shown td {
        animation: follow 0.6s var(--ease) backwards;
        animation-delay: calc(0.45s + var(--i, 0) * 0.18s);
    }
}

@keyframes follow {
    from {
        opacity: 0;
        transform: translateX(-14px);
    }
}
</style>
