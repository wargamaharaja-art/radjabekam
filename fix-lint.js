const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function walk(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walk(dirPath, callback) : callback(path.join(dir, f));
  });
}

const fixAny = (filePath) => {
  if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) return;
  let content = fs.readFileSync(filePath, 'utf-8');
  let changed = false;

  // Fix catch (error: any) -> catch (error) or eslint disable
  if (content.includes('catch (error: any)')) {
    content = content.replace(/catch\s*\(error:\s*any\)/g, 'catch (error: unknown)');
    changed = true;
  }
  
  if (content.includes('error: any')) {
    // Sometimes it's inside a function param
    content = content.replace(/\(error:\s*any\)\s*=>/g, '(error: unknown) =>');
    changed = true;
  }

  // Next.js params: any
  if (content.includes('params: any')) {
    content = content.replace(/params:\s*any/g, 'params: { [key: string]: string }');
    changed = true;
  }

  if (content.includes('body: any')) {
    content = content.replace(/body:\s*any/g, 'body: unknown');
    changed = true;
  }
  
  if (content.includes('data: any')) {
    content = content.replace(/data:\s*any/g, 'data: unknown');
    changed = true;
  }

  // Any other : any that's common?
  // Let's just blindly add eslint disable for others if they are too hard, but let's stick to standard ones
  if (changed) {
    fs.writeFileSync(filePath, content, 'utf-8');
  }
};

walk('src/app/api', fixAny);
console.log('Fixed common any types.');
