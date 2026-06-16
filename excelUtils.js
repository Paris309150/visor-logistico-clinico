/**
 * excelUtils.js
 * Módulo de Utilidad para Carga y Descarga Masiva del Inventario SAR
 * Requiere la librería SheetJS (xlsx): https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js
 */

/**
 * Convierte un número de serie de Excel (integer) a un objeto Date de JS.
 * Excel cuenta los días desde el 30/12/1899.
 */
export function excelSerialDateToJS(serial) {
    if (isNaN(serial) || typeof serial !== 'number') return serial;
    const utc_days = Math.floor(serial - 25569);
    const utc_value = utc_days * 86400;
    const date_info = new Date(utc_value * 1000);
    
    // Ajuste de zona horaria local (Chile/Santiago aprox)
    const fractional_day = serial - Math.floor(serial) + 0.0000001;
    let total_seconds = Math.floor(86400 * fractional_day);
    const seconds = total_seconds % 60;
    total_seconds -= seconds;
    const hours = Math.floor(total_seconds / (60 * 60));
    const minutes = Math.floor(total_seconds / 60) % 60;

    return new Date(date_info.getFullYear(), date_info.getMonth(), date_info.getDate(), hours, minutes, seconds);
}

// 1. ESQUEMA UNIFICADO DE DATOS (ARQUITECTURA)
// Este es el contrato de datos pactado (basado en la Guía de Despacho SAR)
export const INVENTORY_SCHEMA = [
    "id_producto",
    "descripcion",
    "cantidad",
    "costo_unitario",
    "lote",
    "vencimiento",
    "ubicacion",
    "categoria",
    "stock_minimo"
];

/**
 * 2. FUNCIÓN DE PLANTILLA
 * Genera y descarga un archivo Excel vacío estructurado con las columnas exactas.
 */
export function generarPlantillaExcel() {
    if (typeof XLSX === 'undefined') {
        console.error("La librería XLSX no está cargada.");
        return;
    }
    
    // Crear la primera fila (encabezados) a partir del esquema
    const ws = XLSX.utils.aoa_to_sheet([INVENTORY_SCHEMA]);
    
    // Anchos de columna predeterminados para una buena visualización interactiva
    ws['!cols'] = [
        { wch: 15 }, // id_producto
        { wch: 35 }, // descripcion
        { wch: 10 }, // cantidad
        { wch: 15 }, // costo_unitario
        { wch: 15 }, // lote
        { wch: 15 }, // vencimiento
        { wch: 20 }, // ubicacion
        { wch: 20 }, // categoria
        { wch: 12 }  // stock_minimo
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Plantilla_Carga");
    XLSX.writeFile(wb, "Plantilla_Inventario_SAR.xlsx");
}

/**
 * 3. VALIDACIÓN DE ESTRUCTURA Y 4. PARSEO A JSON
 * Lee un archivo File (desde un <input type="file">), valida sus columnas 
 * y lo convierte en un arreglo de objetos JSON estrictos para Firestore.
 * 
 * @param {File} file - El archivo Excel proveniente del usuario.
 * @returns {Promise<Object>} Resuelve con { success: true, data: Array } o rechaza con un mensaje de error.
 */
export function procesarExcelCargaMasiva(file) {
    return new Promise((resolve, reject) => {
        if (!file || !(file instanceof File)) {
            return reject("No se ha seleccionado un archivo válido.");
        }

        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                
                // Asumimos que la tabla está en la primera hoja de cálculo
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                
                // Transformar las filas a formato JSON de SheetJS, conservando los encabezados originales en el index 0
                const rawJson = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                
                if (rawJson.length === 0) {
                    return reject("El documento Excel está vacío.");
                }

                // -- Validación de Columnas --
                const detectedHeaders = rawJson[0] || [];
                const columnErrors = [];
                
                // Validamos 1x1 asegurando orden y nomenclatura exacta
                for (let i = 0; i < INVENTORY_SCHEMA.length; i++) {
                    const expected = INVENTORY_SCHEMA[i];
                    const found = detectedHeaders[i] ? detectedHeaders[i].trim() : null;
                    if (expected !== found) {
                        columnErrors.push(`Falta o es incorrecta la columna '${expected}' en la posición ${i + 1}. (Encontrado: '${found || "Vacío"}')`);
                    }
                }

                if (columnErrors.length > 0) {
                    return reject(`Error de estructura en el archivo:\n- ` + columnErrors.join('\n- ') + `\n\nPor favor usa la plantilla oficial.`);
                }

                // -- Transformación Semántica --
                const cleanData = [];
                for (let i = 1; i < rawJson.length; i++) {
                    const row = rawJson[i];
                    if (!row || row.length === 0) continue; 
                    
                    const itemObject = {
                        [INVENTORY_SCHEMA[0]]: row[0] || "",
                        [INVENTORY_SCHEMA[1]]: row[1] || "",
                        [INVENTORY_SCHEMA[2]]: Math.max(0, Number(row[2]) || 0),
                        [INVENTORY_SCHEMA[3]]: Math.max(0, Number(row[3]) || 0),
                        [INVENTORY_SCHEMA[4]]: row[4] || "",
                        // Manejo robusto de fechas seriales de Excel
                        [INVENTORY_SCHEMA[5]]: typeof row[5] === 'number' ? excelSerialDateToJS(row[5]).toISOString().split('T')[0] : (row[5] || ""), 
                        [INVENTORY_SCHEMA[6]]: row[6] || "Sin asginar",
                        [INVENTORY_SCHEMA[7]]: row[7] || "Sin categorizar",
                        [INVENTORY_SCHEMA[8]]: Math.max(0, Number(row[8]) || 0),
                        // Campo oculto para búsqueda eficiente case-insensitive en Firestore
                        name_lowercase: (row[1] || "").toString().toLowerCase().trim()
                    };
                    cleanData.push(itemObject);
                }

                resolve({ success: true, count: cleanData.length, data: cleanData });

            } catch (error) {
                reject("Error interno al parsear el Excel: " + error.message);
            }
        };

        reader.onerror = () => {
            reject("Error del sistema al intentar leer el fichero.");
        };

        reader.readAsArrayBuffer(file);
    });
}

/**
 * 4. EXPORTACIÓN DE RESGUARDO (BACKUP)
 * Genera un Excel con el estado actual del inventario para su resguardo.
 */
export function exportarInventarioResguardo(dataList) {
    if (!dataList || dataList.length === 0) {
        alert("No hay datos para exportar.");
        return;
    }

    // Mapeo a columnas exactas del Resguardo
    const rows = dataList.map(item => {
        // Formateo de fecha DD / MM / AAAA
        let vto = item.expirationDate || "N/A";
        if (typeof vto === 'number') {
            const d = excelSerialDateToJS(vto);
            vto = d.toLocaleDateString('es-CL').replace(/\//g, ' / ');
        } else if (vto.includes('-')) {
            const [y, m, d] = vto.split('-');
            vto = `${d} / ${m} / ${y}`;
        }

        return {
            "ID_Producto": item.code || "S/I",
            "Descripción": item.name || "Sin nombre",
            "Cantidad": item.quantity || 0,
            "Costo_Unitario": item.unitPrice || 0,
            "Lote": item.batch || "N/A",
            "Fecha_Vencimiento": vto,
            "Ubicación": item.location || "Bodega Central",
            "Categoría": item.category || "General"
        };
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Resguardo_Inventario");

    // Descarga el archivo
    const timestamp = new Date().toISOString().split('T')[0];
    XLSX.writeFile(workbook, `Resguardo_Inventario_SAR_${timestamp}.xlsx`);
}
