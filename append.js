const fs = require('fs');
let code = fs.readFileSync('c:/Users/usuario/Documents/VISOR/patch-operator-recepcion.js', 'utf8');
const match = code.split('const operatorLogic = `')[1].split('`;')[0];
fs.appendFileSync('c:/Users/usuario/Documents/VISOR/script.js', '\n' + match);
console.log('Appended function successfully');
