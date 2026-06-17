const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Ensure dist directory exists
if (!fs.existsSync(path.join(__dirname, '../dist'))) {
  fs.mkdirSync(path.join(__dirname, '../dist'));
}

console.log('Starting development build and server...');

// Step 1: Run TypeScript compilation
console.log('Compiling TypeScript...');
const tsc = spawn('npx', ['tsc'], { shell: true, stdio: 'inherit' });

tsc.on('close', (code) => {
  if (code !== 0) {
    console.error('TypeScript compilation failed with code', code);
    process.exit(code);
  }
  
  console.log('TS compiled successfully! Launching dev server and Electron...');

  // Start TS compiler in watch mode
  const tscWatch = spawn('npx', ['tsc', '-w'], { shell: true });
  tscWatch.stdout.on('data', (data) => {
    const text = data.toString();
    if (text.includes('zero errors') || text.includes('Watching for file changes')) {
      console.log('[TSC] Compiled successfully.');
    }
  });

  // Start Vite dev server
  const vite = spawn('npx', ['vite'], { shell: true });
  vite.stdout.on('data', (data) => {
    const text = data.toString();
    console.log('[Vite]', text.trim());
    
    // Once Vite server starts, run Electron
    if (text.includes('Local:') || text.includes('3000')) {
      launchElectron();
    }
  });
  
  vite.stderr.on('data', (data) => {
    console.error('[Vite Error]', data.toString().trim());
  });
});

let electronProcess = null;

function launchElectron() {
  if (electronProcess) {
    electronProcess.kill();
  }

  console.log('Launching Electron...');
  electronProcess = spawn('npx', ['electron', '.'], { shell: true, stdio: 'inherit' });
  
  electronProcess.on('close', (code) => {
    console.log(`Electron closed with code ${code}`);
    process.exit(0);
  });
}

// Clean up processes on exit
process.on('exit', () => {
  if (electronProcess) electronProcess.kill();
});
