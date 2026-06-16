const fs = require('fs');
let scriptJs = fs.readFileSync('script.js', 'utf8');

const injection = `
                if (data.estado === 'EN_USO' && document.body.getAttribute('data-user-role') === 'enfermero') {
                    html += \`
                        <div style="margin-top: 16px; display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; background: #f8f9fa; padding: 15px; border-radius: 8px; border: 1px solid #dee2e6;">
                            <button class="btn btn-outline-primary" onclick="window.abrirModalConsumo('\${docSnap.id}')" style="font-weight: 500;">
                                <i class="ph ph-pill"></i> Registrar Consumo / Merma
                            </button>
                            <button class="btn btn-warning" onclick="window.abrirCierreTurno('\${docSnap.id}')" style="font-weight: bold; background: #ffc107; color: #000;">
                                <i class="ph ph-lock-key"></i> Cuadratura y Cierre de Turno
                            </button>
                        </div>
                    \`;
                }

                if (data.estado === 'CREADA') {`;

scriptJs = scriptJs.replace("if (data.estado === 'CREADA') {", injection);
fs.writeFileSync('script.js', scriptJs);
console.log("Patched en-uso successfully.");
