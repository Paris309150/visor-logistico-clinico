const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');

const target = `    <!-- ============================================================ -->
    <!-- MODAL: AGREGAR INSUMO MANUAL A ORDEN DE COMPRA               -->`;

const injection = `    <!-- MODAL: REGISTRO DE CONSUMO/MERMA -->
    <div id="modal-consumo-bandeja" class="modal-overlay">
        <div class="modal-card" style="background:white; border-radius:12px; width:650px; max-width:90%;">
            <div style="padding:20px 24px; border-bottom:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center; background:#f8fafc; border-radius:12px 12px 0 0;">
                <h3 style="margin: 0; color: #0d6efd; font-weight: bold;"><i class="ph ph-pill"></i> Registrar Consumo o Merma</h3>
                <button class="btn btn-icon close-modal-btn" onclick="document.getElementById('modal-consumo-bandeja').style.display='none'"><i class="ph ph-x"></i></button>
            </div>
            <div style="padding: 24px;">
                <div class="form-group mb-16">
                    <label class="form-label font-bold">Fármaco / Insumo</label>
                    <select class="form-control" id="select-consumo-insumo"></select>
                </div>
                
                <div style="display: flex; gap: 15px; margin-bottom: 16px;">
                    <div class="form-group" style="flex: 1;">
                        <label class="form-label font-bold">Tipo de Salida</label>
                        <select class="form-control" id="select-consumo-tipo">
                            <option value="CONSUMO">Consumo en Paciente</option>
                            <option value="MERMA">Merma (Quebrado/Precipitado)</option>
                            <option value="EXTRAVIO">Extravío (Desconocido)</option>
                        </select>
                    </div>
                    <div class="form-group" style="flex: 1;">
                        <label class="form-label font-bold">Cantidad</label>
                        <input type="number" class="form-control" id="input-consumo-cantidad" min="1" value="1">
                    </div>
                </div>

                <div class="form-group mb-24">
                    <label class="form-label font-bold">Observación / Justificación</label>
                    <input type="text" class="form-control" id="input-consumo-obs" placeholder="Ej. Administrado a paciente en box 3 / Ampolla se quebró al abrir...">
                </div>

                <div style="display: flex; gap: 15px; justify-content: flex-end;">
                    <button class="btn btn-outline close-modal-btn" onclick="document.getElementById('modal-consumo-bandeja').style.display='none'">Cancelar</button>
                    <button class="btn btn-primary" id="btn-guardar-consumo"><i class="ph ph-floppy-disk"></i> Registrar Salida</button>
                </div>
            </div>
        </div>
    </div>

    <!-- MODAL: CIERRE DE TURNO Y EXCEL -->
    <div id="modal-cierre-turno" class="modal-overlay">
        <div class="modal-card" style="background:white; border-radius:12px; width:750px; max-width:95%;">
            <div style="padding:20px 24px; border-bottom:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center; background:#f8fafc; border-radius:12px 12px 0 0;">
                <h3 style="margin: 0; color: #ffc107; font-weight: bold;"><i class="ph ph-lock-key"></i> Cuadratura y Cierre de Turno</h3>
                <button class="btn btn-icon close-modal-btn" onclick="document.getElementById('modal-cierre-turno').style.display='none'"><i class="ph ph-x"></i></button>
            </div>
            
            <div style="padding: 24px;">
                <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; border: 1px solid #dee2e6; margin-bottom: 24px;">
                    <h4 style="margin-top: 0; margin-bottom: 15px; color: #495057;">1. Subir Archivo de Insumos y Fármacos (Excel)</h4>
                    <input type="file" id="input-excel-cierre" accept=".xlsx, .xls" class="form-control" style="margin-bottom: 10px;">
                    <p style="margin: 0; font-size: 0.85em; color: #6c757d;">El sistema cruzará la información del Excel con sus registros de consumo del turno actual.</p>
                </div>

                <div id="resultado-cuadratura" style="display: none; margin-bottom: 24px; border: 1px solid #dee2e6; border-radius: 8px; padding: 15px;">
                    <!-- Resultados del cruce Excel vs Consumos -->
                </div>

                <div style="display: flex; gap: 15px; justify-content: flex-end;">
                    <button class="btn btn-outline close-modal-btn" onclick="document.getElementById('modal-cierre-turno').style.display='none'">Cancelar</button>
                    <button class="btn btn-warning" id="btn-finalizar-turno" style="font-weight: bold; display: none;">🔒 Entregar Bandeja a Bodega</button>
                </div>
            </div>
        </div>
    </div>

`;

if (html.includes(target)) {
    html = html.replace(target, injection + target);
    fs.writeFileSync('index.html', html);
    console.log("Modals added successfully.");
} else {
    console.log("Target not found.");
}
