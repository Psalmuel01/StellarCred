import { createRequire } from "module";

const require = createRequire(import.meta.url);
const bufferPath = require.resolve("buffer/");
const processPath = require.resolve("process/browser");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // The /api/issue route runs Noir server-side to compute the Poseidon
  // commitment. Keep these out of the server bundle so Node require()s them
  // from node_modules and resolves their CJS/"nodejs" entry points, which read
  // the WASM from disk with fs. If bundled, webpack picks the "web" build that
  // fetch()es the WASM via a /_next/... URL, which has no base on the server
  // ("Failed to parse URL from /_next/static/media/...wasm").
  experimental: {
    serverComponentsExternalPackages: [
      "@noir-lang/noir_js",
      "@noir-lang/acvm_js",
      "@noir-lang/noirc_abi",
    ],
  },

  // Noir + Barretenberg (bb.js) prove in WASM in the browser. They expect Node
  // globals (Buffer/process) and load WASM modules; these settings make the
  // client bundle work without server-side polyfills.
  webpack: (config, { webpack, isServer }) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };

    // Buffer/process polyfills are only needed in the browser bundle.
    // Applying ProvidePlugin on the server replaces Node's real `process`
    // with `process/browser` (env: {}), which hides server-only env vars
    // like ISSUER_PRIVATE_KEY even after they are set in .env.local.
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        buffer: bufferPath,
        process: processPath,
      };
      config.plugins.push(
        new webpack.ProvidePlugin({
          Buffer: ["buffer", "Buffer"],
          process: processPath,
        }),
      );
    }

    return config;
  },

  // Cross-Origin-Opener/Embedder-Policy make the page crossOriginIsolated,
  // which unlocks SharedArrayBuffer and lets bb.js take its *multithreaded*
  // proving path (lib/proof.ts picks navigator.hardwareConcurrency threads
  // when crossOriginIsolated, else falls back to 1).
  //
  // This used to corrupt proving: @aztec/bb.js's UltraHonkBackend spawns a Web
  // Worker from its prebuilt main.worker.js bundle via
  // `new Worker(new URL("./main.worker.js", import.meta.url))`, and if
  // Next.js/webpack re-processed that already-bundled file it corrupted its
  // inner module runtime ("Object.defineProperty called on non-object"). That
  // no longer applies: scripts/copy-bb.mjs copies bb.js's browser bundle to
  // /public/bb, and lib/proof.ts loads it with a webpackIgnore dynamic import,
  // so webpack never touches it regardless of these headers. All bb.js assets
  // (main.worker.js, barretenberg.js, the .wasm) are served same-origin from
  // /public/bb, so COEP's same-origin exemption covers them without needing
  // extra Cross-Origin-Resource-Policy headers.
  //
  // 'wasm-unsafe-eval' in script-src is required for WASM instantiation and
  // is unrelated to cross-origin isolation.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data:",
              // contracts.ts ("use client") calls getAccount / prepareTransaction /
              // sendTransaction against the Soroban RPC from the browser — must be
              // allowed here or proof submission and on-chain verification break.
              `connect-src 'self' https://soroban-testnet.stellar.org https://soroban-mainnet.stellar.org${
                process.env.NEXT_PUBLIC_RPC_URL ? " " + process.env.NEXT_PUBLIC_RPC_URL : ""
              }`,
            ].join("; ") + ";",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
          { key: "X-Frame-Options", value: "DENY" },
          // components/QrScanner.tsx uses getUserMedia() for camera-based QR
          // scanning (/verify and /holder). Explicitly scoped to this origin —
          // no embedding context should be able to request it.
          { key: "Permissions-Policy", value: "camera=(self)" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
      // CORS headers for /api/* are handled by middleware.ts (OPTIONS preflight
      // returns 204, all other methods get headers appended to the response).
    ];
  },
};

export default nextConfig;