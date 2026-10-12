# Printing the graph

`circuit graph` prints your network as a graph, from your files alone, for a pull request, an image or a script. It prints one [layer](/studio/graph#the-layers), cables by default. To see the graph in your browser instead, use [Studio](/studio/).

```bash
npx circuit graph                           # the cables, as Mermaid
npx circuit graph --layer=bgp               # BGP sessions
npx circuit graph --layer=l2,l3 edge-01     # VLANs and addresses, only around edge-01
npx circuit graph --layer=all --format=json # everything, for a script or an AI agent
```

| Format    | For                                                                                                                                                       |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mermaid` | Pasting into a pull request, an issue or a README on GitHub, in a code block marked `mermaid`. GitHub draws it.                                           |
| `dot`     | An image, with [Graphviz](https://graphviz.org): `npx circuit graph --format=dot \| dot -Tsvg > network.svg`.                                             |
| `json`    | Scripts and AI agents. It holds every node and line with its details, what `circuit validate` found, and how each device compares with its last snapshot. |

Name devices after the command to draw only what touches them. The marks are the [same as in Studio](/studio/graph#what-is-marked).
