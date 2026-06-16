const fs = require('fs');
let code = fs.readFileSync('c:/Users/usuario/Documents/VISOR/script.js', 'utf8');

// Find the start of the bad append
const searchString = 'window.abrirRecepcionOperador = async function';
const index = code.indexOf(searchString);

if (index !== -1) {
    code = code.substring(0, index);
    fs.writeFileSync('c:/Users/usuario/Documents/VISOR/script.js', code);
    console.log('Truncated successfully at index: ' + index);
} else {
    console.log('Not found');
}
