# Browser optimization runtime

Vendored from `or-tools-wasm` **0.9.1**, https://github.com/Axelwickm/or-tools-wasm, Apache-2.0 (see LICENSE).

`browser/` contains the distributed browser modules. `wasm/` contains only CP-SAT's JSPI and Asyncify loaders and binaries. They are loaded from the same deployed site, with no external CDN dependency. Other solver binaries are not shipped or used.

The hosting worker serves COOP/COEP headers so WebAssembly threads can run. `planner-solver-worker.js` owns the calculation and is terminated on completion or timeout. Large runtime files go into `dist/client/vendor/`, not the server bundle.
