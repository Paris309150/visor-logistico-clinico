const fs = require('fs');

const jsCode = fs.readFileSync('./script.js', 'utf8');
const htmlCode = fs.readFileSync('./index.html', 'utf8');

// Regex to find document.getElementById('id')
const idRegex = /getElementById\(['"`](.*?)['"`]\)/g;
const idsInJs = new Set();
let match;
while ((match = idRegex.exec(jsCode)) !== null) {
  idsInJs.add(match[1]);
}

const missingIds = [];
for (const id of idsInJs) {
  // Simple check if id="..." exists in html
  const regex = new RegExp(`id=["']${id}["']`, 'i');
  if (!regex.test(htmlCode)) {
    missingIds.push(id);
  }
}

console.log("Missing IDs in index.html:");
console.log(missingIds.join('\n'));
