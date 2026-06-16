const fs = require('fs');
let code = fs.readFileSync('script.js', 'utf8');

// We know the problematic code starts around line 6200.
// We can just replace all \` with ` and \${ with ${
code = code.replace(/\\`/g, '`');
code = code.replace(/\\\${/g, '${');

fs.writeFileSync('script.js', code, 'utf8');
console.log("Syntax fixed");
