const fs = require('fs');

const scriptPath = 'c:/Users/usuario/Documents/VISOR/script.js';
let scriptJs = fs.readFileSync(scriptPath, 'utf8');

const targetLogic = `
                    const coincide = (cantVisor === cantRayen);
                    if (!coincide) requiereJustificaciones = true;
`;

const newLogic = `
                    let coincide = false;
                    if (cantVisor === 0 && !matchEncontrado) {
                        // VISOR=0 y RAYEN=No listado (0) -> Coinciden, no se usó ni se listó.
                        coincide = true;
                    } else if (cantVisor === cantRayen) {
                        // VISOR y RAYEN coinciden en cantidad (ej: 5 y 5)
                        coincide = true;
                    } else {
                        // Discrepancia (ej: VISOR=5 y RAYEN=0/No listado, o VISOR=0 y RAYEN=5)
                        coincide = false;
                    }

                    if (!coincide) requiereJustificaciones = true;
`;

scriptJs = scriptJs.replace(targetLogic, newLogic);

fs.writeFileSync(scriptPath, scriptJs);
console.log("Cuadratura logic patched successfully.");
