"use client";

// Vitrine musicale : une petite barre en bas de l'écran présente les chansons créées avec DB.Mélo ; elles
// jouent dès l'arrivée sur l'accueil, et la musique suit la navigation. Les navigateurs interdisant
// le son automatique sans geste, la musique démarre sinon au premier toucher sur la page. Elle se tait
// pendant la création, sur les pages de chanson et de cadeau, et dès qu'un autre son est lancé.

import { AnimatePresence, motion } from "framer-motion";
import { Pause, Play, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/brand/Logo";

export interface ShowcaseSong {
  id: string;
  title: string;
  subtitle: string;
  cover: boolean;
}

interface ShowcaseState {
  songs: ShowcaseSong[];
  index: number;
  playing: boolean;
  play: (index?: number) => void;
  pause: () => void;
}

const ShowcaseContext = createContext<ShowcaseState | null>(null);
export const useShowcase = () => useContext(ShowcaseContext);

/** Pages où la vitrine se tait : création, chanson du client, page cadeau. */
const QUIET = /^\/(studio|chanson|cadeau)(\/|$)/;
const MEMORY = "dbmelo-vitrine";
const audioUrl = (s: ShowcaseSong) => `/api/vitrine/${s.id}/audio`;
const coverUrl = (s: ShowcaseSong) => `/api/vitrine/${s.id}/cover`;

function remember(value: "pause" | "ferme") {
  try {
    sessionStorage.setItem(MEMORY, value);
  } catch {}
}
function remembered(): string | null {
  try {
    return sessionStorage.getItem(MEMORY);
  } catch {
    return null;
  }
}

export function ShowcaseProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const audio = useRef<HTMLAudioElement | null>(null);
  const [songs, setSongs] = useState<ShowcaseSong[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [closed, setClosed] = useState(false);
  const indexRef = useRef(0);
  const songsRef = useRef<ShowcaseSong[]>([]);

  useEffect(() => {
    setClosed(remembered() === "ferme");
    fetch("/api/vitrine")
      .then((r) => r.json() as Promise<{ songs?: ShowcaseSong[] }>)
      .then((d) => {
        songsRef.current = d.songs ?? [];
        setSongs(d.songs ?? []);
      })
      .catch(() => {});
  }, []);

  const load = useCallback((i: number) => {
    const list = songsRef.current;
    const a = audio.current;
    if (!a || !list.length) return null;
    const n = ((i % list.length) + list.length) % list.length;
    if (indexRef.current !== n || !a.src) {
      a.src = audioUrl(list[n]);
      indexRef.current = n;
      setIndex(n);
    }
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: list[n].title,
        artist: "DB.Mélo",
        artwork: list[n].cover ? [{ src: coverUrl(list[n]), sizes: "512x512" }] : [{ src: "/icons/512", sizes: "512x512", type: "image/png" }],
      });
    }
    return a;
  }, []);

  /** Lance la lecture ; renvoie false si le navigateur attend un geste. */
  const start = useCallback(
    async (i = indexRef.current) => {
      const a = load(i);
      if (!a) return false;
      try {
        await a.play();
        setStarted(true);
        return true;
      } catch {
        return false;
      }
    },
    [load],
  );

  const play = useCallback(
    (i?: number) => {
      setClosed(false);
      void start(i);
    },
    [start],
  );
  const pause = useCallback(() => {
    audio.current?.pause();
    remember("pause");
  }, []);
  const close = () => {
    audio.current?.pause();
    remember("ferme");
    setClosed(true);
  };

  // Un seul lecteur pour tout le site, gardé d'une page à l'autre.
  useEffect(() => {
    const a = new Audio();
    a.preload = "none";
    a.volume = 0.8;
    a.onplay = () => setPlaying(true);
    a.onpause = () => setPlaying(false);
    a.onended = () => void start(indexRef.current + 1);
    audio.current = a;
    if ("mediaSession" in navigator) {
      navigator.mediaSession.setActionHandler("play", () => void a.play());
      navigator.mediaSession.setActionHandler("pause", () => a.pause());
      navigator.mediaSession.setActionHandler("nexttrack", () => void start(indexRef.current + 1));
    }
    // Un autre son démarre (chanson du client, voix d'essai…) : la vitrine se tait.
    const onOtherPlay = (e: Event) => {
      if (e.target !== a && e.target instanceof HTMLMediaElement) a.pause();
    };
    document.addEventListener("play", onOtherPlay, true);
    return () => {
      document.removeEventListener("play", onOtherPlay, true);
      a.pause();
    };
  }, [start]);

  // Dès l'arrivée sur l'accueil : lecture automatique, ou au premier toucher si le navigateur l'exige.
  useEffect(() => {
    if (pathname !== "/" || !songs.length || started || remembered()) return;
    let done = false;
    const onFirstTouch = (e: Event) => {
      const link = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (link && QUIET.test(new URL(link.href, location.href).pathname)) return; // on part créer : pas de musique
      if ((e.target as Element | null)?.closest?.("[data-vitrine]")) return; // les boutons du lecteur s'en chargent
      cleanup();
      void start();
    };
    const cleanup = () => {
      done = true;
      document.removeEventListener("click", onFirstTouch, true);
      document.removeEventListener("keydown", onFirstTouch, true);
    };
    start().then((ok) => {
      if (ok || done) return;
      document.addEventListener("click", onFirstTouch, true);
      document.addEventListener("keydown", onFirstTouch, true);
    });
    return cleanup;
  }, [pathname, songs.length, started, start]);

  // Création, chanson, cadeau : silence.
  useEffect(() => {
    if (QUIET.test(pathname)) audio.current?.pause();
  }, [pathname]);

  // Une petite barre en bas de l'écran, sur toutes les pages sauf celles où la vitrine se tait.
  const show = songs.length > 0 && !closed && !QUIET.test(pathname);
  // Hauteur réelle de la barre (zone du bas de l'iPhone comprise) : place réservée en bas de page et
  // pour les notifications d'installation, qui s'affichent juste au-dessus.
  const barRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = document.documentElement.style;
    const el = barRef.current;
    if (!show || !el) {
      root.setProperty("--vitrine-h", "0px");
      return;
    }
    const measure = () => root.setProperty("--vitrine-h", `${el.offsetHeight}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [show]);

  return (
    <ShowcaseContext.Provider value={{ songs, index, playing, play, pause }}>
      {children}
      <AnimatePresence>
        {show && (
          <motion.div
            ref={barRef}
            data-vitrine
            role="region"
            aria-label="Vitrine musicale DB.Mélo"
            className="fixed inset-x-0 bottom-0 z-30 border-gold/20 border-t bg-ink/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl"
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
          >
            <div className="mx-auto flex max-w-xl items-center gap-1 py-1.5 pr-1 pl-2">
              <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none]">
                {songs.map((s, i) => {
                  const current = i === index && playing;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => (current ? pause() : play(i))}
                      aria-label={`${current ? "Pause" : "Écouter"} : ${s.title}`}
                      aria-pressed={current}
                      className="flex w-[23.5%] min-w-[4.6rem] shrink-0 flex-col items-center gap-1 rounded-xl px-1 py-0.5 text-[10.5px] leading-tight"
                    >
                      <span
                        className={`relative flex size-8 items-center justify-center overflow-hidden rounded-full bg-studio ring-2 ${
                          current ? "ring-gold" : !started && i === 0 ? "animate-pulse ring-gold/70" : "ring-line"
                        }`}
                      >
                        {s.cover ? <img src={coverUrl(s)} alt="" loading="lazy" className="size-full object-cover" /> : <LogoMark size={32} />}
                        <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-cream">
                          {current ? <Pause className="size-3.5" /> : <Play className="size-3.5 translate-x-px" />}
                        </span>
                      </span>
                      <span className={`w-full truncate text-center font-semibold ${current ? "text-gold-soft" : "text-cream/80"}`}>{s.title}</span>
                    </button>
                  );
                })}
              </div>
              <button type="button" onClick={close} aria-label="Fermer la barre des chansons" className="btn-quiet shrink-0 self-start p-1">
                <X className="size-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </ShowcaseContext.Provider>
  );
}
