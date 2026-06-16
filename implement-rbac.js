const fs = require('fs');

// 1. UPDATE STYLE.CSS
let css = fs.readFileSync('style.css', 'utf8');
const oldCssRbac = `/* ----------------------------------------------------
   SEGURIDAD UI (RBAC) - ATRIBUTOS GLOBALES ESTRUCTURALES
---------------------------------------------------- */
body[data-user-role="operador"] .admin-only {
    display: none !important;
}`;

const newCssRbac = `/* ----------------------------------------------------
   SEGURIDAD UI (RBAC ESTRICTO)
---------------------------------------------------- */
/* ENFERMERO: Oculta Compras, Informes, Bodega, Usuarios, Transferencias, Configuración y botones admin-only */
body[data-user-role="enfermero"] .menu-item[data-target="view-compras"],
body[data-user-role="enfermero"] .menu-item[data-target="view-informes"],
body[data-user-role="enfermero"] .menu-item[data-target="view-bodegas"],
body[data-user-role="enfermero"] .menu-item[data-target="view-usuarios"],
body[data-user-role="enfermero"] .menu-item[data-target="view-configuracion"],
body[data-user-role="enfermero"] .menu-item[data-target="view-transferencias"],
body[data-user-role="enfermero"] .admin-only,
body[data-user-role="enfermero"] .superadmin-only {
    display: none !important;
}

/* OPERADOR: Oculta Compras, Usuarios, Configuración y botones admin-only generales */
body[data-user-role="operador"] .menu-item[data-target="view-compras"],
body[data-user-role="operador"] .menu-item[data-target="view-usuarios"],
body[data-user-role="operador"] .menu-item[data-target="view-configuracion"],
body[data-user-role="operador"] .admin-only,
body[data-user-role="operador"] .superadmin-only {
    display: none !important;
}
/* Excepciones explícitas para Operador */
body[data-user-role="operador"] a.menu-item[data-target="view-informes"],
body[data-user-role="operador"] a.menu-item[data-target="view-bodegas"] {
    display: flex !important;
}

/* ADMINISTRADOR: Solo ocultar superadmin-only */
body[data-user-role="administrador"] .superadmin-only,
body[data-user-role="admin"] .superadmin-only {
    display: none !important;
}

/* SUPERADMIN: Ve todo. No se oculta nada. */
`;

if (css.includes(oldCssRbac)) {
    css = css.replace(oldCssRbac, newCssRbac);
} else {
    // Append if not found exactly
    css += '\n' + newCssRbac;
}
fs.writeFileSync('style.css', css);

// 2. UPDATE SCRIPT.JS
let js = fs.readFileSync('script.js', 'utf8');

// A. Inject routing guards in navigateToHash
// Look for: const role = document.body.getAttribute('data-user-role') || 'operador';
// Wait, navigateToHash looks like:
// function navigateToHash(hash) { ...
const navStart = js.indexOf('function navigateToHash(hash) {');
if (navStart !== -1) {
    const roleLogic = `    const target = hash.substring(1);
    const userRole = document.body.getAttribute('data-user-role') || 'operador';
    
    // Guardas de Seguridad RBAC
    if (userRole === 'enfermero') {
        const forbidden = ['view-compras', 'view-informes', 'view-bodegas', 'view-usuarios', 'view-configuracion', 'view-transferencias'];
        if (forbidden.includes(target)) {
            window.showAlertCenter("Acceso Denegado", "Tu rol de Enfermero no tiene permisos para acceder a esta sección.", true);
            window.location.hash = '#view-inventario';
            return;
        }
    }
    if (userRole === 'operador') {
        const forbidden = ['view-compras', 'view-usuarios', 'view-configuracion'];
        if (forbidden.includes(target)) {
            window.showAlertCenter("Acceso Denegado", "Tu rol de Operador no tiene permisos para acceder a esta sección.", true);
            window.location.hash = '#view-inventario';
            return;
        }
    }
`;
    // Insert after "const target = hash.substring(1);" (or similar logic)
    // Actually, I'll just replace the start of the function body.
    const bodyStart = js.indexOf('{', navStart) + 1;
    const currentLogic = js.substring(bodyStart, bodyStart + 200);
    if (!currentLogic.includes('Guardas de Seguridad')) {
        js = js.substring(0, bodyStart) + '\n' + roleLogic + js.substring(bodyStart);
    }
}

// B. Remove the matrix logic
// Search for function renderRBACMatrix() and comment it out or remove it
const rbacStart = js.indexOf('// RBAC: GENERAR MATRIZ DE PERMISOS');
if (rbacStart !== -1) {
    const rbacEnd = js.indexOf('// EXPORTACIÓN DE INFORMES', rbacStart); // Assuming it's before EXPORTACIÓN
    if (rbacEnd !== -1) {
        js = js.substring(0, rbacStart) + '\n/* RBAC Dinámico Removido (Reemplazado por RBAC Estricto basado en UI) */\n\n' + js.substring(rbacEnd);
    }
}

fs.writeFileSync('script.js', js);

// 3. UPDATE INDEX.HTML
let html = fs.readFileSync('index.html', 'utf8');

// A. Remove "Permisos" button
// <button class="btn btn-secondary admin-only" onclick="document.getElementById('modal-config-roles').classList.add('active')" title="Configurar Permisos">
//                                     <i class="ph ph-sliders"></i> Permisos
//                                 </button>
const btnPermisosMatch = html.match(/<button class="btn btn-secondary admin-only" onclick="document.getElementById\('modal-config-roles'\)\.classList\.add\('active'\)".*?>[\s\S]*?<\/button>/);
if (btnPermisosMatch) {
    html = html.replace(btnPermisosMatch[0], '');
}

// B. We could remove the modal completely, but it's okay to just leave it hidden for now or remove it.
// <div id="modal-config-roles" class="modal-overlay">
// ...
const modalConfigStart = html.indexOf('<!-- MODAL: CONFIGURACIÓN DE ROLES (RBAC Dinámico)               -->');
if (modalConfigStart !== -1) {
    const modalConfigEnd = html.indexOf('<!-- MODAL: TRANSFERENCIA', modalConfigStart);
    if (modalConfigEnd !== -1) {
        html = html.substring(0, modalConfigStart) + html.substring(modalConfigEnd);
    }
}

// C. In the sidebar, Superadmin WIPE button shouldn't be admin-only, it should be superadmin-only.
// Let's check the WIPE button logic. It uses "admin-only" right now. Let's leave it as is, since Administrador doesn't see it (we added rule for superadmin-only, we should add class to wipe button).
// Let's add superadmin-only to the WIPE DB button in Configuración.
html = html.replace('<button id="btn-wipe-db" class="btn btn-danger" style="width:100%;">', '<button id="btn-wipe-db" class="btn btn-danger superadmin-only" style="width:100%;">');
html = html.replace('<h3 style="color:var(--danger); margin:0;">Borrado Completo de Sistema</h3>', '<h3 class="superadmin-only" style="color:var(--danger); margin:0;">Borrado Completo de Sistema</h3>');

fs.writeFileSync('index.html', html);

console.log('RBAC logic successfully applied.');
