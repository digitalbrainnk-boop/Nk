// Mon compte : formule et consommation, demande d'abonnement (paiement Mobile Money vérifié par l'administrateur),
// profil, mot de passe, suppression du compte.
import { h, toast, modal, field, confirmBox } from "./ui.js";
import { api } from "./api.js";
import { session, loadMe, whatsappLink, fmtDate, appName } from "./session.js";
import { planCards } from "./landing.js";
import { usageBars } from "./home.js";

const STATUS = { pending: "⏳ En attente de vérification", approved: "✅ Validée", rejected: "❌ Refusée" };

export async function renderAccount(root, nav) {
  await loadMe();
  const me = session.me;
  const requests = await api("/api/me/requests").catch(() => []);
  const until = me.user.plan_until && me.plan.id !== "free" ? ` · jusqu'au ${fmtDate(me.user.plan_until)}` : "";
  const planBox = h(
    "section",
    { class: "card" },
    h("h2", {}, "Ma formule"),
    h("p", {}, h("span", { class: `badge plan-${me.plan.id}` }, me.plan.name), until),
    usageBars(),
  );
  const requestBox = h("div", {});
  const showRequest = (planId) => {
    const plan = session.config.plans[planId];
    if (!plan || planId === "free") return;
    const months = h(
      "select",
      {},
      [1, 3, 6, 12].map((m) => h("option", { value: String(m) }, `${m} mois`)),
    );
    const reference = h("input", {
      type: "text",
      placeholder: "Référence de la transaction (ex. : MP240115.1234.A12345)",
      maxlength: "120",
    });
    const note = h("textarea", { rows: 2, placeholder: "Numéro qui a payé, moyen de paiement… (facultatif)", maxlength: "500" });
    const wa = whatsappLink(`Bonjour, je souhaite la formule ${plan.name} sur ${appName()} (compte : ${me.user.email}).`);
    requestBox.replaceChildren(
      h(
        "section",
        { class: "card request-card" },
        h("h2", {}, `Passer à la formule ${plan.name}`),
        h("p", { class: "price" }, plan.price, plan.period && h("small", {}, ` / ${plan.period}`)),
        h(
          "div",
          { class: "pay-instructions" },
          ...String(session.config.payment_instructions || "")
            .split("\n")
            .map((l) => h("p", {}, l)),
        ),
        wa && h("a", { class: "btn", href: wa, target: "_blank", rel: "noopener" }, "💬 Demander le numéro de paiement sur WhatsApp"),
        h("div", { class: "grid2" }, field("Durée", months), field("Référence du paiement", reference)),
        field("Message", note),
        h(
          "button",
          {
            class: "btn primary big",
            onclick: async () => {
              try {
                await api("/api/me/requests", {
                  method: "POST",
                  json: { plan: planId, months: Number(months.value), reference: reference.value, note: note.value },
                });
                toast("Demande envoyée : ta formule sera activée dès la vérification du paiement.", "ok", 7000);
                renderAccount(root, nav);
              } catch (e) {
                toast(e.message, "error");
              }
            },
          },
          "J'ai payé : envoyer ma demande",
        ),
      ),
    );
    requestBox.scrollIntoView({ behavior: "smooth" });
  };
  const offers =
    me.user.role === "admin"
      ? null
      : h(
          "section",
          { class: "card" },
          h("h2", {}, "Changer de formule"),
          planCards((id) => (id === "free" ? toast("Tu as déjà accès à la formule gratuite.", "info") : showRequest(id))),
          requestBox,
        );
  const history = requests.length
    ? h(
        "section",
        { class: "card" },
        h("h2", {}, "Mes demandes"),
        h(
          "table",
          { class: "table" },
          h("tr", {}, h("th", {}, "Date"), h("th", {}, "Formule"), h("th", {}, "Durée"), h("th", {}, "Référence"), h("th", {}, "État")),
          requests.map((r) =>
            h(
              "tr",
              {},
              h("td", {}, fmtDate(r.created_at)),
              h("td", {}, session.config.plans[r.plan]?.name || r.plan),
              h("td", {}, `${r.months} mois`),
              h("td", {}, r.reference || "—"),
              h("td", {}, STATUS[r.status] || r.status),
            ),
          ),
        ),
      )
    : null;

  const name = h("input", { type: "text", value: me.user.name, maxlength: "80" });
  const phone = h("input", { type: "tel", value: me.user.phone, maxlength: "30" });
  const profile = h(
    "section",
    { class: "card" },
    h("h2", {}, "Mon profil"),
    h("p", { class: "hint" }, me.user.email),
    h("div", { class: "grid2" }, field("Nom", name), field("Téléphone / WhatsApp", phone)),
    h(
      "button",
      {
        class: "btn",
        onclick: async () => {
          try {
            await api("/api/me", { method: "PUT", json: { name: name.value, phone: phone.value } });
            await loadMe();
            toast("Profil enregistré.", "ok");
          } catch (e) {
            toast(e.message, "error");
          }
        },
      },
      "Enregistrer",
    ),
  );
  const current = h("input", { type: "password", autocomplete: "current-password" });
  const next = h("input", { type: "password", autocomplete: "new-password", minlength: "8" });
  const security = h(
    "section",
    { class: "card" },
    h("h2", {}, "Mot de passe"),
    h("div", { class: "grid2" }, field("Mot de passe actuel", current), field("Nouveau mot de passe", next)),
    h(
      "div",
      { class: "row gap wrap" },
      h(
        "button",
        {
          class: "btn",
          onclick: async () => {
            try {
              await api("/api/me/password", { method: "PUT", json: { current: current.value, next: next.value } });
              current.value = next.value = "";
              toast("Mot de passe changé.", "ok");
            } catch (e) {
              toast(e.message, "error");
            }
          },
        },
        "Changer le mot de passe",
      ),
      h("span", { class: "spacer" }),
      h("button", { class: "btn danger", onclick: () => deleteAccount() }, "Supprimer mon compte"),
    ),
  );
  root.replaceChildren(
    h(
      "div",
      { class: "app-page" },
      nav(),
      h("div", { class: "home" }, h("h1", {}, "Mon compte"), planBox, offers, history, profile, security),
    ),
  );
}

function deleteAccount() {
  const pass = h("input", { type: "password", placeholder: "Ton mot de passe", autocomplete: "current-password" });
  modal({
    title: "Supprimer mon compte",
    body: h("div", {}, h("p", {}, "Tous tes projets, fichiers et vidéos seront effacés définitivement."), pass),
    actions: [
      { label: "Annuler", onClick: (c) => c() },
      {
        label: "Supprimer définitivement",
        danger: true,
        onClick: async (close) => {
          if (!(await confirmBox("Dernière confirmation : tout supprimer ?", { ok: "Oui, supprimer", danger: true }))) return;
          try {
            await api("/api/me", { method: "DELETE", json: { password: pass.value } });
            close();
            session.me = null;
            location.hash = "#/";
            location.reload();
          } catch (e) {
            toast(e.message, "error");
          }
        },
      },
    ],
  });
}
