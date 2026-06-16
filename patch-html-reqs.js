const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');

// 1. Sidebar Menu - Historial de Bandejas
const sidebarRegex = /(<li id="menu-bandejas-activas"[\s\S]*?<\/li>)/;
const historialMenu = `
                <li id="menu-historial-bandejas" data-rbac="admin,operador" style="display: none;">
                    <a href="#" onclick="window.cambiarVista('historial-bandejas')"><i class="ph ph-clock-counter-clockwise"></i> Historial Bandejas</a>
                </li>
`;
if (!html.includes('menu-historial-bandejas')) {
    html = html.replace(sidebarRegex, `$1\n${historialMenu}`);
}

// 2. Main View - Historial de Bandejas
const viewRegex = /(<div id="vista-mis-bandejas" class="view-section">[\s\S]*?<\/div>\s*<\/div>)/;
const historialView = `
        <!-- VISTA: HISTORIAL DE BANDEJAS (OPERADOR/ADMIN) -->
        <div id="vista-historial-bandejas" class="view-section" style="display: none;">
            <div class="header-actions">
                <h2><i class="ph ph-clock-counter-clockwise"></i> Historial Completo de Bandejas</h2>
            </div>
            <div class="info-card info" style="margin-bottom: 20px;">
                <i class="ph ph-info"></i> Aquí puedes revisar todo el ciclo de vida de las bandejas (Creadas, En Uso, Cerradas y Anuladas) y auditar los cruces con RAYEN.
            </div>
            <div class="data-table-card table-responsive" style="padding: 16px;">
                <table class="table table-hover">
                    <thead>
                        <tr>
                            <th>ID Bandeja</th>
                            <th>Enfermero Asignado</th>
                            <th>Estado</th>
                            <th>Creada El</th>
                            <th>Última Actualización</th>
                            <th>Acciones</th>
                        </tr>
                    </thead>
                    <tbody id="lista-historial-bandejas">
                        <!-- Llenado por JS -->
                    </tbody>
                </table>
            </div>
        </div>
`;
if (!html.includes('vista-historial-bandejas')) {
    html = html.replace(viewRegex, `$1\n${historialView}`);
}

// 3. Modals: Reemplazo, Reasignar, Anular, VerCruce
const modales = `
    <!-- MODAL: CREAR ENFERMERO DE REEMPLAZO -->
    <div id="modal-crear-reemplazo" class="modal-overlay" style="display: none;">
        <div class="modal-content" style="max-width: 450px;">
            <div class="modal-header">
                <h2><i class="ph ph-user-plus"></i> Enfermero de Reemplazo</h2>
                <button class="btn-close" onclick="document.getElementById('modal-crear-reemplazo').style.display='none'"><i class="ph ph-x"></i></button>
            </div>
            <div class="modal-body">
                <div class="info-card warning" style="margin-bottom: 15px;">
                    <i class="ph ph-warning-circle"></i> Crea un usuario temporal para asignar bandejas a personal de apoyo externo.
                </div>
                <div class="form-group">
                    <label>Nombre del Enfermero</label>
                    <input type="text" id="reemplazo-nombre" class="form-control" placeholder="Ej: Juan Pérez (Reemplazo)">
                </div>
                <div class="form-group">
                    <label>Correo Electrónico (Provisorio)</label>
                    <input type="email" id="reemplazo-email" class="form-control" placeholder="Ej: reemplazo1@sar.cl">
                </div>
                <div class="form-group">
                    <label>Contraseña Temporal</label>
                    <input type="text" id="reemplazo-pass" class="form-control" value="Sarsur2026*" placeholder="Mínimo 6 caracteres">
                </div>
            </div>
            <div class="modal-footer" style="display: flex; justify-content: space-between;">
                <button class="btn btn-outline" onclick="document.getElementById('modal-crear-reemplazo').style.display='none'">Cancelar</button>
                <button class="btn btn-primary" id="btn-guardar-reemplazo"><i class="ph ph-check"></i> Crear Usuario</button>
            </div>
        </div>
    </div>

    <!-- MODAL: GESTIONAR BANDEJA PENDIENTE -->
    <div id="modal-gestionar-bandeja" class="modal-overlay" style="display: none;">
        <div class="modal-content" style="max-width: 500px;">
            <div class="modal-header">
                <h2><i class="ph ph-gear"></i> Gestionar Bandeja Pendiente</h2>
                <button class="btn-close" onclick="document.getElementById('modal-gestionar-bandeja').style.display='none'"><i class="ph ph-x"></i></button>
            </div>
            <div class="modal-body">
                <div class="tabs" style="margin-bottom: 15px; display:flex; gap: 10px; border-bottom: 1px solid #ddd; padding-bottom: 10px;">
                    <button class="btn btn-outline" id="tab-reasignar" style="flex:1;">Reasignar Enfermero</button>
                    <button class="btn btn-outline" id="tab-anular" style="flex:1; border-color: var(--danger); color: var(--danger);">Anular Bandeja</button>
                </div>
                
                <div id="div-reasignar-bandeja">
                    <label>Nuevo Enfermero Asignado:</label>
                    <select id="select-reasignar-enfermero" class="form-control" style="margin-bottom: 15px;">
                        <!-- JS -->
                    </select>
                    <button class="btn btn-primary w-100" id="btn-confirmar-reasignacion">Confirmar Reasignación</button>
                </div>
                
                <div id="div-anular-bandeja" style="display:none;">
                    <label>Justificación de la Anulación (Obligatoria):</label>
                    <textarea id="input-anular-obs" class="form-control" rows="3" placeholder="Ej: Se suspendió el turno, bandeja armada por error..."></textarea>
                    <p style="font-size: 0.85em; color: var(--danger); margin-top: 5px;">El stock de esta bandeja regresará automáticamente al Inventario Central.</p>
                    <button class="btn btn-danger w-100" id="btn-confirmar-anulacion" style="margin-top:10px;">Confirmar Anulación Definitiva</button>
                </div>
            </div>
        </div>
    </div>
    
    <!-- MODAL: VER CRUCE HISTORICO -->
    <div id="modal-ver-cruce" class="modal-overlay" style="display: none;">
        <div class="modal-content" style="max-width: 800px; width: 95%;">
            <div class="modal-header">
                <h2><i class="ph ph-magnifying-glass"></i> Auditoría de Cuadratura (RAYEN)</h2>
                <button class="btn-close" onclick="document.getElementById('modal-ver-cruce').style.display='none'"><i class="ph ph-x"></i></button>
            </div>
            <div class="modal-body" id="body-ver-cruce">
                <!-- JS -->
            </div>
        </div>
    </div>
`;
if (!html.includes('modal-crear-reemplazo')) {
    html = html.replace('<!-- FIN MODALES -->', modales + '\n    <!-- FIN MODALES -->');
}

fs.writeFileSync('index.html', html, 'utf8');
console.log("HTML actualizado con modales y vistas nuevas.");
