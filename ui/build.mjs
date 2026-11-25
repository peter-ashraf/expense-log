import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');
const repoRoot = path.resolve(__dirname, '..');

const distHtml = path.join(distDir, 'index.html');
if (!fs.existsSync(distHtml)) {
  throw new Error('dist/index.html not found — run vite build first.');
}

fs.copyFileSync(distHtml, path.join(repoRoot, 'index.html'));

const distAssets = path.join(distDir, 'assets');
const rootAssets = path.join(repoRoot, 'assets');
fs.mkdirSync(rootAssets, { recursive: true });

if (fs.existsSync(distAssets)) {
  for (const name of fs.readdirSync(distAssets)) {
    fs.copyFileSync(path.join(distAssets, name), path.join(rootAssets, name));
  }
}

console.log('Published ui/dist -> ../index.html & ../assets/');
