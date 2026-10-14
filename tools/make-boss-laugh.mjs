/**
 * 裁出"击败 boss 的那声大笑" → assets/boss_laugh.mp3
 *
 * 原始文件：art-source/audio/naidan-laugh.wma（本地音乐文件，扩展名一度被误标成 .mp3，
 * 其实是 ASF/WMA 容器，而 **Chrome 不支持 WMA**，所以必须转码）。
 * 只取前几秒：单文件版要把音频 base64 内联进去，留 3 秒大约 36KB，留整段就要多十几倍。
 *
 * 依赖 ffmpeg-static（devDependency）。国内如果装不动（它的 postinstall 走 GitHub releases），
 * 换镜像再装：
 *   $env:FFMPEG_BINARIES_URL='https://registry.npmmirror.com/-/binary/ffmpeg-static'
 *   npm i -D ffmpeg-static
 *
 * 用法：node tools/make-boss-laugh.mjs [源文件] [秒数]
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2] || path.join(root, 'art-source', 'audio', 'naidan-laugh.wma');
const seconds = Number(process.argv[3] || 3);
const out = path.join(root, 'assets', 'boss_laugh.mp3');

const run = (args) =>
  new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { maxBuffer: 1 << 24 }, (err) => (err ? reject(err) : resolve()));
  });

const probe = (file) =>
  new Promise((resolve) => {
    execFile(ffmpegPath, ['-hide_banner', '-i', file], (err, stdout, stderr) => {
      const text = `${stdout || ''}${stderr || ''}`;
      const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(text);
      const audio = /Audio: ([^\n,]+), (\d+) Hz, (\w+)/.exec(text);
      resolve({
        duration: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : null,
        codec: audio ? audio[1] : null,
        hz: audio ? Number(audio[2]) : null,
        channels: audio ? audio[3] : null,
      });
    });
  });

const main = async () => {
  if (!ffmpegPath) throw new Error('没找到 ffmpeg-static，先跑 npm i');
  await fs.access(src).catch(() => {
    throw new Error(`源文件不在：${src}（原始素材不入库，需要先在本地放一份）`);
  });
  const info = await probe(src);
  console.log(`源：${path.relative(root, src)}  ${info.duration ? info.duration.toFixed(2) + ' 秒' : '时长未知'}  ${info.codec} ${info.hz}Hz ${info.channels}`);
  await fs.mkdir(path.dirname(out), { recursive: true });
  await run(['-y', '-hide_banner', '-loglevel', 'error', '-i', src, '-t', String(seconds), '-vn', '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '96k', out]);
  const outInfo = await probe(out);
  const size = (await fs.stat(out)).size;
  console.log(`→ ${path.relative(root, out)}  ${(size / 1024).toFixed(0)}KB  ${outInfo.duration.toFixed(2)} 秒  ${outInfo.codec} ${outInfo.hz}Hz 单声道`);
  console.log(`   （base64 内联后约 ${((size * 1.37) / 1024).toFixed(0)}KB）`);
};

main().catch((e) => { console.error('失败:', e.message); process.exit(1); });
