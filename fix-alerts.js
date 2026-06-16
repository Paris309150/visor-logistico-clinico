const fs = require('fs');

let code = fs.readFileSync('script.js', 'utf8');

// Replace standard alerts with strings
code = code.replace(/alert\((['"`])([^`'"]+)\1\)/g, 'window.showAlertCenter("Notificación", $1$2$1)');

// Replace alerts with template literals or variables
code = code.replace(/alert\((.+?)\)/g, (match, inner) => {
    // If it already contains window.showAlertCenter, skip it
    if (inner.includes('window.showAlertCenter')) return match;
    // If it's a known non-string alert (like error.message)
    if (inner.includes('error.message') || inner.includes('e.message') || inner.includes('err.message')) {
         return `window.showAlertCenter("Error", ${inner}, true)`;
    }
    // Default fallback
    return `window.showAlertCenter("Mensaje del Sistema", ${inner})`;
});

// Remove the Cormumel restriction completely!
const cormumelRegex = /if\s*\(!correo\.toLowerCase\(\)\.endsWith\('@cormumel\.cl'\)\)\s*\{[\s\S]*?return;\s*\}/g;
code = code.replace(cormumelRegex, '');

// Fix auth.currentUser check in cargarSelectEnfermeros
const cargarSelectEnfermerosRegex = /window\.cargarSelectEnfermeros\s*=\s*async\s*function\s*\(\)\s*\{/;
code = code.replace(cargarSelectEnfermerosRegex, 'window.cargarSelectEnfermeros = async function() {\n        if (!auth || !auth.currentUser) return;\n');

// Hook cargarSelectEnfermeros inside onAuthStateChanged
code = code.replace(/(await window\.enforceRBACLogic\(user\);)/, '$1\n            if (window.cargarSelectEnfermeros) window.cargarSelectEnfermeros();');

fs.writeFileSync('script.js', code, 'utf8');
console.log("Alerts replaced and auth check added.");
