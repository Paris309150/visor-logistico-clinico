const fs = require('fs');

const rules = \`rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // -----------------------------------------------------
    // FUNCIONES DE APOYO (HELPERS)
    // -----------------------------------------------------
    function isAuthenticated() {
      return request.auth != null;
    }

    function getUserRoleByDoc(docId) {
      return exists(/databases/$(database)/documents/Usuarios/$(docId)) 
        ? get(/databases/$(database)/documents/Usuarios/$(docId)).data.get('rol', 
            get(/databases/$(database)/documents/Usuarios/$(docId)).data.get('role', 'operador')
          ).lower()
        : 'operador';
    }

    function getUserRole() {
      return exists(/databases/$(database)/documents/Usuarios/$(request.auth.token.email)) 
        ? getUserRoleByDoc(request.auth.token.email)
        : getUserRoleByDoc(request.auth.uid);
    }

    function isAdmin() {
      return getUserRole() in ['admin', 'superadmin', 'administrador', 'global'];
    }

    function isSuperAdmin() {
      return getUserRole() == 'superadmin';
    }

    function isOperadorOrAdmin() {
      return getUserRole() in ['admin', 'superadmin', 'administrador', 'global', 'operador'];
    }

    function isOwner(userId) {
      return isAuthenticated() && (request.auth.uid == userId || request.auth.token.email == userId);
    }

    // -----------------------------------------------------
    // GESTIÓN DE ROLES (RBAC DINÁMICO) - Mantenido por compatibilidad
    // -----------------------------------------------------
    match /Roles/{roleId} {
      allow read: if isAuthenticated();
      allow write: if isAdmin();
    }

    // -----------------------------------------------------
    // GESTIÓN DE USUARIOS MÉTODOS RBAC
    // -----------------------------------------------------
    match /Usuarios/{userId} {
      allow read: if isOwner(userId) || isAdmin();
      allow write: if isAdmin() || isOwner(userId);
    }

    // -----------------------------------------------------
    // GESTIÓN DE BODEGAS (Sucursales)
    // -----------------------------------------------------
    match /Bodegas/{bodegaId} {
      allow read: if isAuthenticated();
      allow write: if isAdmin();
    }

    // -----------------------------------------------------
    // CIBERSEGURIDAD: Reglas de la Colección 'Insumos'
    // -----------------------------------------------------
    match /Insumos/{insumoId} {
      // Enfermeros también ven el panel, así que necesitan leer
      allow read: if isAuthenticated();
      
      // Operador, Admin, Superadmin pueden gestionar
      allow create: if isOperadorOrAdmin();
      allow update: if isOperadorOrAdmin();
      allow delete: if isOperadorOrAdmin();
    }
    
    // -----------------------------------------------------
    // AUDITORÍA INMUTABLE: Log de cambios locales
    // -----------------------------------------------------
    match /Insumos/{insumoId}/audit_logs/{logId} {
      // Regla de "Append-Only"
      allow create: if isAuthenticated() && request.resource.data.action == 'ACTUALIZACION';
      allow read: if isAuthenticated();
      allow update: if false; 
      allow delete: if isSuperAdmin();
    }

    // -----------------------------------------------------
    // HISTORIAL GLOBAL (Bitácora de todos los movimientos)
    // -----------------------------------------------------
    match /Historial_Movimientos/{movId} {
      allow read: if isAuthenticated();
      allow create: if isAuthenticated() && request.resource.data.quantity >= 0;
      allow update: if false;
      allow delete: if isSuperAdmin();
    }

    // -----------------------------------------------------
    // INFORMES Y AUDITORÍA DE ERRORES
    // -----------------------------------------------------
    match /informes/{id} {
       allow read, write: if isAdmin() || isOperadorOrAdmin();
    }

    match /Logs_Sistema/{id} {
       allow read, write: if isAdmin();
    }
    
    match /Solicitudes_Criticas/{id} {
       allow read, write: if isAdmin();
    }
    
    match /Auditoria/{id} {
       allow read, write: if isAdmin();
    }
    
    match /Configuracion/global {
      allow read: if isAuthenticated();
      allow write: if isAdmin();
    }

    match /Metadata/{id} {
       allow read: if isAuthenticated();
       allow update, create: if isAuthenticated();
       allow write: if isAdmin();
    }

    match /ajustes_sistema/{id} {
       allow read: if isAuthenticated();
       allow write: if isAdmin() || isOperadorOrAdmin();
    }

    // -----------------------------------------------------
    // GESTIÓN DE BANDEJAS DE TURNO
    // -----------------------------------------------------
    match /Bandejas_Turno/{bandejaId} {
      allow read: if isAuthenticated();
      allow create, update: if isAuthenticated();
      allow delete: if isAdmin() || isOperadorOrAdmin();
    }

    // -----------------------------------------------------
    // INTELIGENCIA OPERATIVA (Estadísticas SAR)
    // -----------------------------------------------------
    match /Estadisticas_Operativas/{id} {
       allow read: if isAuthenticated();
       allow write: if isAuthenticated();
    }
  }
}
\`;

fs.writeFileSync('firestore.rules', rules);
console.log('firestore.rules updated successfully!');
