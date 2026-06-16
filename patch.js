const fs = require('fs');
let code = fs.readFileSync('script.js', 'utf8');
code = code.replace("const userRole = (userData.role || '').toLowerCase().trim();", "const userRole = (userData.rol || userData.role || '').toLowerCase().trim();");
fs.writeFileSync('script.js', code);
console.log("Patched!");
