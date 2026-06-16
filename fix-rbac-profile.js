const fs = require('fs');

// --- 1. SCRIPT.JS FIXES ---
let js = fs.readFileSync('script.js', 'utf8');

// Fix enforceRBACLogic using UID -> Email
js = js.replace("const userDocRef = doc(db, 'Usuarios', userAuth.uid);", "const userDocRef = doc(db, 'Usuarios', userAuth.email);");
js = js.replace("const userDoc = await getDoc(doc(db, 'Usuarios', user.uid));", "const userDoc = await getDoc(doc(db, 'Usuarios', user.email));");

// Ensure sendPasswordResetEmail is imported
if (!js.includes('sendPasswordResetEmail')) {
    js = js.replace('signInWithEmailAndPassword,', 'signInWithEmailAndPassword, sendPasswordResetEmail,');
}

// Add event listener for profile
const profileLogic = `
    // FASE 31: EVENTOS DEL PERFIL DE USUARIO
    document.addEventListener('click', async (e) => {
        // Abrir Perfil
        if (e.target.closest('#btn-user-profile')) {
            e.preventDefault();
            const modal = document.getElementById('modal-user-profile');
            const user = auth.currentUser;
            if (!user) return;
            
            document.getElementById('profile-email').value = user.email;
            
            try {
                const userDoc = await getDoc(doc(db, 'Usuarios', user.email));
                if (userDoc.exists() && userDoc.data().nombre) {
                    document.getElementById('profile-nombre').value = userDoc.data().nombre;
                } else {
                    document.getElementById('profile-nombre').value = '';
                }
            } catch (err) {
                console.error("Error fetching user name:", err);
            }
            
            modal.style.display = 'flex';
        }

        // Guardar Cambios de Perfil
        if (e.target.closest('#btn-save-profile')) {
            e.preventDefault();
            const user = auth.currentUser;
            if (!user) return;
            
            const btn = e.target.closest('#btn-save-profile');
            const newName = document.getElementById('profile-nombre').value.trim();
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Guardando...';
            btn.disabled = true;
            
            try {
                await updateDoc(doc(db, 'Usuarios', user.email), { nombre: newName }, { merge: true });
                window.showAlertCenter("Perfil Actualizado", "Tu nombre ha sido guardado exitosamente.");
                // Update UI visually if possible, though currently header shows email
            } catch (error) {
                console.error("Error updating profile:", error);
                window.showAlertCenter("Error", "No se pudo actualizar el perfil.", true);
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
                document.getElementById('modal-user-profile').style.display = 'none';
            }
        }

        // Enviar Correo de Recuperación
        if (e.target.closest('#btn-reset-password')) {
            e.preventDefault();
            const user = auth.currentUser;
            if (!user) return;
            
            const btn = e.target.closest('#btn-reset-password');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Solicitando...';
            btn.disabled = true;
            
            try {
                await sendPasswordResetEmail(auth, user.email);
                window.showAlertCenter("Correo Enviado", "Se ha enviado un enlace de restablecimiento a " + user.email);
            } catch (error) {
                console.error("Error sending password reset:", error);
                window.showAlertCenter("Error", "No se pudo enviar el correo: " + error.message, true);
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
                document.getElementById('modal-user-profile').style.display = 'none';
            }
        }
    });
`;
// Inject logic just before the end of the file or after the enforceRBACLogic block.
// I'll put it at the very bottom of the file
js += '\n' + profileLogic;

// Also update guards for Enfermero
const oldGuard = `    if (userRole === 'enfermero') {
        const forbidden = ['view-compras', 'view-informes', 'view-bodegas', 'view-usuarios', 'view-configuracion', 'view-transferencias'];`;
const newGuard = `    if (userRole === 'enfermero') {
        const forbidden = ['view-inventario', 'view-movimientos', 'view-historial', 'view-ajustes', 'view-compras', 'view-informes', 'view-bodegas', 'view-usuarios', 'view-configuracion', 'view-transferencias'];`;
js = js.replace(oldGuard, newGuard);

fs.writeFileSync('script.js', js);

// --- 2. STYLE.CSS FIXES ---
let css = fs.readFileSync('style.css', 'utf8');

const oldCssEnfermero = `body[data-user-role="enfermero"] .menu-item[data-target="view-compras"],
body[data-user-role="enfermero"] .menu-item[data-target="view-informes"],
body[data-user-role="enfermero"] .menu-item[data-target="view-bodegas"],
body[data-user-role="enfermero"] .menu-item[data-target="view-usuarios"],
body[data-user-role="enfermero"] .menu-item[data-target="view-configuracion"],
body[data-user-role="enfermero"] .menu-item[data-target="view-transferencias"],
body[data-user-role="enfermero"] .admin-only,
body[data-user-role="enfermero"] .superadmin-only {`;

const newCssEnfermero = `body[data-user-role="enfermero"] .menu-item[data-target="view-inventario"],
body[data-user-role="enfermero"] .menu-item[data-target="view-movimientos"],
body[data-user-role="enfermero"] .menu-item[data-target="view-historial"],
body[data-user-role="enfermero"] .menu-item[data-target="view-ajustes"],
body[data-user-role="enfermero"] .menu-item[data-target="view-compras"],
body[data-user-role="enfermero"] .menu-item[data-target="view-informes"],
body[data-user-role="enfermero"] .menu-item[data-target="view-bodegas"],
body[data-user-role="enfermero"] .menu-item[data-target="view-usuarios"],
body[data-user-role="enfermero"] .menu-item[data-target="view-configuracion"],
body[data-user-role="enfermero"] .menu-item[data-target="view-transferencias"],
body[data-user-role="enfermero"] .sidebar-category:nth-of-type(2),
body[data-user-role="enfermero"] .admin-only,
body[data-user-role="enfermero"] .superadmin-only {`;
css = css.replace(oldCssEnfermero, newCssEnfermero);

fs.writeFileSync('style.css', css);

// --- 3. INDEX.HTML FIXES ---
let html = fs.readFileSync('index.html', 'utf8');

// A. Make .user-profile clickable
html = html.replace('<div class="user-profile">', '<div class="user-profile" id="btn-user-profile" style="cursor: pointer;" title="Mi Perfil">');

// B. Inject the Modal
const profileModalStr = `
    <!-- MODAL: PERFIL DE USUARIO -->
    <div id="modal-user-profile" style="display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.8); z-index: 999999; justify-content: center; align-items: center;">
        <div style="background: white; padding: 35px; border-radius: 12px; width: 450px; text-align: left; box-shadow: 0 10px 25px rgba(0,0,0,0.3);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h2 style="margin: 0; color: #212529;"><i class="ph ph-user-circle"></i> Mi Perfil</h2>
                <button class="btn btn-icon" onclick="document.getElementById('modal-user-profile').style.display='none'"><i class="ph ph-x"></i></button>
            </div>
            
            <div class="form-group" style="margin-bottom: 15px;">
                <label class="form-label">Correo Institucional</label>
                <input type="text" class="form-control" id="profile-email" disabled style="background-color: #e9ecef; cursor: not-allowed;">
            </div>
            
            <div class="form-group" style="margin-bottom: 25px;">
                <label class="form-label" id="profile-nombre-label">Nombre Completo</label>
                <input type="text" class="form-control" id="profile-nombre" placeholder="Ej. Juan Pérez">
            </div>

            <div style="display: flex; flex-direction: column; gap: 10px;">
                <button class="btn btn-primary" id="btn-save-profile" style="width: 100%; justify-content: center;"><i class="ph ph-floppy-disk"></i> Guardar Cambios</button>
                <button class="btn btn-outline" id="btn-reset-password" style="width: 100%; justify-content: center; color: #6c757d; border-color: #dee2e6;"><i class="ph ph-key"></i> Solicitar Cambio de Contraseña</button>
            </div>
        </div>
    </div>
    </main>
</div>`;

// Insert the modal exactly where </main> </div> is
html = html.replace('    </main>\r\n</div>', profileModalStr);

fs.writeFileSync('index.html', html);

console.log('Profile and RBAC fixes applied successfully!');
