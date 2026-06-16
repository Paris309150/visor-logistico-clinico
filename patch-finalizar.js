const fs = require('fs');

let scriptJs = fs.readFileSync('script.js', 'utf8');

const target = `            if(!confirm("¿Está seguro de cerrar el turno y enviar la bandeja a Bodega Central?")) return;
            
            try {
                const btn = e.target.closest('#btn-finalizar-turno');
                btn.disabled = true;
                btn.innerHTML = '<i class="ph-spinner ph-spin"></i> Finalizando...';
                
                const docRef = doc(db, 'Bandejas_Turno', docId);
                await updateDoc(docRef, {
                    estado: 'CERRADA_ENFERMERIA',
                    fechaCierre: serverTimestamp(),
                    excelJSON: JSON.stringify(window._excelData || [])
                });`;

const replacement = `            if(!confirm("¿Está seguro de cerrar el turno y enviar la bandeja a Bodega Central?")) return;
            
            if (window._checkJustificaciones && !window._checkJustificaciones()) {
                alert("Debe completar todas las justificaciones obligatorias para las diferencias.");
                return;
            }
            
            try {
                const btn = e.target.closest('#btn-finalizar-turno');
                btn.disabled = true;
                btn.innerHTML = '<i class="ph-spinner ph-spin"></i> Finalizando...';
                
                const finalCruce = window._getMatchFinalData ? window._getMatchFinalData() : [];
                
                const docRef = doc(db, 'Bandejas_Turno', docId);
                await updateDoc(docRef, {
                    estado: 'CERRADA_ENFERMERIA',
                    fechaCierre: serverTimestamp(),
                    cruceCierreTurno: finalCruce,
                    excelRawLength: window._excelData ? window._excelData.length : 0
                });`;

if (scriptJs.includes(target)) {
    scriptJs = scriptJs.replace(target, replacement);
    fs.writeFileSync('script.js', scriptJs);
    console.log("Patched finalizar-turno.");
} else {
    console.log("Target not found");
}
