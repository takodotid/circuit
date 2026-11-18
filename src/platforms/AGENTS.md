# Platforms

Each folder is one adapter for one device OS; `platform.ts` is the contract. Skills: `implement-device`, `fix-device`, `prove-on-device`.

- A platform is one OS at the versions in its `os.versions` (`routeros` is RouterOS 7, not 6). A new version widens `os.versions` once tested on a device; one that takes other commands is a new platform.
- Read the platform's `TRAPS.md` before you change its adapter.
