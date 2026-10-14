/**
 * 打包成单文件 HTML：把 matter.js、三个脚本和 6 张立绘全部内联进去，
 * 产出的 dist/奶蛋弹弓-单文件.html 可以直接双击打开、也可以随手发给别人。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFile(path.join(root, p), 'utf8');

const ASSETS = [
  'naidan_idle',
  'naidan_blink',
  'naidan_dash',
  'naidan_split',
  'naidan_bomb',
  'naidan_heavy',
  'naidan_milk',
  'naidan_back',
  'naidan_seek',
  'naiwa_angry',
  'naiwa_happy',
  'boss_idle',
  'boss_laugh',
];

// 真实音频素材（只有击败 boss 的那声大笑）：内联成 data URI，file:// 直接双击也能出声
const AUDIO = ['boss_laugh'];

const main = async () => {
  let html = await read('index.html');
  const inline = async (rel) => `<script>\n${await read(rel)}\n</script>`;

  html = html.replace('<script src="vendor/matter.min.js"></script>', await inline('vendor/matter.min.js'));
  html = html.replace('<script src="js/audio.js"></script>', await inline('js/audio.js'));
  html = html.replace('<script src="js/birds.js"></script>', await inline('js/birds.js'));

  const assets = {};
  for (const name of ASSETS) {
    const buf = await fs.readFile(path.join(root, 'assets', `${name}.png`));
    assets[name] = `data:image/png;base64,${buf.toString('base64')}`;
  }
  const audio = {};
  for (const name of AUDIO) {
    const buf = await fs.readFile(path.join(root, 'assets', `${name}.mp3`));
    audio[name] = `data:audio/mpeg;base64,${buf.toString('base64')}`;
  }
  const assetScript =
    `<script>window.INLINE_ASSETS=${JSON.stringify(assets)};window.INLINE_AUDIO=${JSON.stringify(audio)};</script>`;
  html = html.replace('<script src="js/levels.js"></script>', assetScript + '\n  ' + (await inline('js/levels.js')));
  html = html.replace('<script src="js/game.js"></script>', await inline('js/game.js'));

  await fs.mkdir(path.join(root, 'dist'), { recursive: true });
  const out = path.join(root, 'dist', '奶蛋弹弓-单文件.html');
  await fs.writeFile(out, html, 'utf8');
  const kb = Math.round((await fs.stat(out)).size / 1024);
  console.log(`打包完成 → ${out}  (${kb} KB)`);
};

main().catch((e) => { console.error(e); process.exit(1); });
