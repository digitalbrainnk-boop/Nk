import Image from "next/image";
import { EventCard } from "@/components/sport/event-card";
import type { ListedEvent } from "@/lib/data/events";
import { getSport } from "@/lib/sports/catalog";

export function CompetitionGroup({ group }: { group: { name: string; country: string; flag: string | null; logo: string | null; sport: ListedEvent["sport"]; events: ListedEvent[] } }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted">
        {group.logo ? <Image src={group.logo} alt="" width={18} height={18} className="size-[18px] object-contain" /> : <span aria-hidden>{getSport(group.sport).emoji}</span>}
        <span className="truncate">
          {group.country === "World" ? "International" : group.country} · {group.name}
        </span>
        <span className="ml-auto text-faint">{group.events.length}</span>
      </h3>
      <div className="space-y-2">
        {group.events.map((e) => (
          <EventCard key={e.id} event={e} />
        ))}
      </div>
    </section>
  );
}
