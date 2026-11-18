# Platforms

Each folder is one adapter for one device OS. `platform.ts` is the contract every adapter follows. Skills: `implement-device`, `fix-device`, `prove-on-device`.

- A platform is one OS at the versions in its `os.versions`. `routeros` is RouterOS 7, not 6. A new version widens `os.versions` once it is tested on a real device. If it takes other commands, it becomes a new platform.
- A field the platform can't express goes in `unsupported()`. Never skip a field silently.
- `models.ts` lists the hardware models and their ports. `TRAPS.md` lists what the device does that you wouldn't expect. Read it before you change the adapter.
- A class here starts with the platform's name, such as `RouterOsRender`.
- The golden tests (`test/platforms/<platform>-golden.test.ts`) must keep passing: each old example renders byte for byte as before.
