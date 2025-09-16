/* JavaScript */
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const INPUT_SVG = path.join(__dirname, "..", "icons", "presence-icon.svg"); // or presence-icon-dark.svg
const OUT_DIR = path.join(__dirname, "..", "icons");
const SIZES = [16, 32, 48, 128];

async function run() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const size of SIZES) {
    const out = path.join(OUT_DIR, `icon${size}.png`);
    await sharp(INPUT_SVG)
      .resize(size, size, { fit: "contain" })
      .png({ compressionLevel: 9 })
      .toFile(out);
    console.log("Generated", out);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
