// Annuler / rétablir : instantanés des paroles, du style et du titre.
const KEYS = ["title", "artist", "lyricsText", "lines", "style"];

export class History {
  constructor(project, { limit = 100 } = {}) {
    this.limit = limit;
    this.reset(project);
  }

  snap(project) {
    return JSON.stringify(Object.fromEntries(KEYS.map((k) => [k, project[k]])));
  }

  reset(project) {
    this.stack = [this.snap(project)];
    this.index = 0;
  }

  /** Enregistre l'état actuel (si différent du précédent). */
  commit(project) {
    const s = this.snap(project);
    if (s === this.stack[this.index]) return false;
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(s);
    if (this.stack.length > this.limit) this.stack.shift();
    this.index = this.stack.length - 1;
    return true;
  }

  canUndo() {
    return this.index > 0;
  }

  canRedo() {
    return this.index < this.stack.length - 1;
  }

  /** Remet le projet dans l'état précédent ; renvoie true si quelque chose a changé. */
  undo(project) {
    if (!this.canUndo()) return false;
    this.index--;
    Object.assign(project, JSON.parse(this.stack[this.index]));
    return true;
  }

  redo(project) {
    if (!this.canRedo()) return false;
    this.index++;
    Object.assign(project, JSON.parse(this.stack[this.index]));
    return true;
  }
}
