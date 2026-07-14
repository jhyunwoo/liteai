import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import crypto from "crypto";
import zlib from "zlib";

console.log("🚀 Starting Lite Chat ultra-lean build process...");

const PUBLIC_DIR = join(__dirname, "../public");
const ASSETS_DIR = join(PUBLIC_DIR, "assets");

// 1. Clean public/assets directories
if (existsSync(ASSETS_DIR)) {
  rmSync(ASSETS_DIR, { recursive: true, force: true });
}
mkdirSync(ASSETS_DIR, { recursive: true });

// Ensure libs is preserved in public (if it doesn't exist, we should make sure it remains)
// The user workspace has libs inside public, which we won't clean.
// We only clean public/assets. We will also overwrite public/index.html.

// 2. JS/TS Bundle + Minify (Bun.build)
console.log("📦 Bundling and minifying JS/TS entrypoints with Bun.build...");
const buildResult = await Bun.build({
  entrypoints: [
    "./frontend/app.ts",
    "./frontend/chat.ts",
    "./frontend/files.ts",
    "./frontend/agent.ts",
    "./frontend/settings.ts"
  ],
  outdir: ASSETS_DIR,
  minify: true,
  naming: "[name].[hash].js"
});

if (!buildResult.success) {
  console.error("❌ Bun.build failed:", buildResult.logs);
  process.exit(1);
}

// Build manifest map
const manifest: Record<string, string> = {};
for (const output of buildResult.outputs) {
  const filepath = output.path;
  const basename = filepath.split("/").pop() || "";
  const originalName = basename.split(".")[0];
  manifest[originalName] = `/assets/${basename}`;
}
console.log("📋 Generated Assets Manifest:", manifest);

// 3. Minify and Hash CSS
console.log("🎨 Minifying and hashing stylesheet...");
const rawCss = readFileSync(join(__dirname, "../frontend/style.css"), "utf-8");
const minifiedCss = rawCss
  .replace(/\/\*[\s\S]*?\*\//g, "") // remove comments
  .replace(/\s+/g, " ")             // replace multi-spaces with single space
  .replace(/\s*([{}|:;,])\s*/g, "$1") // clean spaces around punctuation
  .trim();

const cssHash = crypto.createHash("md5").update(minifiedCss).digest("hex").slice(0, 8);
const cssFilename = `style.${cssHash}.css`;
writeFileSync(join(ASSETS_DIR, cssFilename), minifiedCss, "utf-8");
console.log(`🎨 Created hashed stylesheet: /assets/${cssFilename} (${minifiedCss.length} bytes)`);

// 4. Update and Minify HTML
console.log("📝 Building index.html template...");
const rawHtml = readFileSync(join(__dirname, "../frontend/index.html"), "utf-8");
const updatedHtml = rawHtml
  .replace("<!-- style-placeholder -->", `<link rel="stylesheet" href="/assets/${cssFilename}">`)
  .replace("<!-- assets-manifest-placeholder -->", `<script>window.assetsManifest = ${JSON.stringify(manifest)};</script>`)
  .replace("<!-- script-placeholder -->", `<script src="${manifest.app}" defer></script>`);

const minifiedHtml = updatedHtml
  .replace(/<!--[\s\S]*?-->/g, "") // remove HTML comments
  .replace(/>\s+</g, "><")         // remove spaces between tags
  .trim();

writeFileSync(join(PUBLIC_DIR, "index.html"), minifiedHtml, "utf-8");
console.log(`📝 Created index.html (${minifiedHtml.length} bytes)`);

// 5. Brotli + Gzip pre-compression helper
function compressFile(filePath: string) {
  const fileContent = readFileSync(filePath);
  
  // gzip sync
  const gzipData = zlib.gzipSync(fileContent, { level: 9 });
  writeFileSync(filePath + ".gz", gzipData);

  // brotli sync
  const brotliData = zlib.brotliCompressSync(fileContent, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
    }
  });
  writeFileSync(filePath + ".br", brotliData);
}

console.log("🗜️ Pre-compressing files with Gzip & Brotli...");

// Compress HTML
compressFile(join(PUBLIC_DIR, "index.html"));

// Compress JS & CSS in assets
const assetFiles = readdirSync(ASSETS_DIR);
for (const file of assetFiles) {
  if (file.endsWith(".js") || file.endsWith(".css")) {
    compressFile(join(ASSETS_DIR, file));
  }
}
console.log("🗜️ Pre-compression complete!");

// 6. Size Budget Check (Initial Transfer: HTML + CSS + JS, Brotli-based)
const htmlBrSize = readFileSync(join(PUBLIC_DIR, "index.html.br")).length;
const cssBrSize = readFileSync(join(ASSETS_DIR, cssFilename + ".br")).length;

const appJsFilename = manifest.app.split("/").pop() || "";
const appJsBrSize = readFileSync(join(ASSETS_DIR, appJsFilename + ".br")).length;

const totalInitialBrotliSize = htmlBrSize + cssBrSize + appJsBrSize;

console.log("\n=================================");
console.log("📊 INITIAL ASSETS SIZE BUDGET (Brotli):");
console.log(` - index.html.br:       ${htmlBrSize} bytes`);
console.log(` - ${cssFilename}.br:  ${cssBrSize} bytes`);
console.log(` - ${appJsFilename}.br:    ${appJsBrSize} bytes`);
console.log("---------------------------------");
console.log(` TOTAL BUDGET SIZE:     ${totalInitialBrotliSize} bytes (${(totalInitialBrotliSize / 1024).toFixed(2)} KB)`);
console.log("=================================\n");

const BUDGET_LIMIT = 20 * 1024; // 20KB = 20480 bytes
if (totalInitialBrotliSize > BUDGET_LIMIT) {
  console.error(`❌ BUDGET EXCEEDED! Initial transfer size (${totalInitialBrotliSize} bytes) exceeds 20KB limit.`);
  process.exit(1);
} else {
  console.log("✅ BUDGET PASSED! Initial transfer size is within 20KB.");
}

console.log("✨ Build process successfully complete.");
