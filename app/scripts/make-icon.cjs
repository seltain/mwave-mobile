// Значок приложения assets/icon.png (1024x1024) из assets/icon.svg.
// Рисует Electron из проекта ПК (../../music-circle-v2), как значок ПК: node scripts/make-icon.cjs
const { spawnSync } = require('node:child_process');
const path = require('node:path');

if (!process.versions.electron) {
  const electron = require(path.resolve(__dirname, '../../../music-circle-v2/node_modules/electron'));
  const r = spawnSync(electron, [__filename], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.disableHardwareAcceleration();
const SIZE = 1024;
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '..', 'assets', 'icon.svg'));
  const win = new BrowserWindow({ width: SIZE, height: SIZE, show: false, frame: false, useContentSize: true });
  const html = `<html><body style="margin:0;overflow:hidden"><img src="data:image/svg+xml;base64,${svg.toString('base64')}" width="${SIZE}" height="${SIZE}" style="display:block"></body></html>`;
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  await new Promise((r) => setTimeout(r, 200));
  let img = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
  if (img.getSize().width !== SIZE) img = img.resize({ width: SIZE, height: SIZE, quality: 'best' });
  fs.writeFileSync(path.join(__dirname, '..', 'assets', 'icon.png'), img.toPNG());
  console.log(`assets/icon.png ${img.getSize().width}x${img.getSize().height}`);
  app.quit();
});
