const html = `
                        <div class="table-wrapper">
                            <table>
                                <thead>
                                    <tr>
                                        <th>FÁRMACO</th>
                                        <th>ASIGNADO</th>
                                        <th>RECIBIDO (FÍSICO)</th><th>OBSERVACIÓN</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td>
                                            TEST
                                            
                                        </td>
                                        <td><strong>6</strong></td>
                                        
                                        <td style="width:120px;">
                                            <input type="number" id="recibido-123-0" class="form-control recepcion-cantidad" data-idx="0" data-asignada="6" value="6" min="0" onchange="window.validarFilaRecepcion(this)">
                                        </td>
                                        <td>
                                            <input type="text" id="obs-123-0" class="form-control recepcion-obs" data-idx="0" placeholder="Solo si hay diferencia..." disabled>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <div style="margin-top: 16px; display: flex; gap: 10px; justify-content: flex-end; align-items:center;">
                            <span id="warning-msg-123" style="color:var(--danger); font-size:0.9em; display:none; font-weight:bold;">Hay faltantes. Debes justificar en Observaciones.</span>
                            <button class="btn btn-primary" onclick="window.confirmarRecepcionBandeja('123')">
                                <i class="ph ph-check-circle"></i> Confirmar Recepción Física
                            </button>
                        </div>
`;
console.log(html);
