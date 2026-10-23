# Examples

Working Circuit configs. None of them is a real network.

- `platforms/` has one device per platform, each using every field its adapter supports. `circuit.config.ts` puts them all in one network.
- `use-cases/` has whole networks, one folder each. Four of them are on the Use cases pages of the docs. `regional-provider/` is the largest: two sites, three platforms, transits, an exchange and customers.

The tests check that each one validates and plans nothing against its own render. Any command runs on them from the repository:

```bash
bun src/cli/index.ts validate --config=examples/platforms/circuit.config.ts
```
