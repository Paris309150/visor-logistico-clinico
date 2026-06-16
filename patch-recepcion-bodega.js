const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');

const modalHtml = `
    <!-- ============================================================ -->
    <!-- MODAL: RECEPCION BODEGA (OPERADOR)                           -->
    <!-- ============================================================ -->
    <div id="modal-recepcion-bodega" class="modal-overlay" style="display: none;">
        <div class="modal-content" style="max-width: 900px; width: 95%;">
            <div class="modal-header">
                <h2><i class="ph ph-warehouse"></i> Auditar y Recepcionar Bandeja</h2>
                <button class="btn-close" onclick="document.getElementById('modal-recepcion-bodega').style.display='none'"><i class="ph ph-x"></i></button>
            </div>
            <div class="modal-body">
                <div class="info-card warning" style="margin-bottom: 20px;">
                    <i class="ph ph-info"></i> Revisa el cruce realizado por enfermería y confirma la cantidad física devuelta a Bodega.
                </div>
                
                <h4 style="margin-top: 0; margin-bottom: 10px;">Cruce de Cierre (VISOR vs RAYEN)</h4>
                <div id="recepcion-bodega-cruce" style="margin-bottom: 25px; border: 1px solid #dee2e6; border-radius: 8px; overflow: hidden; background: #fff;">
                    <!-- Tabla generada por JS -->
                </div>
                
                <h4 style="margin-top: 0; margin-bottom: 10px;">Recepción Física de Retorno (Inventario Central)</h4>
                <div id="recepcion-bodega-fisica" style="border: 1px solid #dee2e6; border-radius: 8px; overflow: hidden; background: #fff;">
                    <!-- Tabla generada por JS -->
                </div>
            </div>
            <div class="modal-footer" style="display: flex; justify-content: space-between;">
                <button class="btn btn-outline" onclick="document.getElementById('modal-recepcion-bodega').style.display='none'">Cancelar</button>
                <button class="btn btn-success" id="btn-confirmar-recepcion-bodega">
                    <i class="ph ph-check-circle"></i> Confirmar Retorno y Finalizar
                </button>
            </div>
        </div>
    </div>
`;

if (!html.includes('id="modal-recepcion-bodega"')) {
    html = html.replace('<!-- FIN MODALES -->', modalHtml + '\n    <!-- FIN MODALES -->');
    fs.writeFileSync('index.html', html, 'utf8');
    console.log("Modal de recepcion bodega inyectado en index.html");
} else {
    console.log("El modal ya existe.");
}
