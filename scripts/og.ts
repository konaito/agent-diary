// SNSのカードに出す画像 docs/og.png を scripts/og.html から撮り直す。
// 使い方: bun run build:og（Chrome の場所は環境変数 CHROME で変えられる）
import { fileURLToPath } from "node:url";

const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const src = new URL("./og.html", import.meta.url).href;
const out = fileURLToPath(new URL("../docs/og.png", import.meta.url));

const proc = Bun.spawnSync([
  chrome,
  "--headless",
  "--disable-gpu",
  "--hide-scrollbars",
  "--force-device-scale-factor=1",
  "--window-size=1200,630",
  // Google Fonts の読み込みを待つ。待たないと日本語とアイコンが既定の書体のまま撮られる
  "--virtual-time-budget=10000",
  `--screenshot=${out}`,
  src,
], { stdout: "inherit", stderr: "pipe" });
if (proc.exitCode !== 0) {
  console.error(proc.stderr.toString());
  process.exit(proc.exitCode ?? 1);
}
console.log(out);
