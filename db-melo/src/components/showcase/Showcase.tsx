"use client";

// Vitrine musicale : des chansons créées avec DB.Mélo jouent dès l'arrivée sur l'accueil, avec un petit
// lecteur en bas de l'écran (pause, suivante, fermer) qui suit la navigation. Les navigateurs interdisant
// le son automatique sans geste, la musique démarre sinon au premier toucher sur la page. Elle se tait
// pendant la création, sur les pages de chanson et de cadeau, et dès qu'un autre son est lancé.

import { AnimatePresence, motion } from "framer-motion";
import { Pause, Play, SkipForward, X } from "lucide-react";
import Link from "next/link";
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
  const next = useCallback(() => void start(indexRef.current + 1), [start]);
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

  const show = songs.length > 0 && !closed && !QUIET.test(pathname) && (started || pathname === "/");
  const song = songs[index];
  useEffect(() => {
    document.documentElement.style.setProperty("--vitrine-h", show ? "84px" : "0px");
  }, [show]);

  return (
    <ShowcaseContext.Provider value={{ songs, index, playing, play, pause }}>
      {children}
      <AnimatePresence>
        {show && song && (
          <motion.div
            data-vitrine
            role="region"
            aria-label="Vitrine musicale DB.Mélo"
            className="fixed inset-x-0 bottom-0 z-30 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:right-4 sm:left-auto sm:w-96"
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
          >
            <div className="card flex items-center gap-3 p-2.5 pr-3 shadow-2xl shadow-black/60">
              {song.cover ? (
                <img
                  src={coverUrl(song)}
                  alt=""
                  className={`size-12 shrink-0 object-cover ${playing ? "animate-[spin_12s_linear_infinite] rounded-full" : "rounded-xl"}`}
                />
              ) : (
                <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-studio">
                  <LogoMark size={40} />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-sm font-bold">{started ? song.title : "Écoutez nos chansons"}</p>
                <p className="truncate text-xs text-muted">{started ? song.subtitle : "Créées pour de vraies personnes"}</p>
              </div>
              <button
                type="button"
                onClick={() => (playing ? pause() : play())}
                aria-label={playing ? "Pause" : "Écouter"}
                className={`btn btn-gold size-11 shrink-0 rounded-full p-0 ${!started ? "animate-pulse" : ""}`}
              >
                {playing ? <Pause className="size-5" /> : <Play className="size-5 translate-x-px" />}
              </button>
              {songs.length > 1 && (
                <button type="button" onClick={next} aria-label="Chanson suivante" className="btn-quiet shrink-0 p-1.5">
                  <SkipForward className="size-5" />
                </button>
              )}
              <button type="button" onClick={close} aria-label="Fermer le lecteur" className="btn-quiet shrink-0 p-1">
                <X className="size-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </ShowcaseContext.Provider>
  );
}

/** Section de l'accueil : les chansons de la vitrine, à écouter avant de créer la sienne. */
export function ShowcaseSection() {
  const showcase = useShowcase();
  if (!showcase?.songs.length) return null;
  const { songs, index, playing, play, pause } = showcase;
  return (
    <section className="mx-auto max-w-6xl px-4 pb-16" aria-labelledby="vitrine-titre">
      <p className="eyebrow">Chansons déjà offertes</p>
      <h2 id="vitrine-titre" className="mt-2 font-display text-3xl font-bold">
        Écoutez des chansons créées avec DB.Mélo
      </h2>
      <div className="-mx-4 mt-6 flex snap-x gap-4 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
        {songs.map((s, i) => {
          const current = i === index && playing;
          return (
            <button
              key={s.id}
              type="button"
              data-vitrine
              onClick={() => (current ? pause() : play(i))}
              className={`card group w-44 shrink-0 snap-start p-3 text-left transition ${current ? "border-gold/60" : ""}`}
            >
              <span className="relative block aspect-square overflow-hidden rounded-xl bg-studio">
                {s.cover ? (
                  <img src={coverUrl(s)} alt="" loading="lazy" className="size-full object-cover" />
                ) : (
                  <span className="flex size-full items-center justify-center">
                    <LogoMark size={96} />
                  </span>
                )}
                <span className="absolute right-2 bottom-2 flex size-10 items-center justify-center rounded-full bg-gold text-ink shadow-lg">
                  {current ? <Pause className="size-5" /> : <Play className="size-5 translate-x-px" />}
                </span>
              </span>
              <span className="mt-3 block truncate font-display font-bold">{s.title}</span>
              <span className="block truncate text-xs text-muted">{s.subtitle}</span>
            </button>
          );
        })}
      </div>
      <Link href="/studio" className="btn btn-gold mt-6">
        Créer la mienne
      </Link>
    </section>
  );
}
