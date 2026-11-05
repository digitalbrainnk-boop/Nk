// Page d'impression d'un reçu : format ticket 80 mm (imprimante thermique) ou A4.
const main = document.querySelector(".ticket");
const box = document.getElementById("ticket");
const apply = () => main.classList.toggle("narrow", box.checked);
box.addEventListener("change", apply);
apply();
document.getElementById("print").addEventListener("click", () => window.print());
setTimeout(() => window.print(), 400);
