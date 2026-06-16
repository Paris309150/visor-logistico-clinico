const fs = require('fs');

let lines = fs.readFileSync('script.js', 'utf8').split('\n');

// 1. Find where to inject the delegated logic:
// We look for the end of the `if (e.target.closest('#btn-pre-despacho')) {` block
let injectIndex = -1;
for(let i=0; i<lines.length; i++) {
    if (lines[i].includes("if (modalResumen) modalResumen.style.display = 'flex';")) {
        injectIndex = i + 2; // Right after `        }` which is at i+1
        break;
    }
}

const delegatedLogic = `
        // E) Ejecución Final (Descuento de Stock) Delegado Globalmente
        if (e.target.closest('#btn-ejecutar-despacho-final')) {
            e.preventDefault();
            const btnFinal = e.target.closest('#btn-ejecutar-despacho-final');
            if(btnFinal.disabled) return;

            const selectBandeja = document.getElementById('select-numero-bandeja');
            const inputEnfermero = document.getElementById('select-enfermero-asignado');
            const valorSelect = selectBandeja ? selectBandeja.value : '';
            const valorEmail = inputEnfermero ? inputEnfermero.value.trim() : '';
            const itemsAEnviar = window._bandejaActualItemsTemporal || [];

            console.log("Clic Sí Aceptar", itemsAEnviar);

            if (itemsAEnviar.length === 0) {
                window.showAlertCenter("Notificación", "No hay items para despachar.");
                return;
            }

            try {
                btnFinal.disabled = true;
                const originalText = btnFinal.innerHTML;
                btnFinal.innerHTML = '<i class="ph-spinner ph-spin"></i> Despachando...';

                // Buscar referencias
                const refsMap = [];
                for (const item of itemsAEnviar) {
                    const q = window.firebaseFirestore.query(
                        window.firebaseFirestore.collection(window.firebaseFirestore.db || window.db || db, 'Insumos'), 
                        window.firebaseFirestore.where('name', '==', item.nombreInsumo), 
                        window.firebaseFirestore.limit(1)
                    );
                    const snap = await window.firebaseFirestore.getDocs(q);
                    if (snap.empty) {
                        throw new Error(\`Fármaco "\${item.nombreInsumo}" no encontrado en inventario central.\`);
                    }
                    refsMap.push({ ref: snap.docs[0].ref, item: item });
                }

                // Transacción Atómica
                await window.firebaseFirestore.runTransaction(window.firebaseFirestore.db || window.db || db, async (transaction) => {
                    const updates = [];
                    for (const mapObj of refsMap) {
                        const insumoDoc = await transaction.get(mapObj.ref);
                        if (!insumoDoc.exists()) throw new Error(\`Documento no encontrado.\`);
                        const currentStock = Number(insumoDoc.data().quantity) || 0;
                        if (currentStock < mapObj.item.cantidadAsignada) {
                            throw new Error(\`Stock insuficiente para "\${mapObj.item.nombreInsumo}". Actual: \${currentStock}\`);
                        }
                        updates.push({
                            ref: mapObj.ref,
                            newQty: currentStock - mapObj.item.cantidadAsignada,
                            name: mapObj.item.nombreInsumo,
                            qty: mapObj.item.cantidadAsignada
                        });
                    }

                    const auth = window.firebaseAuth || window.auth || auth;
                    for (const update of updates) {
                        transaction.update(update.ref, {
                            quantity: update.newQty,
                            lastUpdated: window.firebaseFirestore.serverTimestamp()
                        });

                        const historyRef = window.firebaseFirestore.doc(window.firebaseFirestore.collection(window.firebaseFirestore.db || window.db || db, 'Historial_Movimientos'));
                        transaction.set(historyRef, {
                            type: 'DESPACHO_BANDEJA',
                            item: update.name,
                            quantity: update.qty,
                            user: auth.currentUser ? auth.currentUser.email : 'Sistema',
                            date: window.firebaseFirestore.serverTimestamp(),
                            origin: 'Bodega Central',
                            dest: \`Bandeja: \${valorSelect}\`
                        });
                    }

                    const bandejaRef = window.firebaseFirestore.doc(window.firebaseFirestore.collection(window.firebaseFirestore.db || window.db || db, 'Bandejas_Turno'));
                    transaction.set(bandejaRef, {
                        identificador: valorSelect,
                        enfermeroAsignado: valorEmail,
                        estado: 'CREADA',
                        fechaDespacho: window.firebaseFirestore.serverTimestamp(),
                        medicamentos: itemsAEnviar,
                        creadoPor: auth.currentUser ? auth.currentUser.email : 'Sistema'
                    });
                }).then(() => {
                    const modal = document.getElementById('modal-resumen-bandeja');
                    if (modal) modal.style.display = 'none';

                    const selectPlant = document.getElementById('select-tipo-plantilla');
                    const contenedorTabla = document.getElementById('contenedor-detalle-bandeja');
                    const tbody = document.getElementById('tabla-detalle-bandeja-body');

                    if (selectBandeja) selectBandeja.value = '';
                    if (selectPlant) selectPlant.value = '';
                    if (inputEnfermero) inputEnfermero.value = '';
                    if (contenedorTabla) contenedorTabla.style.display = 'none';
                    if (tbody) tbody.innerHTML = '';

                    btnFinal.disabled = false;
                    btnFinal.innerHTML = originalText;

                    window.showAlertCenter("Notificación", "Despacho Exitoso");
                    const tabMis = document.getElementById('tab-mis-bandejas');
                    if (tabMis) tabMis.click();
                });

            } catch (error) {
                console.error("Error al despachar bandeja:", error);
                window.showAlertCenter("Error", error.message, true);
                btnFinal.disabled = false;
                btnFinal.innerHTML = 'Sí, Aceptar';
            }
        }`;

if(injectIndex !== -1) {
    lines.splice(injectIndex, 0, delegatedLogic);
}

// 2. Remove old block from startBandejasModule
let startIndex = -1;
let endIndex = -1;
for(let i=0; i<lines.length; i++) {
    if (lines[i].includes('// 4. Ejecución Final (Descuento de Stock)')) {
        startIndex = i;
    }
    if (startIndex !== -1 && i > startIndex && lines[i].includes("window.startMisBandejasListener = async function () {")) {
        // Back up to the end of startBandejasModule
        for(let j=i; j>startIndex; j--) {
            if(lines[j].includes('};')) {
                endIndex = j - 1; // leave }; alone
                break;
            }
        }
        break;
    }
}

if(startIndex !== -1 && endIndex !== -1) {
    lines.splice(startIndex, endIndex - startIndex + 1);
}

fs.writeFileSync('script.js', lines.join('\n'), 'utf8');
console.log("Delegation injected and old logic removed.");
