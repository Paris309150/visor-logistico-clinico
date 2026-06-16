const fs = require('fs');

const FILE_PATH = 'c:/Users/usuario/Documents/VISOR/script.js';
let code = fs.readFileSync(FILE_PATH, 'utf8');

console.log("Aplicando fix de e.target.closest...");
// Regex para reemplazar e.target.closest por versin segura (operador ternario que retorna null si no existe)
// Ejemplo: e.target.closest('#algo') -> (e.target && typeof e.target.closest === "function" ? e.target.closest('#algo') : null)
// Evita reemplazar donde ya est parcheado.
let previousCode = code;
code = code.replace(/e\.target\.closest\(([^)]+)\)/g, (match, p1) => {
    // Si ya est envuelto, no lo tocamos
    if (match.includes('typeof e.target.closest')) return match;
    return `(e.target && typeof e.target.closest === "function" ? e.target.closest(${p1}) : null)`;
});
if (code !== previousCode) {
    console.log(" e.target.closest parcheado con xito.");
}

console.log("Aplicando generacin de Tracking en Despacho...");
const trackingRegex = /const bandejaRef = window\.firebaseFirestore\.doc\(window\.firebaseFirestore\.collection\(window\.firebaseFirestore\.db \|\| window\.db \|\| db, 'Bandejas_Turno'\)\);\s*transaction\.set\(bandejaRef, \{\s*estado: 'CREADA',/m;

const trackingReplacement = `const bandejaRef = window.firebaseFirestore.doc(window.firebaseFirestore.collection(window.firebaseFirestore.db || window.db || db, 'Bandejas_Turno'));
                    
                    const _now = new Date();
                    const _dd = String(_now.getDate()).padStart(2, '0');
                    const _mm = String(_now.getMonth() + 1).padStart(2, '0');
                    const _hh = String(_now.getHours()).padStart(2, '0');
                    const _min = String(_now.getMinutes()).padStart(2, '0');
                    const trackingNumber = \`BAN-\${_dd}\${_mm}-\${_hh}\${_min}\`;
                    
                    transaction.set(bandejaRef, {
                        tracking: trackingNumber,
                        creador: auth.currentUser.email,
                        estado: 'CREADA',`;

if (trackingRegex.test(code)) {
    code = code.replace(trackingRegex, trackingReplacement);
    console.log(" Tracking number y creador aadidos al writeBatch (transaction.set).");
} else {
    console.log("! No se encontr el bloque de creacin de Bandejas_Turno.");
}

console.log("Aplicando refactorizacin de vista Mis Bandejas Activas (Acorden)...");
// Como el bloque es grande y vara, vamos a buscar con expresiones regulares ms flexibles.
// Buscamos desde: `hasVisibleTrays = true;` hasta `div.innerHTML = html;`

const listMisBandejasStartRegex = /hasVisibleTrays = true;\s*const div = document\.createElement\('div'\);[\s\S]*?let html = `/m;
// Primero busquemos dnde empieza el onSnapshot de lista-mis-bandejas
const bandejasRenderStartRegex = /const div = document\.createElement\('div'\);\s*div\.className = 'data-table-card';\s*div\.style\.padding = '16px';[\s\S]*?div\.innerHTML = html;\s*container\.appendChild\(div\);/g;

const renderAccordionReplacement = `const div = document.createElement('div');
                    div.className = 'data-table-card';
                    div.style.marginBottom = '16px';
                    div.style.border = '1px solid #dee2e6';
                    div.style.borderRadius = '8px';
                    div.style.overflow = 'hidden';

                    const trackingDisplay = data.tracking || data.identificador || docSnap.id.substring(0, 8);
                    const creatorDisplay = data.creador || data.creadoPor || 'Desconocido';
                    const badgeBg = data.estado === 'CREADA' ? 'var(--warning)' : 'var(--success)';
                    
                    let html = \`
                        <!-- HEADER DEL ACORDEN -->
                        <div class="bandeja-accordion-header" style="background: #f8f9fa; padding: 15px 20px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; transition: background 0.2s;" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'block' : 'none';">
                            <div style="display: flex; flex-direction: column; gap: 4px;">
                                <strong style="font-size: 1.1em; color: #212529;">\${trackingDisplay}</strong>
                                <span class="text-muted" style="font-size: 0.85em;"><i class="ph ph-package"></i> ID Fsico: \${data.identificador || docSnap.id.substring(0,8)}</span>
                            </div>
                            <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
                                <span class="badge" style="background: \${badgeBg}; color: #000; font-weight: bold; padding: 6px 12px; border-radius: 20px;">\${data.estado}</span>
                                <small style="color: #6c757d;">Creada por: \${creatorDisplay}</small>
                            </div>
                        </div>
                        
                        <!-- BODY DEL ACORDEN (OCULTO POR DEFECTO) -->
                        <div class="bandeja-accordion-body" style="display: none; padding: 20px; border-top: 1px solid #dee2e6; background: white;">
                    \`;

                    try {
                        if (data.fechaCreacion) {
                            const dateStr = typeof data.fechaCreacion.toDate === 'function' ? data.fechaCreacion.toDate().toLocaleString() : String(data.fechaCreacion);
                            html += \`<div style="font-size:0.85em; color:#666; margin-bottom: 15px; display:flex; justify-content:space-between; align-items: center;">
                                <span><i class="ph ph-clock"></i> <strong>Fecha Creacin:</strong> \${dateStr}</span>
                                \${data.estado === 'CREADA' && currentRole !== 'enfermero' ? \`<button type="button" class="btn btn-outline-primary btn-sm" onclick="window.abrirGestionBandeja('\${docSnap.id}', '\${data.enfermeroAsignado}')"><i class="ph ph-gear"></i> Gestionar</button>\` : ''}
                            </div>\`;
                        }
                    } catch (e) { console.error("Error formatting date:", e); }

                    if (data.estado === 'ANULADA') {
                        html += \`<div style="color:red; margin-bottom:10px;"><strong>Bandeja Anulada</strong> (\${data.justificacionAnulacion || 'Sin justificar'})</div>\`;
                    }

                    if (data.insumos && data.insumos.length > 0) {
                        html += \`
                            <div class="table-responsive" style="border: 1px solid #dee2e6; border-radius: 8px; overflow: hidden; margin-bottom: 20px;">
                                <table class="table table-hover table-sm mb-0">
                                    <thead style="background: #f1f3f5;">
                                        <tr>
                                            <th>Frmaco / Insumo</th>
                                            <th style="text-align: center;">Stock Asignado</th>
                                            <th style="text-align: center; width: 120px;">Cant. Consumida</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                        \`;
                        
                        data.insumos.forEach((med, idx) => {
                            const maxVal = med.cantidadAsignada || 0;
                            const consumidoVal = med.cantidadConsumida !== undefined ? med.cantidadConsumida : 0;
                            const isEnUso = data.estado === 'EN_USO';
                            html += \`
                                <tr>
                                    <td>
                                        \${med.nombreInsumo || med.nombre}
                                        \${med.observacionAdicional ? \`<br><small class="text-muted">\${med.observacionAdicional}</small>\` : ''}
                                    </td>
                                    <td style="text-align: center; font-weight: bold;">\${maxVal}</td>
                                    <td style="text-align: center;">
                                        <input type="number" class="form-control input-consumo" 
                                            data-idx="\${idx}" 
                                            value="\${consumidoVal}" 
                                            min="0" max="\${maxVal}" 
                                            style="width: 80px; margin: 0 auto; text-align: center;"
                                            \${!isEnUso ? 'disabled' : ''}>
                                    </td>
                                </tr>
                            \`;
                        });
                        html += \`</tbody></table></div>\`;
                    }

                    // Acciones/Botones del Footer del Body
                    if (data.estado === 'CREADA') {
                        html += \`
                            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                                <button type="button" class="btn btn-primary" onclick="window.recibirBandejaEnfermero('\${docSnap.id}')">
                                    <i class="ph ph-check-circle"></i> Aceptar y Poner en Uso
                                </button>
                            </div>
                        \`;
                    } else if (data.estado === 'EN_USO') {
                        html += \`
                            <div style="display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap;">
                                <button type="button" class="btn btn-primary" onclick="window.guardarProgresoBandeja('\${docSnap.id}')">
                                    <i class="ph ph-floppy-disk"></i> Guardar Registro
                                </button>
                                <button type="button" class="btn btn-warning" onclick="window.abrirModalCuadratura('\${docSnap.id}', '\${trackingDisplay}')">
                                    <i class="ph ph-scales"></i> Terminar Turno y Cuadrar
                                </button>
                                <button type="button" class="btn btn-danger" onclick="window.finalizarTurnoBandeja('\${docSnap.id}')">
                                    <i class="ph ph-arrow-u-down-left"></i> Devolver a Bodega
                                </button>
                            </div>
                        \`;
                    }

                    html += \`</div>\`; // Cierra Body

                    div.innerHTML = html;
                    container.appendChild(div);`;

let accordionFound = false;
code = code.replace(bandejasRenderStartRegex, () => {
    accordionFound = true;
    return renderAccordionReplacement;
});

if (accordionFound) {
    console.log(" Acorden renderizado correctamente.");
} else {
    console.log("! No se encontr el bloque de renderizacin de bandejas para reemplazar.");
    // Fallback: Buscamos manualmente una firma muy clara
}

console.log("Inyectando cdigo del Excel Cross-Reference (Cruce)...");
const excelLogic = `
// ==========================================
// FASE 32: CRUCE INTELIGENTE (EXCEL - RAYEN)
// ==========================================
window.abrirModalCuadratura = function(docId, nombreBandeja) {
    window._bandejaCuadraturaActiva = docId;
    document.getElementById('cuadratura-bandeja-nombre').textContent = nombreBandeja;
    document.getElementById('contenedor-resultado-cruce').style.display = 'none';
    document.getElementById('btn-procesar-cierre-final').disabled = true;
    document.getElementById('input-excel-rayen').value = ''; // Limpiar
    document.getElementById('modal-cuadratura-turno').style.display = 'flex';
};

document.addEventListener('change', async (e) => {
    if ((e.target && typeof e.target.closest === "function" ? e.target.closest('#input-excel-rayen') : null)) {
        const file = e.target.files[0];
        if (!file) return;

        if (typeof XLSX === 'undefined') {
            window.showToast("Error", "Librera XLSX no cargada. Revise su conexin o recargue.", "error");
            return;
        }

        const reader = new FileReader();
        reader.onload = async function(event) {
            try {
                const data = new Uint8Array(event.target.result);
                const workbook = XLSX.read(data, {type: 'array'});
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const json = XLSX.utils.sheet_to_json(worksheet, {defval: ""});
                
                console.log("JSON Excel parseado:", json);
                
                // Procesar el cruce contra la base de datos
                const docId = window._bandejaCuadraturaActiva;
                if (!docId) return;
                
                const docRef = window.firebaseFirestore.doc(window.firebaseFirestore.db || window.db || db, 'Bandejas_Turno', docId);
                const snap = await window.firebaseFirestore.getDoc(docRef);
                if (!snap.exists()) {
                    window.showToast("Error", "Bandeja no existe", "error");
                    return;
                }
                
                const bandeja = snap.data();
                const insumosVisor = bandeja.insumos || [];
                const tbody = document.getElementById('tabla-cruce-body');
                tbody.innerHTML = '';
                
                window._resultadosCruceTemporal = [];
                let requiereJustificaciones = false;

                insumosVisor.forEach((itemVisor, idx) => {
                    const nombreVisor = (itemVisor.nombreInsumo || itemVisor.nombre || "").toLowerCase();
                    const cantVisor = itemVisor.cantidadConsumida || 0;
                    
                    // Buscar coincidencia fuzzy en Excel
                    let cantRayen = 0;
                    let matchEncontrado = false;
                    for (const fila of json) {
                        // Buscar propiedades que parezcan "Frmaco" o "Medicamento"
                        let nombreRayen = "";
                        let valorCant = 0;
                        for (const key in fila) {
                            const k = key.toLowerCase();
                            if (k.includes('frmaco') || k.includes('farmaco') || k.includes('medicamento') || k.includes('producto') || k.includes('insumo')) {
                                nombreRayen = String(fila[key]).toLowerCase();
                            }
                            if (k.includes('cant') || k.includes('total') || k.includes('realizada') || k.includes('solicitada')) {
                                const parseado = parseFloat(fila[key]);
                                if (!isNaN(parseado)) valorCant = parseado;
                            }
                        }
                        
                        if (nombreRayen && nombreVisor.includes(nombreRayen.substring(0,5)) || nombreRayen.includes(nombreVisor.substring(0,5))) {
                            cantRayen = valorCant;
                            matchEncontrado = true;
                            break;
                        }
                    }
                    
                    const coincide = (cantVisor === cantRayen);
                    if (!coincide) requiereJustificaciones = true;
                    
                    window._resultadosCruceTemporal.push({
                        ...itemVisor,
                        idxBandeja: idx,
                        usoVisor: cantVisor,
                        usoRayen: cantRayen,
                        coincide: coincide
                    });
                    
                    const tr = document.createElement('tr');
                    if (!coincide) {
                        tr.style.backgroundColor = '#ffe0e0';
                    } else {
                        tr.style.backgroundColor = '#e0ffe0';
                    }
                    
                    tr.innerHTML = \`
                        <td>\${itemVisor.nombreInsumo || itemVisor.nombre}</td>
                        <td style="text-align:center; font-weight:bold;">\${cantVisor}</td>
                        <td style="text-align:center; font-weight:bold;">\${matchEncontrado ? cantRayen : '<span class="text-muted">No listado</span>'}</td>
                        <td style="text-align:center;">\${coincide ? '🟢 OK' : '🔴 DIFF'}</td>
                        <td>
                            \${!coincide ? \`<input type="text" class="form-control justificacion-cruce form-control-sm" data-idx="\${idx}" placeholder="Motivo obligatorio..." required oninput="window.validarCierreCruce()">\` : \`<span class="text-muted">No requerida</span>\`}
                        </td>
                    \`;
                    tbody.appendChild(tr);
                });
                
                document.getElementById('contenedor-resultado-cruce').style.display = 'block';
                window.validarCierreCruce();
                
            } catch(e) {
                console.error(e);
                window.showToast("Error parsing Excel", e.message, "error");
            }
        };
        reader.readAsArrayBuffer(file);
    }
});

window.validarCierreCruce = function() {
    const inputs = document.querySelectorAll('.justificacion-cruce');
    let todasLlenas = true;
    inputs.forEach(input => {
        if (!input.value.trim()) todasLlenas = false;
    });
    document.getElementById('btn-procesar-cierre-final').disabled = !todasLlenas;
};

// Modificar el manejador para btn-procesar-cierre-final (o crearlo)
document.addEventListener('click', async (e) => {
    if ((e.target && typeof e.target.closest === "function" ? e.target.closest('#btn-procesar-cierre-final') : null)) {
        const btn = (e.target && typeof e.target.closest === "function" ? e.target.closest('#btn-procesar-cierre-final') : null);
        if (btn.disabled) return;
        
        btn.disabled = true;
        btn.innerHTML = '<i class="ph-spinner ph-spin"></i> Confirmando...';
        
        const docId = window._bandejaCuadraturaActiva;
        if (!docId) return;
        
        // Recopilar justificaciones
        const cruceFinalData = [];
        window._resultadosCruceTemporal.forEach(item => {
            let obs = "";
            if (!item.coincide) {
                const input = document.querySelector(\`.justificacion-cruce[data-idx="\${item.idxBandeja}"]\`);
                if(input) obs = input.value.trim();
            }
            cruceFinalData.push({
                nombreInsumo: item.nombreInsumo || item.nombre,
                usoVisor: item.usoVisor,
                usoRayen: item.usoRayen,
                coincide: item.coincide,
                justificacion: obs
            });
        });
        
        try {
            await window.firebaseFirestore.updateDoc(window.firebaseFirestore.doc(window.firebaseFirestore.db || window.db || db, 'Bandejas_Turno', docId), {
                estado: 'EN_RECEPCION',
                fechaCruce: window.firebaseFirestore.serverTimestamp(),
                cruceCierreTurno: cruceFinalData
            });
            window.showToast("xito", "Cruce realizado y bandeja enviada a bodega", "success");
            document.getElementById('modal-cuadratura-turno').style.display = 'none';
        } catch (error) {
            window.showToast("Error", error.message, "error");
        } finally {
            btn.innerHTML = '✔️ Confirmar Cierre y Devolver a Bodega';
            btn.disabled = false;
        }
    }
});
`;

if (!code.includes('window.abrirModalCuadratura')) {
    code += '\n' + excelLogic;
    console.log(" Lgica Excel aadida al final del archivo.");
}

fs.writeFileSync(FILE_PATH, code);
console.log(" script.js guardado exitosamente con todos los parches de Fase 32.");
