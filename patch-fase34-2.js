const fs = require('fs');

const scriptPath = 'c:/Users/usuario/Documents/VISOR/script.js';
let scriptJs = fs.readFileSync(scriptPath, 'utf8');

const newLogic = `
// ==========================================
// FASE 34: LÓGICA DE SOBRECONSUMO Y GUARDADO
// ==========================================

window.validarSobreconsumo = function(input, docId, idx) {
    const consumido = Number(input.value);
    const asignado = Number(input.getAttribute('data-asignado'));
    const obsInput = document.getElementById(\`obs-consumo-\${docId}-\${idx}\`);
    
    if (!obsInput) return;
    
    if (consumido > asignado) {
        obsInput.style.display = 'block';
        obsInput.required = true;
        obsInput.style.border = '2px solid #dc3545';
        if (!obsInput.value) {
            obsInput.placeholder = 'DEBE justificar este exceso...';
        }
    } else {
        obsInput.style.display = 'none';
        obsInput.required = false;
        obsInput.style.border = '1px solid #ced4da';
        obsInput.value = ''; // Limpiar si vuelve a la normalidad
    }
};

window.guardarProgresoBandeja = async function(docId) {
    try {
        const docRef = window.firebaseFirestore.doc(window.firebaseFirestore.db || window.db || db, 'Bandejas_Turno', docId);
        const snap = await window.firebaseFirestore.getDoc(docRef);
        if (!snap.exists()) {
            throw new Error("La bandeja no existe.");
        }
        
        const data = snap.data();
        let hasError = false;
        
        const medicamentosActualizados = data.medicamentos.map((med, idx) => {
            const inputConsumo = document.getElementById(\`consumo-\${docId}-\${idx}\`);
            const inputObs = document.getElementById(\`obs-consumo-\${docId}-\${idx}\`);
            
            if (inputConsumo) {
                const consumido = Number(inputConsumo.value);
                const asignado = Number(inputConsumo.getAttribute('data-asignado'));
                let obs = med.observacionAdicional || '';
                
                if (inputObs && inputObs.style.display !== 'none') {
                    obs = inputObs.value.trim();
                    if (consumido > asignado && obs === '') {
                        hasError = true;
                        inputObs.focus();
                    }
                }
                
                return {
                    ...med,
                    cantidadConsumida: consumido,
                    observacionAdicional: obs
                };
            }
            return med; // Fallback
        });
        
        if (hasError) {
            window.showToast("Error", "Debe justificar los insumos donde el consumo exceda lo asignado.", "error");
            return;
        }
        
        await window.firebaseFirestore.updateDoc(docRef, {
            medicamentos: medicamentosActualizados,
            fechaUltimoGuardado: window.firebaseFirestore.serverTimestamp()
        });
        
        window.showToast("Éxito", "Progreso guardado correctamente.", "success");
        
    } catch (err) {
        console.error("Error al guardar progreso:", err);
        window.showToast("Error", err.message, "error");
    }
};
`;

if (!scriptJs.includes('window.guardarProgresoBandeja = async function')) {
    fs.appendFileSync(scriptPath, '\n' + newLogic);
    console.log("Appended new logic successfully.");
} else {
    console.log("guardarProgresoBandeja already exists.");
}
