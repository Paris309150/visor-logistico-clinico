const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');

// The original view-usuarios starts at:
// <section id="view-usuarios" class="view-section">
//                 <div class="page-header mb-24">

// The second view-usuarios starts at:
// <section id="view-usuarios" class="view-section" style="display:none;">
//                 <div class="dashboard-container" style="padding: 30px; max-width: 1400px; margin: 0 auto;">

const firstViewStart = '<section id="view-usuarios" class="view-section">';
const secondViewStart = '<section id="view-usuarios" class="view-section" style="display:none;">';

let firstViewIdx = html.indexOf(firstViewStart);
let secondViewIdx = html.indexOf(secondViewStart);

if (firstViewIdx === -1 || secondViewIdx === -1) {
    console.error("Could not find both views");
    process.exit(1);
}

// 1. Delete the second view completely. It ends right before <!-- MODALS --> or something.
// Let's find the end of the second view.
const modalsStart = '<!-- VIEW: Panel IA -->'; // or whatever is next
let endOfSecondView = html.indexOf('</section>', secondViewIdx) + '</section>'.length;
// Wait, the second view has nested divs, so just finding the next </section> might be wrong.
// But wait, the second view is just before the modals: `<div id="modal-credenciales-usuario"`
// Let's just find the end of the second view by parsing or just extracting the string.

// Let's just use regex to replace the first view's content.

// Let's read the whole file to find out where the second view ends.
