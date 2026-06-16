const fs = require('fs');

let lines = fs.readFileSync('script.js', 'utf8').split('\n');

let startIndex = -1;
let endIndex = -1;

for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('// Al cambiar la hash, iniciar los listeners de bandejas')) {
        startIndex = i;
    }
    if (startIndex !== -1 && i > startIndex && lines[i].includes('// ==========================================')) {
        endIndex = i - 1; // Delete up to the empty line before the comment
        break;
    }
}

if (startIndex !== -1 && endIndex !== -1) {
    lines.splice(startIndex, endIndex - startIndex + 1);
    fs.writeFileSync('script.js', lines.join('\n'), 'utf8');
    console.log("Removed redundant hashchange block.");
} else {
    console.log("Indices not found", startIndex, endIndex);
}
