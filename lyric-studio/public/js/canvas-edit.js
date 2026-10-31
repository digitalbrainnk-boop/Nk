// Édition directe sur l'aperçu : toucher les paroles ou un calque le sélectionne ; le glisser le déplace
// (aimanté au centre de l'image) ; la poignée du coin l'agrandit ; la poignée du haut le fait tourner.
// Toucher le fond lance ou arrête la lecture, comme avant.
import { h } from "./ui.js";
import { GRAPHICS } from "./core/style.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

export class CanvasEditor {
  constructor(studio, bar) {
    this.studio = studio;
    this.canvas = studio.canvas;
    this.bar = bar;
    this.sel = null; // { kind: "text" } ou { kind: "layer", id }
    this.drag = null;
    this.guides = { x: false, y: false };
    this.canvas.style.touchAction = "none";
    this.canvas.addEventListener("pointerdown", (e) => this.down(e));
    this.canvas.addEventListener("pointermove", (e) => this.move(e));
    this.canvas.addEventListener("pointerup", (e) => this.up(e));
    this.canvas.addEventListener("pointercancel", (e) => this.up(e, true));
    this.renderBar();
  }

  get style() {
    return this.studio.project.style;
  }

  get boxes() {
    return this.studio.renderer.boxes || { text: null, layers: [] };
  }

  /** Pixels de l'image par pixel affiché (les poignées gardent la même taille à l'écran). */
  get k() {
    const r = this.canvas.getBoundingClientRect();
    return r.width ? this.canvas.width / r.width : 1;
  }

  pt(e) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * this.canvas.width) / r.width,
      y: ((e.clientY - r.top) * this.canvas.height) / r.height,
    };
  }

  /** Point exprimé dans le repère du cadre (sans sa rotation). */
  local(box, p) {
    const c = Math.cos(-box.rot);
    const s = Math.sin(-box.rot);
    const dx = p.x - box.px;
    const dy = p.y - box.py;
    return { x: box.px + dx * c - dy * s, y: box.py + dx * s + dy * c };
  }

  world(box, x, y) {
    const c = Math.cos(box.rot);
    const s = Math.sin(box.rot);
    const dx = x - box.px;
    const dy = y - box.py;
    return { x: box.px + dx * c - dy * s, y: box.py + dx * s + dy * c };
  }

  inside(box, p, pad = 0) {
    const q = this.local(box, p);
    return q.x >= box.x - pad && q.x <= box.x + box.w + pad && q.y >= box.y - pad && q.y <= box.y + box.h + pad;
  }

  handles(box) {
    return {
      resize: this.world(box, box.x + box.w, box.y + box.h),
      rotate: this.world(box, box.x + box.w / 2, box.y - 34 * this.k),
    };
  }

  layer(id = this.sel?.id) {
    return this.style.layers.find((l) => l.id === id) || null;
  }

  selectedBox() {
    if (!this.sel) return null;
    if (this.sel.kind === "text") return this.boxes.text;
    return this.boxes.layers.find((b) => b.id === this.sel.id) || null;
  }

  hit(p) {
    const box = this.selectedBox();
    const R = 18 * this.k;
    if (box) {
      const hd = this.handles(box);
      if (Math.hypot(p.x - hd.resize.x, p.y - hd.resize.y) < R) return { ...this.sel, part: "resize" };
      if (Math.hypot(p.x - hd.rotate.x, p.y - hd.rotate.y) < R) return { ...this.sel, part: "rotate" };
    }
    // Ordre d'affichage : calques derrière, paroles, calques devant -> on teste du dessus vers le dessous.
    const front = new Set(this.style.layers.filter((l) => l.front).map((l) => l.id));
    const layers = [...this.boxes.layers].reverse();
    for (const b of layers) if (front.has(b.id) && this.inside(b, p)) return { kind: "layer", id: b.id, part: "move" };
    if (this.boxes.text && this.inside(this.boxes.text, p, 12 * this.k)) return { kind: "text", part: "move" };
    for (const b of layers) if (!front.has(b.id) && this.inside(b, p)) return { kind: "layer", id: b.id, part: "move" };
    return null;
  }

  select(sel) {
    const same = JSON.stringify(sel) === JSON.stringify(this.sel);
    this.sel = sel;
    this.studio.needsRender = true;
    if (!same) {
      this.renderBar();
      if (sel?.kind === "layer") this.studio.inspector.showLayer(sel.id);
    }
  }

  down(e) {
    const p = this.pt(e);
    const hit = this.hit(p);
    this.drag = { p0: p, hit, moved: false };
    if (!hit) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.select({ kind: hit.kind, ...(hit.id ? { id: hit.id } : {}) });
    const box = this.selectedBox();
    if (hit.kind === "text") {
      const L = this.style.layout;
      this.drag.orig = {
        x: L.x || 0,
        y: box ? box.py / this.canvas.height : (L.y ?? 0.5),
        size: this.style.font.size,
        rot: L.rotate || 0,
      };
    } else {
      const l = this.layer(hit.id);
      this.drag.orig = { x: l.x, y: l.y, size: l.size, rot: l.rotate || 0 };
    }
    if (box) this.drag.center = { x: box.px, y: box.py };
  }

  move(e) {
    const p = this.pt(e);
    const d = this.drag;
    if (!d) {
      const hit = this.hit(p);
      this.canvas.style.cursor = !hit ? "pointer" : hit.part === "resize" ? "nwse-resize" : hit.part === "rotate" ? "grab" : "move";
      return;
    }
    if (!d.hit) return;
    if (!d.moved && Math.hypot(p.x - d.p0.x, p.y - d.p0.y) < 5 * this.k) return;
    d.moved = true;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const o = d.orig;
    const snap = 10 * this.k;
    this.guides = { x: false, y: false };
    if (d.hit.part === "move") {
      let cx = d.center.x + (p.x - d.p0.x);
      let cy = d.center.y + (p.y - d.p0.y);
      if (Math.abs(cx - W / 2) < snap) ((cx = W / 2), (this.guides.x = true));
      if (Math.abs(cy - H / 2) < snap) ((cy = H / 2), (this.guides.y = true));
      const dx = (cx - d.center.x) / W;
      const dy = (cy - d.center.y) / H;
      if (d.hit.kind === "text") {
        const L = this.style.layout;
        L.position = "custom";
        L.x = round(clamp(o.x + dx, -0.5, 0.5));
        L.y = round(clamp(o.y + dy, 0.02, 0.98));
      } else {
        const l = this.layer(d.hit.id);
        l.x = round(clamp(o.x + dx, -0.5, 1.5));
        l.y = round(clamp(o.y + dy, -0.5, 1.5));
      }
    } else if (d.hit.part === "resize") {
      const c = d.center;
      const ratio = Math.max(0.05, Math.hypot(p.x - c.x, p.y - c.y) / Math.max(1, Math.hypot(d.p0.x - c.x, d.p0.y - c.y)));
      if (d.hit.kind === "text") this.style.font.size = Math.round(clamp(o.size * ratio, 12, 300));
      else this.layer(d.hit.id).size = round(clamp(o.size * ratio, 0.02, 3));
    } else if (d.hit.part === "rotate") {
      const c = d.center;
      let a = o.rot + ((Math.atan2(p.y - c.y, p.x - c.x) - Math.atan2(d.p0.y - c.y, d.p0.x - c.x)) * 180) / Math.PI;
      a = ((((a + 180) % 360) + 360) % 360) - 180;
      // Aimanté sur 0°, 90°, 180°, -90°.
      for (const q of [-180, -90, 0, 90, 180]) if (Math.abs(a - q) < 4) a = q;
      if (d.hit.kind === "text") this.style.layout.rotate = Math.round(a);
      else this.layer(d.hit.id).rotate = Math.round(a);
    }
    this.studio.styleChanged(d.hit.kind === "text" ? (d.hit.part === "resize" ? "font.size" : "layout.drag") : "layers.move", {
      live: true,
    });
  }

  up(e, cancelled = false) {
    const d = this.drag;
    this.drag = null;
    this.guides = { x: false, y: false };
    if (!d) return;
    if (d.moved && !cancelled) {
      this.studio.styleChanged(d.hit.kind === "text" ? "layout.drag" : "layers.move", {});
      this.studio.inspector.refresh();
    } else if (!d.hit) {
      // Toucher le fond : on enlève la sélection et on lance ou arrête la lecture.
      if (this.sel) this.select(null);
      else this.studio.audio.toggle();
    }
    this.studio.needsRender = true;
  }

  /** Flèches du clavier : déplace l'élément choisi (dx, dy en fraction de l'image). */
  nudge(dx, dy) {
    if (!this.sel) return;
    if (this.sel.kind === "text") {
      const L = this.style.layout;
      if (L.position !== "custom") L.y = round((this.boxes.text?.py ?? this.canvas.height * 0.8) / this.canvas.height);
      L.position = "custom";
      L.x = round(clamp((L.x || 0) + dx, -0.5, 0.5));
      L.y = round(clamp(L.y + dy, 0.02, 0.98));
      this.studio.styleChanged("layout.drag", { live: true });
    } else {
      const l = this.layer();
      if (!l) return;
      l.x = round(clamp(l.x + dx, -0.5, 1.5));
      l.y = round(clamp(l.y + dy, -0.5, 1.5));
      this.studio.styleChanged("layers.move", { live: true });
    }
    this.studio.inspector.refresh();
  }

  /** Cadre de sélection, poignées et repères, dessinés seulement dans l'aperçu (jamais dans la vidéo). */
  drawOverlay(ctx) {
    const box = this.selectedBox();
    const W = this.canvas.width;
    const H = this.canvas.height;
    const k = this.k;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.guides.x || this.guides.y) {
      ctx.strokeStyle = "#ff4d8d";
      ctx.lineWidth = 1.5 * k;
      ctx.setLineDash([6 * k, 6 * k]);
      ctx.beginPath();
      if (this.guides.x) (ctx.moveTo(W / 2, 0), ctx.lineTo(W / 2, H));
      if (this.guides.y) (ctx.moveTo(0, H / 2), ctx.lineTo(W, H / 2));
      ctx.stroke();
    }
    if (box) {
      ctx.translate(box.px, box.py);
      ctx.rotate(box.rot);
      ctx.translate(-box.px, -box.py);
      ctx.setLineDash([7 * k, 5 * k]);
      ctx.lineWidth = 2 * k;
      ctx.strokeStyle = "#ffffff";
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 4 * k;
      ctx.strokeRect(box.x, box.y, box.w, box.h);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(box.x + box.w / 2, box.y);
      ctx.lineTo(box.x + box.w / 2, box.y - 34 * k);
      ctx.stroke();
      const dot = (x, y, color) => {
        ctx.beginPath();
        ctx.arc(x, y, 9 * k, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 2 * k;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
      };
      dot(box.x + box.w, box.y + box.h, "#ff4d8d");
      dot(box.x + box.w / 2, box.y - 34 * k, "#7c6cff");
    }
    ctx.restore();
  }

  /** Barre d'outils sous l'aperçu pour l'élément sélectionné. */
  renderBar() {
    const bar = this.bar;
    if (!this.sel) {
      bar.replaceChildren(
        h(
          "span",
          { class: "hint" },
          "Astuce : touche les paroles ou une image sur l'aperçu pour la déplacer, l'agrandir (●) ou la tourner (●).",
        ),
      );
      return;
    }
    const s = this.studio;
    const btn = (label, title, onclick) => h("button", { class: "btn small", title, onclick }, label);
    if (this.sel.kind === "text") {
      const L = this.style.layout;
      bar.replaceChildren(
        h("strong", {}, "Paroles"),
        btn(
          "A−",
          "Plus petit",
          () => ((this.style.font.size = Math.max(12, this.style.font.size - 6)), s.styleChanged("font.size", {}), s.inspector.refresh()),
        ),
        btn(
          "A+",
          "Plus grand",
          () => ((this.style.font.size = Math.min(300, this.style.font.size + 6)), s.styleChanged("font.size", {}), s.inspector.refresh()),
        ),
        btn("↻ 90°", "Tourner (texte vertical sur un côté)", () => {
          L.rotate = L.rotate === 0 ? -90 : L.rotate === -90 ? 90 : 0;
          s.styleChanged("layout.rotate", {});
          s.inspector.refresh();
        }),
        btn("⊕ Centrer", "Remettre au centre", () => {
          Object.assign(L, { position: "custom", x: 0, y: 0.5, rotate: 0 });
          s.styleChanged("layout.drag", {});
          s.inspector.refresh();
        }),
        btn("⚙ Réglages", "Tous les réglages des paroles", () => s.inspector.open("Position des paroles")),
        h(
          "button",
          {
            class: "icon-btn",
            title: "Fermer",
            onclick: () => this.select(null),
          },
          "✕",
        ),
      );
      return;
    }
    const l = this.layer();
    if (!l) return this.select(null);
    const name = l.kind === "shape" ? GRAPHICS.find((g) => g[0] === l.graphic)?.[1] || "Élément" : l.kind === "video" ? "Vidéo" : "Image";
    bar.replaceChildren(
      h("strong", {}, name),
      btn(l.front ? "⬇ Derrière le texte" : "⬆ Devant le texte", "Passer devant ou derrière les paroles", () => {
        l.front = !l.front;
        s.styleChanged("layers.order", {});
        this.renderBar();
        s.inspector.refresh();
      }),
      btn("⧉", "Dupliquer", () => s.duplicateLayer(l.id)),
      btn("🗑", "Supprimer", () => s.removeLayer(l.id)),
      btn("⚙ Réglages", "Tous les réglages du calque", () => s.inspector.open("Calques et superpositions")),
      h(
        "button",
        {
          class: "icon-btn",
          title: "Fermer",
          onclick: () => this.select(null),
        },
        "✕",
      ),
    );
  }
}
