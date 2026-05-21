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
    
    // Replace bg-deep-charcoal with bg-gray-200
    content = content.replace(/bg-deep-charcoal/g, 'bg-gray-200');
    content = content.replace(/text-gray-400/g, 'text-gray-600');
    content = content.replace(/border-white\/10/g, 'border-black/10');
    content = content.replace(/border-white\/14/g, 'border-black/14');
    content = content.replace(/border-white\/20/g, 'border-black/20');
    content = content.replace(/border-white\/30/g, 'border-black/30');

    if (content !== original) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`Updated ${filePath}`);
    }
  }
});
