const fs = require('fs');

const scriptPath = 'c:/Users/usuario/Documents/VISOR/script.js';
let scriptJs = fs.readFileSync(scriptPath, 'utf8');

// The EN_USO table header
const targetHeader = `
                                            <th>Fármaco / Insumo</th>
                                            <th style="text-align: center;">Stock Asignado</th>
                                            <th style="text-align: center; width: 120px;">Cant. Consumida</th>
`;
const newHeader = `
                                            <th>Fármaco / Insumo</th>
                                            <th style="text-align: center;">Stock Asignado</th>
                                            <th style="text-align: center; width: 120px;">Cant. Consumida</th>
                                            <th style="text-align: center;">Justificación (Si Excede)</th>
`;

// The EN_USO table body
const targetRow = `
                                    <td style="text-align: center;">
                                        <input type="number" class="form-control input-consumo" 
                                            data-idx="\${idx}" 
                                            value="\${consumidoVal}" 
                                            min="0" max="\${maxVal}" 
                                            style="width: 80px; margin: 0 auto; text-align: center;"
                                            \${!isEnUso ? 'disabled' : ''}>
                                    </td>
`;
const newRow = `
                                    <td style="text-align: center;">
                                        <input type="number" class="form-control input-consumo" 
                                            id="consumo-\${docSnap.id}-\${idx}"
                                            data-idx="\${idx}" 
                                            data-asignado="\${maxVal}"
                                            value="\${consumidoVal}" 
                                            min="0"
                                            style="width: 80px; margin: 0 auto; text-align: center;"
                                            \${!isEnUso ? 'disabled' : ''}
                                            oninput="window.validarSobreconsumo(this, '\${docSnap.id}', \${idx})">
                                    </td>
                                    <td style="text-align: center;">
                                        <input type="text" class="form-control input-obs-consumo"
                                            id="obs-consumo-\${docSnap.id}-\${idx}"
                                            value="\${med.observacionAdicional || ''}"
                                            placeholder="Justifique el exceso..."
                                            style="display: \${consumidoVal > maxVal ? 'block' : 'none'};"
                                            \${!isEnUso ? 'disabled' : ''}>
                                    </td>
`;

scriptJs = scriptJs.replace(targetHeader, newHeader);
scriptJs = scriptJs.replace(targetRow, newRow);

fs.writeFileSync(scriptPath, scriptJs);
console.log("UI modified successfully.");
