/**
 * Copies the built web app from StockM.Web/dist/ into StockM.Android/dist/
 * Also injects PWA manifest and icon for the Android wrapper.
 */
const fs = require('fs');
const path = require('path');

const WEB_DIST = path.resolve(__dirname, '../../StockM.Web/dist');
const ANDROID_DIST = path.resolve(__dirname, '../dist');
const ANDROID_ROOT = path.resolve(__dirname, '..');

function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 1. Check web build exists
if (!fs.existsSync(WEB_DIST)) {
  console.error('ERROR: StockM.Web/dist/ not found. Run "npm run build:web" first.');
  process.exit(1);
}

// 2. Clean and copy
if (fs.existsSync(ANDROID_DIST)) {
  fs.rmSync(ANDROID_DIST, { recursive: true });
}
copyDirSync(WEB_DIST, ANDROID_DIST);

// 3. Inject PWA manifest into dist/
const manifestSrc = path.join(ANDROID_ROOT, 'manifest.json');
if (fs.existsSync(manifestSrc)) {
  fs.copyFileSync(manifestSrc, path.join(ANDROID_DIST, 'manifest.json'));
}

// 4. Inject app icon into dist/
const iconSrc = path.join(ANDROID_ROOT, 'icon-512.svg');
if (fs.existsSync(iconSrc)) {
  fs.copyFileSync(iconSrc, path.join(ANDROID_DIST, 'icon-512.svg'));
}

// 5. Patch index.html to add PWA meta tags
const indexPath = path.join(ANDROID_DIST, 'index.html');
if (fs.existsSync(indexPath)) {
  let html = fs.readFileSync(indexPath, 'utf-8');
  if (!html.includes('manifest.json')) {
    html = html.replace(
      '<meta name="viewport"',
      `<link rel="manifest" href="/manifest.json" />
    <meta name="theme-color" content="#3b82f6" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="viewport"`
    );
    fs.writeFileSync(indexPath, html);
  }
}

console.log(`✅ Copied web build to StockM.Android/dist/ (${fs.readdirSync(ANDROID_DIST).length} items)`);
