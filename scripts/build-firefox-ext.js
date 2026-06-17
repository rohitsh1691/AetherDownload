const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '../extension');
const destDir = path.join(__dirname, '../extension-firefox');

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (let entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

try {
  console.log('Syncing Firefox extension...');
  // Copy all files
  copyDir(srcDir, destDir);

  // Modify manifest.json for Firefox
  const manifestPath = path.join(destDir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    
    // For Firefox, background must only have "scripts", not "service_worker"
    if (manifest.background) {
      delete manifest.background.service_worker;
      manifest.background.scripts = ["background.js"];
    }
    
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    console.log('Firefox extension manifest prepared successfully in extension-firefox/');
  }
} catch (err) {
  console.error('Error building Firefox extension:', err);
}
