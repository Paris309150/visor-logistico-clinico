const fs = require('fs');
let code = fs.readFileSync('script_backup.js', 'utf8'); // Restore from before the bad edits
fs.writeFileSync('script.js', code);
console.log('Restored script.js');
