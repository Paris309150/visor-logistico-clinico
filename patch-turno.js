const fs = require('fs');
let code = fs.readFileSync('script.js', 'utf8');

const injection = `
    // ==========================================
    // LOGICA DE TURNO (CONSUMO Y MERMA)
    // ==========================================
    window.abrirModalConsumo = async function(docId) {
        window._bandejaActivaId = docId;
        const select = document.getElementById('select-consumo-insumo');
        if (!select) return;
        
        try {
            const docRef = doc(db, 'Bandejas_Turno', docId);
            const docSnap = await getDoc(docRef);
            if (!docSnap.exists()) throw new Error("Bandeja no encontrada");
            
            const data = docSnap.data();
            select.innerHTML = '<option value="">Seleccione Fármaco...</option>';
            data.medicamentos.forEach(med => {
                select.innerHTML += \`<option value="\${med.nombreInsumo || med.nombre}" data-disponible="\${med.cantidadRecibida}">\${med.nombreInsumo || med.nombre} (Disp: \${med.cantidadRecibida})\</option>\`;
            });
            
            document.getElementById('input-consumo-cantidad').value = 1;
            document.getElementById('input-consumo-obs').value = '';
            document.getElementById('modal-consumo-bandeja').style.display = 'flex';
            
        } catch (error) {
            console.error(error);
            window.showToast('Error', 'Fallo al cargar bandeja.', 'error');
        }
    };

    document.addEventListener('click', async (e) => {
        if (e.target.closest('#btn-guardar-consumo')) {
            const select = document.getElementById('select-consumo-insumo');
            const tipo = document.getElementById('select-consumo-tipo').value;
            const cant = Number(document.getElementById('input-consumo-cantidad').value);
            const obs = document.getElementById('input-consumo-obs').value.trim();
            const docId = window._bandejaActivaId;
            
            if (!select.value || cant <= 0) {
                alert("Complete los campos obligatorios.");
                return;
            }
            
            const selectedOption = select.options[select.selectedIndex];
            const disp = Number(selectedOption.getAttribute('data-disponible'));
            if (cant > disp) {
                alert("No hay suficiente stock en la bandeja.");
                return;
            }

            try {
                const btn = e.target.closest('#btn-guardar-consumo');
                btn.disabled = true;
                btn.innerHTML = '<i class="ph-spinner ph-spin"></i> Registrando...';
                
                const docRef = doc(db, 'Bandejas_Turno', docId);
                await runTransaction(db, async (transaction) => {
                    const snap = await transaction.get(docRef);
                    if (!snap.exists()) throw new Error("La bandeja no existe.");
                    
                    let data = snap.data();
                    let meds = data.medicamentos;
                    let found = false;
                    for (let i=0; i<meds.length; i++) {
                        if ((meds[i].nombreInsumo || meds[i].nombre) === select.value) {
                            meds[i].cantidadRecibida -= cant;
                            found = true;
                            break;
                        }
                    }
                    
                    if(!found) throw new Error("Fármaco no encontrado en la bandeja.");
                    
                    // Crear registro en la subcoleccion de auditoria de la bandeja
                    const auditRef = doc(collection(docRef, 'Auditoria_Turno'));
                    transaction.set(auditRef, {
                        tipo: tipo,
                        farmaco: select.value,
                        cantidad: cant,
                        observacion: obs,
                        usuario: auth.currentUser.email,
                        fecha: serverTimestamp()
                    });
                    
                    transaction.update(docRef, { medicamentos: meds });
                });
                
                document.getElementById('modal-consumo-bandeja').style.display = 'none';
                window.showToast('Éxito', 'Salida registrada correctamente.', 'success');
                btn.disabled = false;
                btn.innerHTML = '<i class="ph ph-floppy-disk"></i> Registrar Salida';
            } catch (error) {
                console.error(error);
                alert("Error: " + error.message);
            }
        }
    });

    window.abrirCierreTurno = function(docId) {
        window._bandejaActivaId = docId;
        const inputExcel = document.getElementById('input-excel-cierre');
        if (inputExcel) inputExcel.value = '';
        const res = document.getElementById('resultado-cuadratura');
        if (res) res.style.display = 'none';
        const btn = document.getElementById('btn-finalizar-turno');
        if (btn) btn.style.display = 'none';
        
        document.getElementById('modal-cierre-turno').style.display = 'flex';
    };

    document.addEventListener('change', async (e) => {
        if (e.target.id === 'input-excel-cierre') {
            const file = e.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = async function(e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, {type: 'array'});
                    const sheet = workbook.Sheets[workbook.SheetNames[0]];
                    const json = XLSX.utils.sheet_to_json(sheet);
                    
                    console.log("Excel leido:", json);
                    
                    // Por ahora solo mostrar un mensaje genérico porque necesitamos saber el formato del usuario
                    const res = document.getElementById('resultado-cuadratura');
                    res.style.display = 'block';
                    res.innerHTML = \`<p style="color:var(--success);">✅ Excel cargado correctamente (\${json.length} filas procesadas). Pendiente cruce inteligente de columnas.</p>\`;
                    
                    // Habilitar cierre
                    document.getElementById('btn-finalizar-turno').style.display = 'inline-block';
                    window._excelData = json;
                    
                } catch(err) {
                    alert("Error leyendo Excel: " + err.message);
                }
            };
            reader.readAsArrayBuffer(file);
        }
    });

    document.addEventListener('click', async (e) => {
        if (e.target.closest('#btn-finalizar-turno')) {
            const docId = window._bandejaActivaId;
            if(!docId) return;
            if(!confirm("¿Está seguro de cerrar el turno y enviar la bandeja a Bodega Central?")) return;
            
            try {
                const btn = e.target.closest('#btn-finalizar-turno');
                btn.disabled = true;
                btn.innerHTML = '<i class="ph-spinner ph-spin"></i> Finalizando...';
                
                const docRef = doc(db, 'Bandejas_Turno', docId);
                await updateDoc(docRef, {
                    estado: 'CERRADA_ENFERMERIA',
                    fechaCierre: serverTimestamp(),
                    excelJSON: JSON.stringify(window._excelData || [])
                });
                
                document.getElementById('modal-cierre-turno').style.display = 'none';
                window.showToast('Turno Cerrado', 'La bandeja ha sido devuelta a Bodega Central.', 'success');
                btn.disabled = false;
                btn.innerHTML = '🔒 Entregar Bandeja a Bodega';
            } catch (error) {
                console.error(error);
                alert("Error: " + error.message);
            }
        }
    });

    // ==========================================
`;

const targetAnchor = `    // ==========================================
    // KARDEX CLÍNICO INTERACTIVO (TRAZABILIDAD)`;

if (code.includes(targetAnchor)) {
    code = code.replace(targetAnchor, injection + "\\n" + targetAnchor);
    fs.writeFileSync('script.js', code);
    console.log("Patched logic Turno successfully.");
} else {
    console.log("Anchor not found.");
}
