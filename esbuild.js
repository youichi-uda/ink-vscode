const esbuild = require("esbuild");

const isProduction = process.argv.includes("--production");
const isWatch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const sharedOptions = {
  bundle: true,
  minify: isProduction,
  sourcemap: !isProduction,
  platform: "node",
  target: "node18",
  format: "cjs",
  external: ["vscode"],
};

async function main() {
  const contexts = await Promise.all([
    esbuild.context({
      ...sharedOptions,
      entryPoints: ["src/extension.ts"],
      outfile: "dist/extension.js",
    }),
    esbuild.context({
      ...sharedOptions,
      entryPoints: ["src/server.ts"],
      outfile: "dist/server.js",
    }),
  ]);

  if (isWatch) {
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log("Watching for changes...");
  } else {
    await Promise.all(contexts.map((ctx) => ctx.rebuild()));
    await Promise.all(contexts.map((ctx) => ctx.dispose()));
    console.log("Build complete.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
