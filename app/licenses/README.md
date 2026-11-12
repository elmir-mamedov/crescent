# Licenses npm does not install

A release lists everything it ships that others wrote, with the text of each
license, in `THIRD_PARTY_NOTICES.txt` (`src/third-party-notices.ts`). It reads
each package's license files from its folder under `node_modules`, and turns
here, to `licenses/<package name>/`, for what that folder lacks:

- **License and notice files** of packages bundled inside another package's
  prebuilt file, which npm does not install on their own: chevrotain, langium,
  the vscode-languageserver libraries, vscode-uri and path-browserify, all
  inside `mermaid.min.js`. They are copied unchanged from each package's npm
  tarball, at the version mermaid bundles, with a `package.json` that keeps
  only its name, version and license.
- **A license file** for a package that npm installs without one:
  abstract-logging, whose README names the MIT License at
  `jsumners.mit-license.org`, the text here.
- **A license field** for a package whose `package.json` has none: khroma.

`npm test` fails when the release ships a package with no license here or in
`node_modules`, and when a folder here is no longer used.
