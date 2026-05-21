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
    
    // Replace bg-void-onyx with bg-canvas-white
    content = content.replace(/bg-void-onyx/g, 'bg-canvas-white');
    // Replace text-white or text-white/ with text-deep-charcoal
    content = content.replace(/text-white\/88/g, 'text-deep-charcoal/88');
    content = content.replace(/text-white\/70/g, 'text-deep-charcoal/70');
    content = content.replace(/text-white\/50/g, 'text-deep-charcoal/50');
    content = content.replace(/text-white\/40/g, 'text-deep-charcoal/40');
    content = content.replace(/text-white\/30/g, 'text-deep-charcoal/30');
    content = content.replace(/text-white\/20/g, 'text-deep-charcoal/20');
    content = content.replace(/text-white\/10/g, 'text-deep-charcoal/10');
    content = content.replace(/text-white/g, 'text-deep-charcoal');
    // Replace border-white/ with border-deep-charcoal/
    content = content.replace(/border-white\//g, 'border-deep-charcoal/');
    // Replace bg-matte-black with bg-canvas-white (or something similar like bg-white)
    content = content.replace(/bg-matte-black/g, 'bg-gray-100');
    // Replace bg-deep-charcoal with bg-gray-200
    // Wait, let's keep it simple first
    
    if (content !== original) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`Updated ${filePath}`);
    }
  }
});
