const fs = require('fs');

let scriptJs = fs.readFileSync('script.js', 'utf8');

const injection = `
        // 5. Renderizar Mis Bandejas Activas
        const renderBandejasActivas = () => {
            const container = document.getElementById('contenedor-mis-bandejas');
            if (!container) return;
            
            const role = document.body.getAttribute('data-user-role');
            const email = auth.currentUser ? auth.currentUser.email : '';
            
            let q;
            if (role === 'enfermero') {
                q = query(collection(db, 'Bandejas_Turno'), where('enfermeroAsignado', '==', email));
            } else {
                q = query(collection(db, 'Bandejas_Turno'));
            }

            onSnapshot(q, (snapshot) => {
                container.innerHTML = '';
                if (snapshot.empty) {
                    container.innerHTML = '<p style="color: #6c757d; font-style: italic; width: 100%;">No hay bandejas activas para mostrar.</p>';
                    return;
                }

                snapshot.forEach((docSnap) => {
                    const data = docSnap.data();
                    const card = document.createElement('div');
                    card.style.border = '1px solid #dee2e6';
                    card.style.borderRadius = '8px';
                    card.style.padding = '20px';
                    card.style.background = data.estado === 'CREADA' ? '#fff3cd' : (data.estado === 'RECEPCIONADA' ? '#d1e7dd' : '#f8f9fa');
                    
                    let actionsHtml = '';
                    if (role === 'enfermero' && data.estado === 'CREADA') {
                        actionsHtml = \`<button class="btn btn-success btn-sm mt-3 w-100" onclick="window.abrirModalRecepcion('\${docSnap.id}')">Recepcionar Bandeja</button>\`;
                    } else if (role === 'enfermero' && data.estado === 'RECEPCIONADA') {
                        actionsHtml = \`<button class="btn btn-primary btn-sm mt-3 w-100" onclick="window.abrirPanelTurno('\${docSnap.id}')">Gestionar Turno</button>\`;
                    } else if ((role === 'admin' || role === 'operador') && data.estado === 'CERRADA_ENFERMERIA') {
                        actionsHtml = \`<button class="btn btn-warning btn-sm mt-3 w-100" onclick="window.abrirAuditoriaRetorno('\${docSnap.id}')">Auditar Retorno</button>\`;
                    }

                    card.innerHTML = \`
                        <h4 style="margin-top: 0; color: #212529;">\${data.identificador || 'Bandeja Sin ID'}</h4>
                        <p style="margin: 0; font-size: 0.9em; color: #495057;"><strong>Asignado:</strong> \${data.enfermeroAsignado}</p>
                        <p style="margin: 0; font-size: 0.9em; color: #495057;"><strong>Estado:</strong> \${data.estado}</p>
                        <p style="margin: 0; font-size: 0.9em; color: #495057;"><strong>Items:</strong> \${data.medicamentos ? data.medicamentos.length : 0}</p>
                        \${actionsHtml}
                    \`;
                    container.appendChild(card);
                });
            }, (error) => {
                console.error("Error cargando bandejas:", error);
                container.innerHTML = '<p style="color: red;">Error al cargar las bandejas.</p>';
            });
        };

        renderBandejasActivas();
`;

// Insert before the end of startBandejasModule.
// We found it ends around line 4942. We'll search for the last '}' of the function.
// Let's use a unique string replacement:
const target = `            });
        }
    };`;

if (scriptJs.includes(target)) {
    scriptJs = scriptJs.replace(target, `            });
        }
${injection}
    };`);
    fs.writeFileSync('script.js', scriptJs);
    console.log("Inyectado renderBandejasActivas.");
} else {
    console.log("No se encontró el target.");
}
