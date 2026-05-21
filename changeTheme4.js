import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.join(__dirname, 'frontend');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    const dirPath = path.join(dir, f);
    const isDirectory = fs.statSync(dirPath).isDirectory();
    if (isDirectory) {
      if (f !== 'node_modules' && f !== 'dist') walkDir(dirPath, callback);
    } else {
      callback(path.join(dir, f));
    }
  });
}

walkDir(frontendDir, function(filePath) {
  if (!filePath.endsWith('.tsx') && !filePath.endsWith('.ts') && !filePath.endsWith('.css')) return;

  let content = fs.readFileSync(filePath, 'utf8');
  const original = content;

  // ── Dashboard sidebar/header dark hex ─────────────────────────────────
  content = content.replace(/bg-\[#080808\]\/95/g, 'bg-white/95');
  content = content.replace(/bg-\[#080808\]\/80/g, 'bg-white/80');
  content = content.replace(/bg-\[#080808\]\/60/g, 'bg-white/60');
  content = content.replace(/\bbg-\[#080808\]\b/g, 'bg-white');

  // ── Checkout / misc very dark ──────────────────────────────────────────
  content = content.replace(/bg-\[#090909\]\/90/g, 'bg-gray-50/90');
  content = content.replace(/\bbg-\[#090909\]\b/g, 'bg-gray-50');
  content = content.replace(/bg-\[#0c0a09\]/g,     'bg-gray-50');

  // ── Error/danger surfaces: dark red → light red ───────────────────────
  // bg-[#120809] is the dark-mode "error" surface; replace with light red
  content = content.replace(/bg-\[#120809\]\/90/g, 'bg-red-50/90');
  content = content.replace(/bg-\[#120809\]\/80/g, 'bg-red-50/80');
  content = content.replace(/bg-\[#120809\]\/75/g, 'bg-red-50/75');
  content = content.replace(/bg-\[#120809\]\/60/g, 'bg-red-50/60');
  content = content.replace(/bg-\[#120809\]\/55/g, 'bg-red-50/55');
  content = content.replace(/bg-\[#120809\]\/45/g, 'bg-red-50/45');
  content = content.replace(/\bbg-\[#120809\]\b/g, 'bg-red-50');

  // ── Error text: keep readable on light red ────────────────────────────
  content = content.replace(/text-\[#f87171\]\/90/g, 'text-red-600/90');
  content = content.replace(/text-\[#f87171\]\/80/g, 'text-red-600/80');
  content = content.replace(/\btext-\[#f87171\]\b/g, 'text-red-600');
  content = content.replace(/hover:text-\[#fca5a5\]/g, 'hover:text-red-500');

  // ── Error border: dark wine → light red ──────────────────────────────
  content = content.replace(/border-\[#7f1d1d\]\/60/g, 'border-red-400/60');
  content = content.replace(/border-\[#7f1d1d\]\/55/g, 'border-red-400/55');
  content = content.replace(/border-\[#7f1d1d\]\/45/g, 'border-red-400/45');
  content = content.replace(/\bborder-\[#7f1d1d\]\b/g, 'border-red-400');

  // ── Error shadow dark red → softer ───────────────────────────────────
  content = content.replace(/rgba\(127,29,29,0\.2\)/g, 'rgba(220,38,38,0.12)');

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✓ ${path.relative(frontendDir, filePath)}`);
  }
});

console.log('\n✅ Phase-2 light theme complete.');
