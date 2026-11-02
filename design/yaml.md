# YAML projects (planned)

A later Circuit reads a project written in YAML too, beside TypeScript. Same model, same commands: only the file format differs.

## Rules

- **The schema is v1's TypeScript.** Every YAML key is a field of `src/config/`, with the same name and the same meaning. No second schema to keep in step: the JSON Schema the editor uses is generated from the types.
- **One tag: `!ref <file>#<path>`.** A fact used in several files is written once and read where it's used. No functions, loops, conditions or text templates.
- **Same layout.** `circuit.yaml` for the network, `sites/<site>/<device>.yaml` for each device.

```yaml
# sites/jakarta-1/edge-01.yaml
name: edge-01
site: jakarta-1
platform: routeros
model: CCR2216-1G-12XS-2XQ
connection: { host: 192.0.2.1, user: netops }
routing:
    bgp:
        neighbors:
            hurricane-electric:
                remote_as: 6939
                address: 203.0.113.1
                import: transit-import
                export: !ref shared/policies.yaml#transit-export
```

## How the tag works

- `!ref <file>#<path>` is the value at `<path>` in `<file>`: text, a number, a list or a map.
- `<file>` starts at the project root, so a ref reads the same from any file.
- `<path>` is keys joined by dots, through maps only.
- Inside one file, YAML's own anchors (`&x`, `*x`) do the job.
- A ref is a whole value. It can't build text: `64500:100` is written out.
- Circuit resolves every ref first, then checks the result as it checks TypeScript. A missing file or key, a loop, or a wrong type is an error at the file and line.

## What it needs before it ships

- A generated JSON Schema per file kind, so the stock YAML extension completes and checks keys.
- Editor help across files (follow a ref, check a VLAN name exists): Circuit's own language server, since the YAML extension can't.

A prototype (resolver, merge, editor schemas) was proved on a real five-device network during the v1 design: it gave the same model as the TypeScript project.
