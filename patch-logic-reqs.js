const fs = require('fs');
let code = fs.readFileSync('script.js', 'utf8');

// 1. Secondary App for Auth
const appInitRegex = /export const auth = getAuth\(app\);/;
const secondaryAppCode = `export const auth = getAuth(app);
export const secondaryApp = initializeApp(firebaseConfig, "Secondary");
export const secondaryAuth = getAuth(secondaryApp);
`;
code = code.replace(appInitRegex, secondaryAppCode);

// 2. Cargar Enfermeros - we need to find where the `<select id="select-enfermero"` is populated.
// We'll search for "cargarEnfermeros" logic or the query for Usuarios.
// In index.html, there is: <select id="select-enfermero" class="form-control" required>
// In script.js it is populated when modal opens. Let's find "select-enfermero".

const selectEnfermeroRegex = /const qEnf = query\(collection\(db, 'Usuarios'\), where\('rol', 'in', \['enfermero', 'enfermera'\]\)\);/;
// Wait, if it doesn't match exactly, we'll just inject at the end of the file.

const finalLogic = `
// ==========================================
// NUEVOS REQUERIMIENTOS: USUARIOS Y BANDEJAS
// ==========================================
document.addEventListener('DOMContentLoaded', () => {

    // 1. Crear Enfermero de Reemplazo
    document.addEventListener('click', async (e) => {
        if (e.target.closest('#btn-crear-reemplazo-modal')) { // Botón que podríamos agregar al HTML, o lo ponemos arriba del select
            document.getElementById('modal-crear-reemplazo').style.display = 'flex';
        }
        
        if (e.target.closest('#btn-guardar-reemplazo')) {
            const btn = e.target.closest('#btn-guardar-reemplazo');
            const nombre = document.getElementById('reemplazo-nombre').value.trim();
            const email = document.getElementById('reemplazo-email').value.trim();
            const pass = document.getElementById('reemplazo-pass').value.trim();
            
            if(!nombre || !email || !pass) {
                alert("Completa todos los campos"); return;
            }
            
            btn.innerHTML = '<i class="ph-spinner ph-spin"></i> Creando...';
            btn.disabled = true;
            
            try {
                // Crear usuario en Secondary Auth para no desloguear
                const userCredential = await window.firebaseAuth.createUserWithEmailAndPassword(secondaryAuth, email, pass);
                const uid = userCredential.user.uid;
                
                // Guardar en Firestore
                await window.firebaseFirestore.setDoc(window.firebaseFirestore.doc(db, 'Usuarios', email), {
                    nombre: nombre,
                    rol: 'enfermero',
                    fechaCreacion: window.firebaseFirestore.serverTimestamp()
                });
                
                document.getElementById('modal-crear-reemplazo').style.display = 'none';
                window.showToast("Éxito", "Enfermero de reemplazo creado correctamente", "success");
                
                // Recargar select
                window.abrirModalDespacharBandeja(); // asumiendo que esta funcion recarga el select
            } catch (error) {
                console.error(error);
                alert("Error: " + error.message);
            } finally {
                btn.innerHTML = '<i class="ph ph-check"></i> Crear Usuario';
                btn.disabled = false;
            }
        }
    });

    // 2. Historial de Bandejas
    window.cambiarVista = window.cambiarVista || function() {};
    const oldCambiarVista = window.cambiarVista;
    window.cambiarVista = function(vistaId) {
        if(vistaId === 'historial-bandejas') {
            document.querySelectorAll('.view-section').forEach(el => el.style.display = 'none');
            document.querySelectorAll('.sidebar-menu li').forEach(el => el.classList.remove('active'));
            
            const v = document.getElementById('vista-historial-bandejas');
            if(v) v.style.display = 'block';
            const m = document.getElementById('menu-historial-bandejas');
            if(m) m.classList.add('active');
            
            cargarHistorialBandejas();
        } else {
            oldCambiarVista(vistaId);
        }
    };
    
    async function cargarHistorialBandejas() {
        const tbody = document.getElementById('lista-historial-bandejas');
        if(!tbody) return;
        tbody.innerHTML = '<tr><td colspan="6" class="text-center"><i class="ph-spinner ph-spin"></i> Cargando historial...</td></tr>';
        
        try {
            const q = window.firebaseFirestore.query(
                window.firebaseFirestore.collection(db, 'Bandejas_Turno'),
                window.firebaseFirestore.orderBy('fechaCreacion', 'desc')
            );
            const snap = await window.firebaseFirestore.getDocs(q);
            
            tbody.innerHTML = '';
            if(snap.empty) {
                tbody.innerHTML = '<tr><td colspan="6" class="text-center">No hay bandejas en el historial.</td></tr>';
                return;
            }
            
            snap.forEach(docSnap => {
                const data = docSnap.data();
                const fechaCrea = data.fechaCreacion ? data.fechaCreacion.toDate().toLocaleString() : 'N/A';
                const fechaMod = data.fechaRecepcionBodega ? data.fechaRecepcionBodega.toDate().toLocaleString() : 'N/A';
                
                let badgeColor = '#6c757d';
                if(data.estado === 'CREADA') badgeColor = 'var(--warning)';
                if(data.estado === 'EN_USO') badgeColor = 'var(--primary)';
                if(data.estado === 'CERRADA_ENFERMERIA') badgeColor = '#ffc107';
                if(data.estado === 'CERRADA_FINAL') badgeColor = 'var(--success)';
                if(data.estado === 'ANULADA') badgeColor = 'var(--danger)';
                
                let btnCruce = '';
                if(data.cruceCierreTurno) {
                    btnCruce = \`<button class="btn btn-sm btn-outline-primary" onclick="window.verCruceHistorico('\${docSnap.id}')" title="Ver Cruce RAYEN"><i class="ph ph-magnifying-glass"></i></button>\`;
                }
                
                tbody.innerHTML += \`
                    <tr>
                        <td>\${data.identificador || docSnap.id.substring(0,8)}</td>
                        <td>\${data.enfermeroAsignado}</td>
                        <td><span class="badge" style="background:\${badgeColor}; color:#fff;">\${data.estado}</span></td>
                        <td>\${fechaCrea}</td>
                        <td>\${fechaMod}</td>
                        <td>\${btnCruce}</td>
                    </tr>
                \`;
            });
            
        } catch(e) {
            console.error(e);
            tbody.innerHTML = '<tr><td colspan="6" class="text-danger">Error al cargar historial</td></tr>';
        }
    }
    
    // 3. Ver Cruce Histórico
    window.verCruceHistorico = async function(docId) {
        const modal = document.getElementById('modal-ver-cruce');
        const body = document.getElementById('body-ver-cruce');
        if(!modal || !body) return;
        
        try {
            const docRef = window.firebaseFirestore.doc(db, 'Bandejas_Turno', docId);
            const snap = await window.firebaseFirestore.getDoc(docRef);
            if(!snap.exists()) return;
            const data = snap.data();
            const cruceData = data.cruceCierreTurno || [];
            
            let cruceHtml = \`
                <div class="info-card info" style="margin-bottom: 15px;">
                    <strong>Bandeja:</strong> \${data.identificador || docId.substring(0,8)}<br>
                    <strong>Enfermero:</strong> \${data.enfermeroAsignado}
                </div>
                <div class="table-responsive">
                    <table class="table table-hover">
                        <thead style="background: #f8f9fa;">
                            <tr>
                                <th>Insumo</th>
                                <th>Consumo (Visor)</th>
                                <th>Solicitado (Rayen)</th>
                                <th>Estado</th>
                                <th>Justificación</th>
                            </tr>
                        </thead>
                        <tbody>
            \`;
            
            if (cruceData.length === 0) {
                cruceHtml += \`<tr><td colspan="5" class="text-center">No hay datos de cruce.</td></tr>\`;
            } else {
                cruceData.forEach(res => {
                    cruceHtml += \`
                        <tr style="background: \${res.color}15;">
                            <td><strong>V:</strong> \${res.visorName}<br><strong>R:</strong> \${res.rayenName}</td>
                            <td style="text-align: center;">\${res.consumidoVisor}</td>
                            <td style="text-align: center;">\${res.solicitadoRayen}</td>
                            <td><span class="badge" style="background: \${res.color}; color: #fff;">\${res.estado}</span></td>
                            <td>\${res.observacionCierre || 'N/A'}</td>
                        </tr>
                    \`;
                });
            }
            cruceHtml += \`</tbody></table></div>\`;
            body.innerHTML = cruceHtml;
            modal.style.display = 'flex';
        } catch(e) {
            console.error(e);
        }
    };
    
    // 4. Gestionar Bandeja Pendiente (Reasignar / Anular)
    window.abrirGestionBandeja = async function(docId, enfermeroActual) {
        window._gestionBandejaId = docId;
        const modal = document.getElementById('modal-gestionar-bandeja');
        if(!modal) return;
        
        // Cargar enfermeros en el select de reasignar
        const select = document.getElementById('select-reasignar-enfermero');
        select.innerHTML = '<option value="">Cargando...</option>';
        try {
            const q = window.firebaseFirestore.query(window.firebaseFirestore.collection(db, 'Usuarios'), window.firebaseFirestore.where('rol', 'in', ['enfermero', 'enfermera']));
            const snap = await window.firebaseFirestore.getDocs(q);
            select.innerHTML = '';
            snap.forEach(d => {
                const u = d.data();
                if(d.id !== enfermeroActual) {
                    select.innerHTML += \`<option value="\${d.id}">\${u.nombre || d.id}</option>\`;
                }
            });
        } catch(e) {}
        
        document.getElementById('div-reasignar-bandeja').style.display = 'block';
        document.getElementById('div-anular-bandeja').style.display = 'none';
        document.getElementById('input-anular-obs').value = '';
        
        modal.style.display = 'flex';
    };
    
    document.getElementById('tab-reasignar')?.addEventListener('click', () => {
        document.getElementById('div-reasignar-bandeja').style.display = 'block';
        document.getElementById('div-anular-bandeja').style.display = 'none';
    });
    document.getElementById('tab-anular')?.addEventListener('click', () => {
        document.getElementById('div-reasignar-bandeja').style.display = 'none';
        document.getElementById('div-anular-bandeja').style.display = 'block';
    });
    
    document.getElementById('btn-confirmar-reasignacion')?.addEventListener('click', async () => {
        const docId = window._gestionBandejaId;
        const nuevoEnf = document.getElementById('select-reasignar-enfermero').value;
        if(!docId || !nuevoEnf) return;
        
        try {
            await window.firebaseFirestore.updateDoc(window.firebaseFirestore.doc(db, 'Bandejas_Turno', docId), {
                enfermeroAsignado: nuevoEnf,
                fechaModificacion: window.firebaseFirestore.serverTimestamp()
            });
            document.getElementById('modal-gestionar-bandeja').style.display = 'none';
            window.showToast("Éxito", "Bandeja reasignada correctamente", "success");
        } catch(e) { console.error(e); }
    });
    
    document.getElementById('btn-confirmar-anulacion')?.addEventListener('click', async () => {
        const docId = window._gestionBandejaId;
        const obs = document.getElementById('input-anular-obs').value.trim();
        if(!docId) return;
        if(!obs) { alert("La justificación es obligatoria para anular."); return; }
        
        if(!confirm("¿Anular definitivamente esta bandeja y devolver el stock?")) return;
        
        try {
            const docRef = window.firebaseFirestore.doc(db, 'Bandejas_Turno', docId);
            await window.firebaseFirestore.runTransaction(db, async (transaction) => {
                const snap = await transaction.get(docRef);
                if(!snap.exists()) throw new Error("No existe");
                const data = snap.data();
                if(data.estado !== 'CREADA') throw new Error("Solo se pueden anular bandejas CREADAS");
                
                // Retornar stock
                const invRef = window.firebaseFirestore.collection(db, 'Inventario_Central');
                const invDocs = await window.firebaseFirestore.getDocs(window.firebaseFirestore.query(invRef));
                let docIdsMap = {};
                invDocs.forEach(d => {
                    const dt = d.data();
                    const key = (dt.nombreInsumo || dt.nombre || '').toLowerCase().trim();
                    docIdsMap[key] = d.id;
                });
                
                for(const med of data.medicamentos) {
                    const key = (med.nombreInsumo || med.nombre).toLowerCase().trim();
                    const cant = Number(med.cantidadAsignada || 0);
                    if(cant > 0 && docIdsMap[key]) {
                        transaction.update(window.firebaseFirestore.doc(db, 'Inventario_Central', docIdsMap[key]), {
                            cantidadRecibida: window.firebaseFirestore.increment(cant)
                        });
                        
                        // Historial
                        transaction.set(window.firebaseFirestore.doc(window.firebaseFirestore.collection(db, 'Historial_Movimientos')), {
                            tipoAccion: 'ENTRADA',
                            detalle: 'Anulación de Bandeja de Turno - ' + obs,
                            cantidad: cant,
                            nombreInsumo: med.nombreInsumo || med.nombre,
                            usuario: auth.currentUser.email,
                            fecha: window.firebaseFirestore.serverTimestamp(),
                            origen: 'Anulación',
                            destino: 'Inventario_Central'
                        });
                    }
                }
                
                transaction.update(docRef, {
                    estado: 'ANULADA',
                    justificacionAnulacion: obs,
                    anuladaPor: auth.currentUser.email,
                    fechaAnulacion: window.firebaseFirestore.serverTimestamp()
                });
            });
            
            document.getElementById('modal-gestionar-bandeja').style.display = 'none';
            window.showToast("Bandeja Anulada", "El stock ha regresado a bodega", "success");
        } catch(e) { alert(e.message); }
    });

});
`;

code = code + '\n' + finalLogic;

// 3. Modificar la tarjeta de "Mis Bandejas Activas" para inyectar Tiempo Transcurrido y boton Gestionar
const cardRegex = /<span class="badge" style="background:\$\{data\.estado === 'CREADA' \? 'var\(--warning\)' : 'var\(--success\)'\}; color:#000;">\s*ESTADO: \$\{data\.estado\}\s*<\/span>\s*<\/div>\s*<\/div>/g;

const cardReplacement = `<span class="badge" style="background:\${data.estado === 'CREADA' ? 'var(--warning)' : 'var(--success)'}; color:#000;">
                                ESTADO: \${data.estado}
                            </span>
                        </div>
                    </div>
                    \${data.fechaCreacion ? \`<div style="font-size:0.85em; color:#666; margin-bottom: 10px; display:flex; justify-content:space-between;">
                        <span><i class="ph ph-clock"></i> Creada: \${data.fechaCreacion.toDate().toLocaleString()}</span>
                        \${data.estado === 'CREADA' && document.body.getAttribute('data-user-role') !== 'enfermero' ? \`<a href="#" onclick="window.abrirGestionBandeja('\${docSnap.id}', '\${data.enfermeroAsignado}')" style="color:var(--primary); font-weight:bold;">⚙️ Gestionar (Reasignar/Anular)</a>\` : ''}
                    </div>\` : ''}
`;

code = code.replace(cardRegex, cardReplacement);

// 4. Modificar el modal de despacho para agregar el botón "Crear Enfermero"
const selectHTMLRegex = /<select id="select-enfermero" class="form-control" required>\s*<\/select>/;
const btnCrearEnf = `<div style="display:flex; gap:10px;">
                        <select id="select-enfermero" class="form-control" required style="flex:1;"></select>
                        <button type="button" class="btn btn-outline-primary" id="btn-crear-reemplazo-modal" style="padding: 0 10px;" title="Crear usuario temporal">+</button>
                    </div>`;

// Wait, the select-enfermero is in index.html!
// Let's modify index.html for this specific thing since it's easier.
let html = fs.readFileSync('index.html', 'utf8');
if(html.includes('<select id="select-enfermero" class="form-control" required></select>')) {
    html = html.replace('<select id="select-enfermero" class="form-control" required></select>', btnCrearEnf);
    fs.writeFileSync('index.html', html, 'utf8');
}


// Add imports inside script.js for createUserWithEmailAndPassword if missing
if(!code.includes('createUserWithEmailAndPassword')) {
    code = code.replace('signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail', 'signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail, createUserWithEmailAndPassword');
}

// Add global exposed functions for the event listener workaround
const globalExports = `
window.firebaseAuth = { createUserWithEmailAndPassword };
window.firebaseFirestore = { setDoc, doc, serverTimestamp, query, collection, orderBy, getDocs, updateDoc, runTransaction, increment, getDoc, where };
`;

// Inject globalExports at the end
code = code + '\n' + globalExports;

fs.writeFileSync('script.js', code, 'utf8');
console.log("Logica avanzada inyectada.");
