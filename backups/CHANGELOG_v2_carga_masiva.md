# 📦 Registro de Cambios y Backup de Seguridad
**Fecha del Backup**: 21 de Abril de 2024
**Versión**: `20260421_v2_CargaMasivaBusqueda`

## Archivos Respaldados
- `index_20260421_v2_CargaMasivaBusqueda.html`
- `script_20260421_v2_CargaMasivaBusqueda.js`
- `style_20260421_v2_CargaMasivaBusqueda.css`
- `excelUtils_20260421_v2_CargaMasivaBusqueda.js`

## 🛠 Cambios Realizados en esta Versión:
Se han implementado funcionalidades críticas de administración y búsqueda en el módulo de Inventario:

1. **Esquema de Datos SAR Unificado**
   - Creación de `excelUtils.js` como motor de arquitectura de datos.
   - Definición de los 9 campos obligatorios de la Guía de Despacho SAR (id_producto, descripción, cantidad, etc.).

2. **Búsqueda Manual de Medicamentos**
   - Integración de input de búsqueda con icono Phosphor.
   - Implementación de **debouncing (400ms)** para evitar consultas innecesarias a Firestore.
   - Algoritmo de búsqueda por prefijo para filtrado instantáneo por nombre de insumo.

3. **Carga y Descarga Masiva (Excel)**
   - Integración de la librería **SheetJS (xlsx)** vía CDN.
   - Función de generación automática de **Plantilla Excel Oficial** con encabezados validados.
   - Motor de importación masiva con:
     - **Validación Estructural**: Comprueba que el archivo subido cumpla exactamente con el esquema SAR.
     - **Ingesta por Bloques (Batches)**: Envío transaccional a Firestore en grupos de 400 registros para máxima estabilidad.
     - **Mapeo Semántico**: Conversión automática de columnas de Excel a campos internos de la base de datos (e.g., `descripcion` -> `name`).

### 🔙 Instrucciones de Rollback
Para revertir a este estado:
1. Localiza los archivos correspondientes en la carpeta `/backups`.
2. Renómbralos eliminando el prefijo de fecha/versión para que queden como `index.html`, `script.js`, `style.css` y `excelUtils.js`.
3. Sobrescribe los archivos en el directorio raíz del proyecto.
