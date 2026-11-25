# Runtime notices

The Windows release bundles Node.js **v24.19.0**, copied from the build machine's installed runtime. `NODE-LICENSE.txt` contains Node.js and its bundled dependencies' notices, obtained from the official [tagged source](https://raw.githubusercontent.com/nodejs/node/v24.19.0/LICENSE).

The build requires this exact runtime version and writes its SHA-256 to `runtime.sha256`. Updating Node requires updating the license file and build pin together. Context Lens itself is MIT licensed; it has no production npm dependencies.

When the Windows installer supplies a private copy of Codex Script Loader 0.6.2, it uses the pinned upstream Windows x64 portable ZIP. The Loader license and branding notice are installed under `third_party`. The experimental builds also contain these notices alongside their own verified manifests. [Upstream release](https://github.com/JHees/codex-script-loader/releases/tag/v0.6.2)

The Windows launcher bundles Acorn 8.15.0 for local, read-only parsing of JavaScript assets. The upstream ES module and MIT license are in `third_party/acorn`. The standalone sidebar ZIP uses its built-in profiles. [Acorn](https://github.com/acornjs/acorn)

The optional experimental backend is built from OpenAI Codex with the patches in this repository. The Windows installer includes upstream LICENSE and NOTICE files when this component is installed. [Tagged backend source and Apache 2.0 license](https://github.com/openai/codex/tree/581161ab41e643d942e1e1b5f561034060bf18e3)
