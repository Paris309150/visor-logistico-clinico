const fs = require('fs');
let code = fs.readFileSync('script.js', 'utf8');

const target1 = "if (userRole === 'operador' || userRole === 'operator') {";
const target2 = "document.body.setAttribute('data-user-role', 'operador');";
const target3 = "} else if (userRole === 'admin' || userRole === 'administrador' || userRole === 'global') {";

if (code.includes(target1) && code.includes(target3)) {
    code = code.replace(target3, "} else if (userRole === 'enfermero' || userRole === 'enfermera') {\\n                    document.body.setAttribute('data-user-role', 'enfermero');\\n                " + target3);
    fs.writeFileSync('script.js', code);
    console.log("Patched successfully with smaller target.");
} else {
    console.log("Target not found at all.");
}
