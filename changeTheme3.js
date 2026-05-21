import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const frontendDir = path.join(__dirname, 'frontend');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    if (isDirectory) {
      if (f !== 'node_modules' && f !== 'dist') {
        walkDir(dirPath, callback);
      }
    } else {
      callback(path.join(dir, f));
    }
  });
}

walkDir(frontendDir, function(filePath) {
  if (filePath.endsWith('.tsx') || filePath.endsWith('.ts') || filePath.endsWith('.css')) {
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;

    // ── Hardcoded very dark hex backgrounds ────────────────────────────────
    content = content.replace(/bg-\[#050505\]/g, 'bg-gray-50');
    content = content.replace(/bg-\[#070707\]/g, 'bg-gray-50');
    content = content.replace(/bg-\[#0A0A0A\]/g, 'bg-gray-100');
    content = content.replace(/bg-\[#0a0a0a\]/g, 'bg-gray-100');
    content = content.replace(/bg-\[#0D0D0D\]/g, 'bg-gray-100');
    content = content.replace(/bg-\[#111\]/g,     'bg-gray-100');
    content = content.replace(/bg-\[#111111\]/g,  'bg-gray-100');
    content = content.replace(/bg-\[#141414\]/g,  'bg-gray-100');
    content = content.replace(/bg-\[#161616\]/g,  'bg-gray-100');
    content = content.replace(/bg-\[#181818\]/g,  'bg-gray-100');
    content = content.replace(/bg-\[#1A1A1A\]/g,  'bg-gray-100');
    content = content.replace(/bg-\[#1a1a1a\]/g,  'bg-gray-100');
    content = content.replace(/bg-\[#222\]/g,      'bg-gray-100');
    content = content.replace(/bg-\[#222222\]/g,  'bg-gray-100');
    content = content.replace(/bg-\[#2D2D2D\]/g,  'bg-gray-200');
    content = content.replace(/bg-\[#2d2d2d\]/g,  'bg-gray-200');

    // ── Dark hardcoded hex with opacity ────────────────────────────────────
    content = content.replace(/bg-\[#070707\]\/90/g, 'bg-white/90');
    content = content.replace(/bg-\[#070707\]\/95/g, 'bg-white/95');
    content = content.replace(/bg-\[#2D2D2D\]\/45/g, 'bg-gray-100/70');
    content = content.replace(/bg-\[#2d2d2d\]\/45/g, 'bg-gray-100/70');
    content = content.replace(/bg-\[#2D2D2D\]\/55/g, 'bg-gray-100/80');
    content = content.replace(/bg-\[#2d2d2d\]\/55/g, 'bg-gray-100/80');

    // ── Dark utility classes ────────────────────────────────────────────────
    content = content.replace(/bg-black\/10/g,  'bg-gray-100/60');
    content = content.replace(/bg-black\/20/g,  'bg-gray-200/60');
    content = content.replace(/bg-black\/25/g,  'bg-gray-200/70');
    content = content.replace(/bg-black\/30/g,  'bg-gray-200/80');
    content = content.replace(/bg-black\/40/g,  'bg-gray-300/80');
    content = content.replace(/bg-black\/50/g,  'bg-gray-300/90');
    content = content.replace(/bg-black\/60/g,  'bg-gray-400/70');
    content = content.replace(/bg-black\/70/g,  'bg-gray-400/80');
    content = content.replace(/bg-black\/80/g,  'bg-gray-500/70');
    content = content.replace(/bg-black\/90/g,  'bg-gray-500/80');
    content = content.replace(/\bbg-black\b/g,  'bg-gray-800');

    // ── from/to dark gradients ─────────────────────────────────────────────
    content = content.replace(/from-\[#050505\]/g, 'from-gray-50');
    content = content.replace(/from-\[#070707\]/g, 'from-gray-50');
    content = content.replace(/from-\[#0A0A0A\]/g, 'from-gray-100');
    content = content.replace(/from-\[#111\]/g,    'from-gray-100');
    content = content.replace(/from-\[#1A1A1A\]/g, 'from-gray-100');
    content = content.replace(/to-\[#050505\]/g,   'to-gray-100');
    content = content.replace(/to-\[#0A0A0A\]/g,   'to-gray-100');
    content = content.replace(/to-\[#1A1A1A\]/g,   'to-gray-200');
    content = content.replace(/via-\[#0A0A0A\]/g,  'via-gray-50');

    // ── Dark text in some inline/hardcoded dark contexts ──────────────────
    content = content.replace(/text-stone-100/g,  'text-deep-charcoal');
    content = content.replace(/text-stone-200/g,  'text-deep-charcoal/80');
    content = content.replace(/text-stone-300/g,  'text-deep-charcoal/70');
    content = content.replace(/\btext-canvas-white\b/g, 'text-deep-charcoal');

    // ── White-on-dark bg-white/[0.0x] — flip to dark-on-light ────────────
    content = content.replace(/bg-white\/\[0\.02\]/g,  'bg-gray-100/40');
    content = content.replace(/bg-white\/\[0\.03\]/g,  'bg-gray-100/50');
    content = content.replace(/bg-white\/\[0\.04\]/g,  'bg-gray-100/60');
    content = content.replace(/bg-white\/\[0\.05\]/g,  'bg-gray-200/40');
    content = content.replace(/bg-white\/\[0\.06\]/g,  'bg-gray-200/50');
    content = content.replace(/bg-white\/\[0\.07\]/g,  'bg-gray-200/55');
    content = content.replace(/bg-white\/\[0\.08\]/g,  'bg-gray-200/60');
    content = content.replace(/bg-white\/\[0\.09\]/g,  'bg-gray-200/70');
    content = content.replace(/bg-white\/\[0\.10\]/g,  'bg-gray-200/80');
    content = content.replace(/hover:bg-white\/\[0\.06\]/g, 'hover:bg-gray-200/60');
    content = content.replace(/hover:bg-white\/\[0\.09\]/g, 'hover:bg-gray-200/80');

    // ── dark shadow colors ─────────────────────────────────────────────────
    content = content.replace(/rgba\(0,0,0,0\.75\)/g,    'rgba(0,0,0,0.12)');
    content = content.replace(/rgba\(0,0,0,0\.5\)/g,     'rgba(0,0,0,0.08)');
    content = content.replace(/rgba\(0,0,0,0\.45\)/g,    'rgba(0,0,0,0.08)');
    content = content.replace(/rgba\(0,0,0,0\.35\)/g,    'rgba(0,0,0,0.06)');

    // ── inset white gloss (dark mode artefact) → remove / make neutral ────
    content = content.replace(/shadow-\[inset_0_1px_0_rgba\(255,255,255,0\.06\)\]/g, 'shadow-[inset_0_1px_0_rgba(0,0,0,0.04)]');
    content = content.replace(/shadow-\[inset_0_0_0_1px_rgba\(255,255,255,0\.06\)\]/g, 'shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]');
    content = content.replace(/shadow-\[inset_0_0_0_1px_rgba\(255,255,255,0\.05\)\]/g, 'shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05)]');

    // ── CSS file: scrollbar dark → light ──────────────────────────────────
    if (filePath.endsWith('.css')) {
      content = content.replace(
        /scrollbar-color: rgba\(255, 255, 255, 0\.14\) rgba\(255, 255, 255, 0\.03\);/g,
        'scrollbar-color: rgba(0, 0, 0, 0.18) rgba(0, 0, 0, 0.04);'
      );
      content = content.replace(
        /background: rgba\(255, 255, 255, 0\.02\);/g,
        'background: rgba(0, 0, 0, 0.03);'
      );
      content = content.replace(
        /background: rgba\(255, 255, 255, 0\.12\);/g,
        'background: rgba(0, 0, 0, 0.15);'
      );
      content = content.replace(
        /background: rgba\(255, 255, 255, 0\.22\);/g,
        'background: rgba(0, 0, 0, 0.22);'
      );
      content = content.replace(
        /background-color: rgba\(255, 255, 255, 0\.05\);/g,
        'background-color: rgba(0, 0, 0, 0.04);'
      );
      // luxury-field color-scheme: dark → light
      content = content.replace(/color-scheme: dark;/g, 'color-scheme: light;');
      // Scrollbar border dark → light
      content = content.replace(
        /border: 1\.5px solid rgba\(0, 0, 0, 0\.4\);/g,
        'border: 1.5px solid rgba(0, 0, 0, 0.12);'
      );
    }

    if (content !== original) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`✓ ${path.relative(frontendDir, filePath)}`);
    }
  }
});

console.log('\n✅ Light theme conversion complete.');
