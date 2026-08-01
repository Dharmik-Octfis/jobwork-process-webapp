const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = dir + '/' + file;
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else if (file.endsWith('.tsx')) {
      results.push(file);
    }
  });
  return results;
}

const dirsToWalk = ['web/src/features', 'web/src/components'];
let allFiles = [];
dirsToWalk.forEach(dir => {
  allFiles = allFiles.concat(walk(dir));
});

allFiles.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;

  // Change margin for the asterisk
  if (content.includes("marginLeft: '4px'")) {
    content = content.replace(/marginLeft: '4px'/g, "marginLeft: '2px'");
    changed = true;
  }

  // Remove the <Info ... /> icons
  if (content.includes('<Info ')) {
    content = content.replace(/<Info[^>]*\/>/g, '');
    changed = true;
  }

  // We should also look for `<Info ` inside the file to remove unused imports
  if (changed) {
    if (!content.includes('<Info')) {
      content = content.replace(/import\s*\{\s*[^}]*Info[^}]*\}\s*from\s*'lucide-react';?\n?/g, (match) => {
        // If Info is the only import, remove the line
        if (match.split(',').length === 1 && !match.includes(' as ')) {
          return '';
        }
        // Otherwise, just remove Info from the import list
        return match.replace(/,\s*Info\b|\bInfo\s*,?/g, '');
      });
    }
    fs.writeFileSync(file, content);
    console.log('Updated:', file);
  }
});
