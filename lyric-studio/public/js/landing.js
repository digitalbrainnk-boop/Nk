// Pages publiques : accueil (présentation, démo animée, tarifs), inscription, connexion, conditions.
import { h, toast, modal } from "./ui.js";
import { api } from "./api.js";
import { session, loadMe, appName, whatsappLink } from "./session.js";
import { Renderer } from "./core/render.js";
import { mergeStyle, defaultStyle, frameSize } from "./core/style.js";
import { parseLyrics } from "./core/lyrics.js";
import { ensureFont } from "./fonts.js";
import { installButton } from "./install.js";

export function topNav({ cta = true } = {}) {
  return h(
    "header",
    { class: "site-nav" },
    h("a", { class: "brand", href: "#/" }, h("img", { src: "/icon.svg", alt: "", width: 30, height: 30 }), appName()),
    h(
      "nav",
      {},
      h("a", { href: "#/#fonctions" }, "Fonctions"),
      h("a", { href: "#/tarifs" }, "Tarifs"),
      h("a", { href: "#/connexion" }, "Connexion"),
      cta && h("a", { class: "btn primary small", href: "#/inscription" }, "Essai gratuit"),
    ),
  );
}

export function footer() {
  const c = session.config || {};
  const wa = whatsappLink();
  return h(
    "footer",
    { class: "site-footer" },
    h("div", {}, h("strong", {}, appName()), h("p", { class: "hint" }, c.tagline)),
    h(
      "div",
      { class: "footer-links" },
      wa && h("a", { href: wa, target: "_blank", rel: "noopener" }, "💬 WhatsApp"),
      c.support_email && h("a", { href: `mailto:${c.support_email}` }, `✉ ${c.support_email}`),
      h("a", { href: "#/cgu" }, "Conditions d'utilisation"),
      h("a", { href: "#/confidentialite" }, "Confidentialité"),
    ),
    h("small", { class: "hint" }, `© ${new Date().getFullYear()} ${appName()}`),
  );
}

/** Petite vidéo de démonstration dessinée en direct avec le vrai moteur de rendu. */
function demoCanvas() {
  const canvas = h("canvas", { class: "demo-canvas", width: 960, height: 540, "aria-label": "Exemple de vidéo karaoké" });
  const lines = parseLyrics("Chante avec moi ce soir\nSous les étoiles de la ville\nLaisse ton cœur danser\nJusqu'au bout de la nuit");
  let t0 = 1.2;
  for (const l of lines) {
    for (const w of l.words) {
      w.start = t0;
      w.end = t0 + 0.42;
      t0 += 0.5;
    }
    t0 += 0.8;
  }
  const style = mergeStyle(defaultStyle(), {
    highlight: "wipe",
    font: { family: "Poppins", weight: 800, size: 74 },
    colors: { sung: "#ffd23f", outlineWidth: 4, glow: 18, glowColor: "#ff4d8d" },
    layout: { display: "alternate", lines: 2, position: "center", preRoll: 1.2, animation: "slide-up" },
    background: { type: "gradient", gradient: ["#2b0a4d", "#a0136b", "#ff7a00"], angle: 120, animate: true, vignette: 0.45 },
    effects: {
      particles: "bokeh",
      particleCount: 26,
      particleColor: "#ffd9f0",
      particleOpacity: 0.4,
      progress: true,
      progressColor: "#ffd23f",
    },
    intro: { title: false },
  });
  const project = { title: "", artist: "", lines, style, duration: t0 + 1 };
  const r = new Renderer();
  const ctx = canvas.getContext("2d");
  const start = performance.now();
  let raf;
  ensureFont(style, project).then(() => r.measures.clear());
  const frame = (now) => {
    if (!canvas.isConnected) return cancelAnimationFrame(raf);
    const t = ((now - start) / 1000) % project.duration;
    r.draw(ctx, canvas.width, canvas.height, t, project, {});
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return canvas;
}

const FEATURES = [
  [
    "✨",
    "Synchronisation automatique",
    "L'IA écoute ta chanson et cale chaque mot au bon moment. Tu peux tout retoucher à la main, au doigt près.",
  ],
  ["🎶", "Karaoké sans la voix", "La voix est retirée par IA pour chanter par-dessus, avec une petite voix guide si tu veux."],
  ["🎨", "Tout se personnalise", "70 polices, couleurs, dégradés, lueur, bandeau, 10 animations, particules, visualiseur, ton logo…"],
  ["👥", "Duos", "Chaque chanteur a sa couleur, son côté de l'écran et son nom."],
  ["📱", "Sur ton téléphone", "Installe l'application sur Android et crée tes vidéos où tu veux."],
  ["🎬", "Export HD et 4K", "MP4 pour YouTube, TikTok, Reels, Statut WhatsApp et Facebook, en 720p, 1080p ou 4K."],
];

export function planCards(onPick) {
  const plans = session.config?.plans || {};
  return h(
    "div",
    { class: "plans" },
    Object.entries(plans).map(([id, p]) => {
      const facts = [
        `${p.maxProjects} projets`,
        `${p.aiMinutes} min d'IA par mois`,
        `${p.exportsPerMonth} exports par mois`,
        `Jusqu'à ${p.maxResolution}`,
        p.watermark ? "Avec filigrane" : "Sans filigrane",
        p.stems ? "Voix séparée par IA" : "Voix retirée simple",
        `Chansons jusqu'à ${p.maxMinutes} min`,
      ];
      return h(
        "article",
        { class: `plan-card${id === "pro" ? " featured" : ""}` },
        id === "pro" && h("span", { class: "plan-badge" }, "Le plus choisi"),
        h("h3", {}, p.name),
        h(
          "div",
          { class: "price" },
          p.price && p.price !== "0" ? p.price : "Gratuit",
          p.period && p.price !== "0" && h("small", {}, ` / ${p.period}`),
        ),
        p.features && h("p", { class: "plan-features" }, p.features),
        h(
          "ul",
          {},
          facts.map((f) => h("li", {}, f)),
        ),
        h(
          "button",
          { class: `btn ${id === "pro" ? "primary" : ""} full`, onclick: () => onPick(id) },
          id === "free" ? "Commencer gratuitement" : `Choisir ${p.name}`,
        ),
      );
    }),
  );
}

export function renderLanding(root) {
  const c = session.config || {};
  const hero = h(
    "section",
    { class: "hero" },
    h(
      "div",
      { class: "hero-text" },
      h("h1", {}, "Tes chansons en ", h("span", { class: "grad" }, "vidéos lyriques"), " et ", h("span", { class: "grad" }, "karaoké")),
      h("p", { class: "lead" }, c.tagline || "Synchronisées mot par mot, en quelques minutes."),
      h(
        "div",
        { class: "row gap wrap" },
        h("a", { class: "btn primary big", href: "#/inscription" }, "Créer mon compte gratuit"),
        h("a", { class: "btn big", href: "#/connexion" }, "J'ai déjà un compte"),
      ),
      installButton("big"),
      c.android_app_url &&
        h("a", { class: "btn big", href: c.android_app_url, target: "_blank", rel: "noopener" }, "▶ Télécharger sur Android"),
      h("p", { class: "hint" }, "Sans carte bancaire · Paiement Mobile Money pour les formules payantes"),
    ),
    h("div", { class: "hero-demo" }, demoCanvas()),
  );
  const features = h(
    "section",
    { class: "features", id: "fonctions" },
    h("h2", {}, "Tout ce qu'il faut pour des vidéos qui donnent envie de chanter"),
    h(
      "div",
      { class: "feature-grid" },
      FEATURES.map(([icon, title, text]) =>
        h("article", { class: "feature" }, h("div", { class: "feature-icon" }, icon), h("h3", {}, title), h("p", {}, text)),
      ),
    ),
  );
  const steps = h(
    "section",
    { class: "steps-section" },
    h("h2", {}, "Comment ça marche"),
    h(
      "ol",
      { class: "how" },
      h(
        "li",
        {},
        h("strong", {}, "Importe ta chanson"),
        h("span", {}, "MP3, WAV, vidéo MP4… et colle les paroles (ou laisse l'IA les écrire)."),
      ),
      h(
        "li",
        {},
        h("strong", {}, "Synchronise et personnalise"),
        h("span", {}, "Un clic pour caler les paroles, puis choisis police, couleurs, fond, effets."),
      ),
      h("li", {}, h("strong", {}, "Exporte et partage"), h("span", {}, "Télécharge ta vidéo MP4 et publie-la partout.")),
    ),
  );
  const pricing = h(
    "section",
    { class: "pricing", id: "tarifs" },
    h("h2", {}, "Tarifs"),
    planCards(() => (location.hash = "#/inscription")),
  );
  root.replaceChildren(h("div", { class: "site" }, topNav(), hero, features, steps, pricing, footer()));
  if (location.hash.includes("#fonctions")) document.getElementById("fonctions")?.scrollIntoView();
}

export function renderPricing(root) {
  root.replaceChildren(
    h(
      "div",
      { class: "site" },
      topNav(),
      h(
        "section",
        { class: "pricing page" },
        h("h1", {}, "Tarifs"),
        h("p", { class: "lead" }, "Commence gratuitement, passe à une formule payante quand tu veux. Paiement par Mobile Money."),
        planCards((id) => (location.hash = session.me ? "#/compte" : "#/inscription")),
      ),
      footer(),
    ),
  );
}

// ---------- Inscription et connexion ----------
function authPage(root, { title, form, alt }) {
  root.replaceChildren(
    h(
      "div",
      { class: "site" },
      topNav({ cta: false }),
      h("div", { class: "auth-wrap" }, h("form", { class: "card auth", ...form.attrs }, h("h1", {}, title), ...form.children, alt)),
      footer(),
    ),
  );
  root.querySelector("form input")?.focus();
}

export function renderLogin(root, onDone) {
  const email = h("input", { type: "email", placeholder: "Adresse e-mail", autocomplete: "email", required: true });
  const pass = h("input", { type: "password", placeholder: "Mot de passe", autocomplete: "current-password", required: true });
  const err = h("p", { class: "form-error", role: "alert" });
  const btn = h("button", { class: "btn primary big full", type: "submit" }, "Se connecter");
  authPage(root, {
    title: "Connexion",
    form: {
      attrs: {
        onsubmit: async (e) => {
          e.preventDefault();
          btn.disabled = true;
          err.textContent = "";
          try {
            await api("/api/auth/login", { method: "POST", json: { email: email.value, password: pass.value } });
            await loadMe();
            onDone();
          } catch (x) {
            err.textContent = x.message;
            btn.disabled = false;
          }
        },
      },
      children: [
        email,
        pass,
        err,
        btn,
        h("button", { class: "btn ghost small", type: "button", onclick: forgot }, "Mot de passe oublié ?"),
      ],
    },
    alt: h("p", { class: "hint" }, "Pas encore de compte ? ", h("a", { href: "#/inscription" }, "Créer un compte gratuit")),
  });
}

function forgot() {
  const wa = whatsappLink(`Bonjour, j'ai oublié mon mot de passe ${appName()}. Mon e-mail : `);
  const mail = session.config?.support_email;
  modal({
    title: "Mot de passe oublié",
    body: h(
      "div",
      {},
      h(
        "p",
        {},
        "Contacte le support avec l'adresse e-mail de ton compte : il te donnera un mot de passe provisoire, à changer ensuite dans « Mon compte ».",
      ),
      wa && h("a", { class: "btn primary", href: wa, target: "_blank", rel: "noopener" }, "💬 Écrire sur WhatsApp"),
      mail && h("p", {}, "Ou par e-mail : ", h("a", { href: `mailto:${mail}` }, mail)),
    ),
    actions: [{ label: "OK", onClick: (c) => c() }],
  });
}

export function renderSignup(root, onDone) {
  if (session.config && !session.config.signup_open) {
    root.replaceChildren(
      h(
        "div",
        { class: "site" },
        topNav({ cta: false }),
        h(
          "div",
          { class: "auth-wrap" },
          h(
            "div",
            { class: "card auth" },
            h("h1", {}, "Inscriptions fermées"),
            h("p", {}, "Les inscriptions sont fermées pour le moment. Reviens bientôt !"),
          ),
        ),
        footer(),
      ),
    );
    return;
  }
  const name = h("input", { type: "text", placeholder: "Ton nom ou nom d'artiste", autocomplete: "name", maxlength: "80" });
  const email = h("input", { type: "email", placeholder: "Adresse e-mail", autocomplete: "email", required: true });
  const phone = h("input", { type: "tel", placeholder: "Téléphone / WhatsApp (facultatif)", autocomplete: "tel", maxlength: "30" });
  const pass = h("input", {
    type: "password",
    placeholder: "Mot de passe (8 caractères au moins)",
    autocomplete: "new-password",
    minlength: "8",
    required: true,
  });
  const accept = h("input", { type: "checkbox", required: true });
  const err = h("p", { class: "form-error", role: "alert" });
  const btn = h("button", { class: "btn primary big full", type: "submit" }, "Créer mon compte");
  authPage(root, {
    title: "Créer un compte",
    form: {
      attrs: {
        onsubmit: async (e) => {
          e.preventDefault();
          btn.disabled = true;
          err.textContent = "";
          try {
            await api("/api/auth/signup", {
              method: "POST",
              json: { name: name.value, email: email.value, phone: phone.value, password: pass.value, accept: accept.checked },
            });
            await loadMe();
            toast(`Bienvenue sur ${appName()} !`, "ok");
            onDone();
          } catch (x) {
            err.textContent = x.message;
            btn.disabled = false;
          }
        },
      },
      children: [
        name,
        email,
        phone,
        pass,
        h(
          "label",
          { class: "check" },
          accept,
          h(
            "span",
            {},
            "J'accepte les ",
            h("a", { href: "#/cgu", target: "_blank" }, "conditions d'utilisation"),
            " et la ",
            h("a", { href: "#/confidentialite", target: "_blank" }, "politique de confidentialité"),
            ".",
          ),
        ),
        err,
        btn,
      ],
    },
    alt: h("p", { class: "hint" }, "Déjà un compte ? ", h("a", { href: "#/connexion" }, "Se connecter")),
  });
}

// ---------- Conditions ----------
function defaultTerms(name) {
  return `Conditions générales d'utilisation de ${name}

1. Le service
${name} permet de créer des vidéos lyriques et karaoké à partir de chansons importées par l'utilisateur.

2. Compte
Tu es responsable de ton compte et de ton mot de passe. Un compte est personnel.

3. Contenus
Tu dois avoir le droit d'utiliser les chansons, paroles, images et vidéos que tu importes (tes propres créations, ou une autorisation de leurs auteurs). Tu restes propriétaire de tes contenus ; tu nous autorises seulement à les traiter pour fabriquer tes vidéos.
Il est interdit d'importer des contenus illégaux, haineux ou portant atteinte aux droits d'autrui. Nous pouvons suspendre un compte en cas d'abus.

4. Formules et paiement
La formule gratuite est limitée (nombre de projets, minutes d'IA, qualité, filigrane). Les formules payantes sont activées pour la durée payée, après vérification du paiement. Sauf obligation légale, une période entamée n'est pas remboursée.

5. Disponibilité
Nous faisons de notre mieux pour que le service fonctionne en continu, sans pouvoir le garantir. Pense à télécharger tes vidéos : les fichiers d'un compte supprimé ou inactif peuvent être effacés.

6. Contact
Pour toute question, contacte le support (WhatsApp ou e-mail indiqués sur le site).`;
}

function defaultPrivacy(name) {
  return `Politique de confidentialité de ${name}

Données collectées : ton nom, ton adresse e-mail, ton téléphone (facultatif), les fichiers que tu importes (sons, images, vidéos, paroles) et les vidéos que tu crées.

Utilisation : uniquement pour faire fonctionner le service (ton compte, tes projets, tes exports, le suivi de ta formule) et te contacter à propos de ton compte. Nous ne vendons pas tes données.

Services d'intelligence artificielle : pour la synchronisation automatique, le son de ta chanson peut être envoyé à un service de transcription (par exemple Groq, OpenAI ou ElevenLabs) qui renvoie les mots et leur minutage.

Conservation : tes données sont gardées tant que ton compte existe. Tu peux supprimer ton compte et tous tes fichiers à tout moment depuis « Mon compte ».

Sécurité : les mots de passe sont chiffrés ; chaque compte n'a accès qu'à ses propres projets.

Contact : pour exercer tes droits (accès, rectification, suppression), contacte le support.`;
}

export function renderLegal(root, kind) {
  const name = appName();
  const text = kind === "cgu" ? session.config?.terms || defaultTerms(name) : session.config?.privacy || defaultPrivacy(name);
  const [first, ...rest] = text.split("\n");
  root.replaceChildren(
    h(
      "div",
      { class: "site" },
      topNav(),
      h(
        "article",
        { class: "legal" },
        h("h1", {}, first),
        rest
          .join("\n")
          .split(/\n{2,}/)
          .map((para) => h("p", {}, ...para.split("\n").flatMap((l, i) => (i ? [h("br"), l] : [l])))),
      ),
      footer(),
    ),
  );
}
