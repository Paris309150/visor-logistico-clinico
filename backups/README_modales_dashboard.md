# 📦 Backup de Seguridad y Registro de Cambios
**Fecha del Backup**: 21 de Abril de 2026
**Versión**: `20260421_v1_ModalesDashboard`

## Archivos Respaldados
Los siguientes archivos operativos han sido clonados en esta carpeta `backups\` para permitir un Rollback exacto en caso de ser necesario:
- `script_20260421_v1_ModalesDashboard.js`
- `index_20260421_v1_ModalesDashboard.html`
- `style_20260421_v1_ModalesDashboard.css`

## 🛠 Qué se hizo en esta versión:
Se conectó la interfaz del Panel de Control principal a la base de datos Firestore mediante la inyección de **tres modales asíncronos**:

1. **Modal "Ver Reporte de Descarte" (Tarjeta Urgencias)**
   - Convirtió un enlace estático a un botón dinámico con el trigger `handleReporteDescarte()`.
   - Lee desde Firestore (`collection: 'Insumos'`) filtrando dinámicamente con `where('estado', '==', 'VENCIDO')`.
   - Modificación visual: Se añadió una columna "CANTIDAD" para facilitar la generación del Acta de Baja.

2. **Modal "Planificar Rotación" (Tarjeta Precaución)**
   - Implementado para ser operado directamente por el **Equipo de Logística**.
   - Query en Firestore: Busca stock cuya fecha de vencimiento(`expirationDate`) se encuentre en el rango entre **hoy (exclusivo) y 6 meses a futuro**.
   - Interfaz (UI): Eliminado el enfoque estático anterior. Se unificó Producto + Lote y se añadió una columna prominente de "**UBICACIÓN ACTUAL**" para buscar el ítem. 
   - Acción sugerida: Se cambió el badge estático por un botón activo ("Mover a Box") para invitar a la reasignación en el sistema logístico.

3. **Modal "Análisis IA de Inventario"**
   - Ejecuta consultas paralelas masivas (`Promise.all()`) para extraer conteos de stock crítico (bajo mínimos) y lotes ya vencidos.
   - Brinda recomendaciones y genera KPIs estructurados basándose en la información extraída y el capital económico en riesgo.

### 🔙 Cómo hacer Rollback
Si alguna actualización futura rompe el proyecto, arrastra el contenido de estos 3 archivos respaldados y pégalos en sus versiones originales en la carpeta raíz (sobrescribiendo `script.js`, `index.html` y `style.css`).
