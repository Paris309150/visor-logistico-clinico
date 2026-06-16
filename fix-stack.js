const fs = require('fs');

// 1. Fix script.js
let scriptCode = fs.readFileSync('script.js', 'utf8');

// Fix infinite loop
scriptCode = scriptCode.replace(
    'if (!modal) { window.showAlertCenter("Mensaje del Sistema", mensaje); return; }',
    'if (!modal) { window.alert(titulo + ": " + mensaje); return; }'
);

// Fix missing 'limit' export
scriptCode = scriptCode.replace(
    'window.firebaseFirestore = { setDoc, doc, serverTimestamp, query, collection, orderBy, getDocs, updateDoc, runTransaction, increment, getDoc, where };',
    'window.firebaseFirestore = { setDoc, doc, serverTimestamp, query, collection, orderBy, getDocs, updateDoc, runTransaction, increment, getDoc, where, limit };'
);

fs.writeFileSync('script.js', scriptCode, 'utf8');

// 2. Fix index.html
let htmlCode = fs.readFileSync('index.html', 'utf8');

const modalAlertaCentro = `
    <!-- MODAL ALERTA CENTRO -->
    <div id="modal-alerta-centro" style="display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.7); z-index: 9999999; justify-content: center; align-items: center; backdrop-filter: blur(5px);">
        <div style="background: white; padding: 35px; border-radius: 16px; width: 450px; max-width: 90%; text-align: center; box-shadow: 0 15px 35px rgba(0,0,0,0.2); animation: scaleIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);">
            <div id="alerta-centro-icono" style="font-size: 4em; margin-bottom: 15px;"></div>
            <h3 id="alerta-centro-titulo" style="margin-top: 0; font-size: 1.6em; margin-bottom: 15px;">Notificación</h3>
            <p id="alerta-centro-mensaje" style="font-size: 1.15em; color: #495057; line-height: 1.5; margin-bottom: 25px;"></p>
            <button class="btn btn-primary" onclick="document.getElementById('modal-alerta-centro').style.display='none'" style="font-size: 1.1em; padding: 12px 35px; border-radius: 8px; font-weight: 600;">Entendido</button>
        </div>
    </div>
    <style>
        @keyframes scaleIn {
            from { transform: scale(0.8); opacity: 0; }
            to { transform: scale(1); opacity: 1; }
        }
    </style>
</body>`;

if (!htmlCode.includes('id="modal-alerta-centro"')) {
    htmlCode = htmlCode.replace('</body>', modalAlertaCentro);
}

// Update cache buster
htmlCode = htmlCode.replace(/script\.js\?v=[\d\.\-\w]+/, 'script.js?v=9.3-FixStack');
fs.writeFileSync('index.html', htmlCode, 'utf8');

console.log("Fixes applied.");
