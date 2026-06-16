const fs = require('fs');
let jsCode = fs.readFileSync('c:/Users/usuario/Documents/VISOR/script.js', 'utf8');

const regexOperatorReturn = /cantidad: \(insumoData\.cantidad \|\| 0\) \+ med\.cantidadRetornadaOperador/g;
if (regexOperatorReturn.test(jsCode)) {
    jsCode = jsCode.replace(regexOperatorReturn, 'cantidad: window.firebaseFirestore.increment(med.cantidadRetornadaOperador)');
    console.log("Patched operator return with increment.");
} else {
    console.log("Operator return regex not found.");
}

const regexCargaMasiva = /await updateDoc\(doc\(db, 'Insumos', existingDoc\.id\), \{\s*cantidad: \(existingData\.cantidad \|\| 0\) \+ item\.cantidad,\s*precio: item\.precio \|\| existingData\.precio/m;
if (regexCargaMasiva.test(jsCode)) {
    jsCode = jsCode.replace(regexCargaMasiva, `await updateDoc(doc(db, 'Insumos', existingDoc.id), {
                                cantidad: window.firebaseFirestore.increment(item.cantidad),
                                precio: item.precio || existingData.precio`);
    console.log("Patched Carga Masiva with increment.");
}

fs.writeFileSync('c:/Users/usuario/Documents/VISOR/script.js', jsCode);
console.log("File saved.");
