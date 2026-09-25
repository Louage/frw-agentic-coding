const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: "esbuild-problem-matcher",
  setup(build) {
    build.onStart(() => {
      console.log("[watch] build started");
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`[ERROR] ${text}`);
        if (location) {
          console.error(`    ${location.file}:${location.line}:${location.column}:`);
        }
      });
      console.log("[watch] build finished");
    });
  },
};

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "dist/extension.js",
    external: ["vscode"],
    logLevel: "silent",
    plugins: [esbuildProblemMatcherPlugin],
  });

  // Second entry: the vscode-free Claude Code plugin emitter CLI (D32). Never
  // bundled into dist/extension.js, never shipped in the VSIX (.vscodeignore
  // excludes out-tools/**), build-time only — this is where the `yaml`
  // devDependency is allowed to end up (D42/D48).
  const toolsCtx = await esbuild.context({
    entryPoints: ["src/claudePlugin/emitCli.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "out-tools/emit-claude-plugin.cjs",
    logLevel: "silent",
    plugins: [esbuildProblemMatcherPlugin],
  });

  if (watch) {
    await ctx.watch();
    await toolsCtx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    await toolsCtx.rebuild();
    await toolsCtx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
