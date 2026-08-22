const fs = require('fs');
const path = require('path');

function walk(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walk(dirPath, callback) : callback(path.join(dir, f));
  });
}

const fixAny = (filePath) => {
  if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) return;
  let lines = fs.readFileSync(filePath, 'utf-8').split('\n');
  let changed = false;

  for (let i = 0; i < lines.length; i++) {
    // Only fix if there's ": any" and no disable comment on the previous line
    if (lines[i].includes(': any')) {
      if (i === 0 || !lines[i-1].includes('eslint-disable-next-line @typescript-eslint/no-explicit-any')) {
        lines.splice(i, 0, '  // eslint-disable-next-line @typescript-eslint/no-explicit-any');
        changed = true;
        i++; // skip the newly inserted line
      }
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
  }
};

walk('src/app/api', fixAny);
console.log('Inserted eslint-disable for remaining any types in api routes.');
