const fs = require('fs');

let code = fs.readFileSync('c:/Users/usuario/Documents/VISOR/script.js', 'utf8');

// 1. Patch Login Catch Block
const loginRegex = /\} catch \(error\) \{\s*console\.error\("Fallo Auth:", error\);\s*window\.showToast\("Acceso Denegado", "Su credencial es inválida o carece de permisos para ingresar\.", "error"\);\s*\}/m;

const loginReplacement = `} catch (error) {
                console.error("Fallo Auth:", error);
                let titulo = "Acceso Denegado";
                let mensaje = "Su credencial es inválida o carece de permisos para ingresar.";
                
                if (error.code === 'auth/too-many-requests') {
                    titulo = "Cuenta Bloqueada Temporalmente";
                    mensaje = "Por seguridad, el acceso ha sido bloqueado debido a múltiples intentos fallidos. Intente nuevamente en unos minutos.";
                } else if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password') {
                    mensaje = "El correo o la contraseña son incorrectos.";
                }
                window.showToast(titulo, mensaje, "error");
            }`;

if (loginRegex.test(code)) {
    code = code.replace(loginRegex, loginReplacement);
    console.log("Login UX patched.");
} else {
    console.log("Login UX regex not found.");
}

// 2. Patch Memory Leak
const leakRegex = /\/\/ ==========================================\s*\/\/ AUTO-LOGOUT POR INACTIVIDAD \(15 Minutos\)\s*\/\/ ==========================================\s*if \(window\.inactivityTimeout\) clearTimeout\(window\.inactivityTimeout\);\s*const resetInactivityTimer = \(\) => \{\s*if \(window\.inactivityTimeout\) clearTimeout\(window\.inactivityTimeout\);\s*\/\/ 15 minutos = 900,000 ms\s*window\.inactivityTimeout = setTimeout\(async \(\) => \{\s*console\.warn\("Cerrando sesión por inactividad\."\);\s*await signOut\(auth\);\s*window\.location\.reload\(\); \/\/ Asegurar estado limpio\s*\}, 900000\);\s*\};\s*\/\/ Escuchar eventos globales\s*\['mousemove', 'keydown', 'touchstart', 'scroll', 'click'\]\.forEach\(evt => \{\s*document\.addEventListener\(evt, resetInactivityTimer, \{ passive: true \}\);\s*\}\);\s*\/\/ Iniciar por primera vez\s*resetInactivityTimer\(\);/gm;

const leakReplacement = `// ==========================================
            // AUTO-LOGOUT POR INACTIVIDAD (30 Minutos - SINGLETON)
            // ==========================================
            if (!window.inactivityListenersAttached) {
                window.resetInactivityTimer = () => {
                    if (window.inactivityTimeout) clearTimeout(window.inactivityTimeout);
                    // 30 minutos = 1,800,000 ms
                    window.inactivityTimeout = setTimeout(async () => {
                        console.warn("Cerrando sesión por inactividad prolongada (30m).");
                        await signOut(auth);
                        window.location.reload(); 
                    }, 1800000); 
                };

                ['mousemove', 'keydown', 'touchstart', 'scroll', 'click'].forEach(evt => {
                    document.addEventListener(evt, window.resetInactivityTimer, { passive: true });
                });
                
                window.inactivityListenersAttached = true;
            }
            if (window.resetInactivityTimer) window.resetInactivityTimer();`;

if (leakRegex.test(code)) {
    code = code.replace(leakRegex, leakReplacement);
    console.log("Memory Leak patched.");
} else {
    console.log("Memory Leak regex not found.");
}

fs.writeFileSync('c:/Users/usuario/Documents/VISOR/script.js', code);
console.log("File saved.");
