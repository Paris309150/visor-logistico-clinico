const fs = require('fs');

let lines = fs.readFileSync('script.js', 'utf8').split('\n');

// Find where modalEliminar.style.display = 'flex' is
let startIdx = -1;
let endIdx = -1;

for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("if (modalEliminar) modalEliminar.style.display = 'flex';")) {
        startIdx = i;
    }
    if (startIdx !== -1 && i > startIdx && lines[i].includes("// D) Pre-Despacho (Abrir Modal de Resumen)")) {
        endIdx = i;
        break;
    }
}

if (startIdx !== -1 && endIdx !== -1) {
    const fixedBlock = `            if (modalEliminar) modalEliminar.style.display = 'flex';
            return;
        }

        // C) Confirmar Eliminación (Auditoría en Firestore)
        if (e.target.closest('#btn-confirmar-eliminacion')) {
            e.preventDefault();
            if (window.filaAEliminar) {
                const nombreElement = window.filaAEliminar.querySelector('.insumo-nombre');
                let nombre = 'Desconocido';
                if (nombreElement) {
                    nombre = nombreElement.tagName === 'INPUT' ? nombreElement.value : nombreElement.textContent;
                }

                try {
                    // Remover visualmente AL INSTANTE para que no quede "pegado" visualmente si el backend falla
                    window.filaAEliminar.remove();
                    window.filaAEliminar = null;

                    await window.firebaseFirestore.addDoc(window.firebaseFirestore.collection(window.firebaseFirestore.db || window.db || db, 'Historial_Movimientos'), {
                        type: 'EDICION_PLANTILLA_BANDEJA',
                        item: nombre,
                        quantity: 0,
                        accion: 'Eliminado de la plantilla antes de despachar',
                        user: (window.firebaseAuth || window.auth || auth).currentUser ? (window.firebaseAuth || window.auth || auth).currentUser.email : 'Desconocido',
                        date: window.firebaseFirestore.serverTimestamp()
                    });
                } catch (error) {
                    console.error("Error al auditar la eliminación:", error);
                }

                const modalEliminar = document.getElementById('modal-eliminar-insumo');
                if (modalEliminar) modalEliminar.style.display = 'none';
            }
            return;
        }

`;

    lines.splice(startIdx, endIdx - startIdx, fixedBlock);
    fs.writeFileSync('script.js', lines.join('\n'), 'utf8');
    console.log("Fixed C block.");
} else {
    console.log("Indices not found", startIdx, endIdx);
}
