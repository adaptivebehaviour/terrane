# Terrane

Desktop (Electron) application scaffolded from manifesto release 2.2.0. Collections are composed in
`src/renderer/registry.ts` (`createRegistry([...])`); the project's own collection is `collection/` (`terrane-collection`).

The framework is vendored from manifesto release 2.2.0 in `vendor/`: **change manifesto and take a new release, never edit
`vendor/`**; upgrade with `update-project`.

The starter screen is deliberately blank: add content, controls and routes only when asked.
