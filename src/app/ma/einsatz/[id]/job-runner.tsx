"use client";

import imageCompression from "browser-image-compression";
import { Camera, CheckCircle2, Loader2, MapPin, Navigation, Play, Square, Trash2, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { deletePhoto, finishJob, saveNote, startJob, toggleChecklistItem, type FieldResult } from "@/server/actions/field";

type Job = {
  id: string;
  date: string;
  plannedStart: string;
  plannedMinutes: number;
  title: string;
  status: string;
  notes: string | null;
  checklistDone: string[];
  reviewComment: string | null;
  siteName: string;
  street: string | null;
  zip: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  instructions: string | null;
  checklist: string[];
  geofenceM: number;
};
type Photo = { id: string; kind: string; caption: string | null; mine: boolean };
type Pos = { lat: number; lng: number; accuracy: number } | null;

function getPosition(): Promise<Pos> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  });
}

function distanceToast(r: FieldResult, verb: string) {
  if (!r.ok) return toast.error(r.error);
  if (r.distanceM == null) return toast.warning(`${verb} – ohne Standort (GPS nicht verfügbar oder nicht erlaubt).`);
  if (r.geofenceM != null && r.distanceM > r.geofenceM) return toast.warning(`${verb} – ${r.distanceM} m vom Objekt entfernt ⚠`);
  toast.success(`${verb} – ${r.distanceM} m vom Objekt ✓`);
}

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

export function JobRunner({
  job,
  openEntry,
  doneEntries,
  photos,
}: {
  job: Job;
  openEntry: { startAt: string; distanceM: number | null } | null;
  doneEntries: { startAt: string; endAt: string }[];
  photos: Photo[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(new Set(job.checklistDone));
  const [note, setNote] = useState(job.notes ?? "");
  const [now, setNow] = useState(() => Date.now());
  const running = Boolean(openEntry);
  const finished = !running && (job.status === "erledigt" || job.status === "abgenommen");
  const canWork = running;

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [running]);

  const count = (k: string) => photos.filter((p) => p.kind === k).length;
  const navUrl =
    job.lat != null && job.lng != null
      ? `https://www.google.com/maps/dir/?api=1&destination=${job.lat},${job.lng}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${job.street ?? ""} ${job.zip ?? ""} ${job.city ?? ""}`)}`;

  function onStart() {
    startTransition(async () => {
      const r = await startJob(job.id, await getPosition());
      distanceToast(r, "Eingestempelt");
      router.refresh();
    });
  }

  function onFinish() {
    if (!confirm("Einsatz jetzt beenden und ausstempeln?")) return;
    startTransition(async () => {
      await saveNote(job.id, note);
      const r = await finishJob(job.id, await getPosition());
      distanceToast(r, "Ausgestempelt");
      router.refresh();
    });
  }

  function onToggle(item: string, checked: boolean) {
    const next = new Set(done);
    if (checked) next.add(item);
    else next.delete(item);
    setDone(next);
    void toggleChecklistItem(job.id, item, checked);
  }

  const elapsedMin = openEntry ? Math.max(0, Math.round((now - new Date(openEntry.startAt).getTime()) / 60_000)) : 0;

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm text-muted-foreground">
              {job.plannedStart} · {job.title}
            </p>
            <h1 className="text-xl font-semibold">{job.siteName}</h1>
            <p className="flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="size-3.5" /> {[job.street, [job.zip, job.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}
            </p>
          </div>
          <StatusBadge status={running ? "laufend" : job.status} />
        </div>
        <Button variant="outline" className="h-11 w-full" asChild>
          <a href={navUrl} target="_blank" rel="noreferrer">
            <Navigation /> Navigation starten
          </a>
        </Button>
      </section>

      {job.status === "nacharbeit" && job.reviewComment && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/40 dark:text-red-200">
          <strong>Nacharbeit:</strong> {job.reviewComment}
        </div>
      )}

      {job.instructions && (
        <div className="rounded-xl bg-muted p-3 text-sm">
          <p className="mb-1 font-medium">Arbeitsanweisung</p>
          {job.instructions}
        </div>
      )}

      {!running && !finished && (
        <Button className="h-16 w-full bg-teal-700 text-lg hover:bg-teal-800" onClick={onStart} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Play />} Einsatz starten
        </Button>
      )}

      {running && openEntry && (
        <div className="rounded-xl border border-sky-300 bg-sky-50 p-3 text-sm dark:bg-sky-950/30">
          Eingestempelt seit <strong>{fmtTime(openEntry.startAt)}</strong> ({Math.floor(elapsedMin / 60)} Std {elapsedMin % 60} Min)
          {openEntry.distanceM != null && (
            <span>
              {" "}
              · {openEntry.distanceM} m vom Objekt {openEntry.distanceM <= job.geofenceM ? "✓" : "⚠"}
            </span>
          )}
        </div>
      )}

      {finished && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm dark:bg-emerald-950/30">
          <CheckCircle2 className="size-5 text-emerald-600" />
          Erledigt {doneEntries.map((e) => `${fmtTime(e.startAt)}–${fmtTime(e.endAt)}`).join(", ")}
        </div>
      )}

      {(running || finished) && (
        <>
          {job.checklist.length > 0 && (
            <section>
              <h2 className="mb-2 font-semibold">Checkliste</h2>
              <div className="space-y-1">
                {job.checklist.map((item) => (
                  <label key={item} className="flex items-center gap-3 rounded-xl border bg-background p-3 text-base">
                    <input
                      type="checkbox"
                      className="size-6 accent-teal-700"
                      checked={done.has(item)}
                      disabled={!canWork}
                      onChange={(e) => onToggle(item, e.target.checked)}
                    />
                    {item}
                  </label>
                ))}
              </div>
            </section>
          )}

          <p className="flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <TriangleAlert className="size-4 shrink-0" /> Bitte keine Personen fotografieren – nur die gereinigten Flächen.
          </p>

          <PhotoSection jobId={job.id} kind="vorher" title="Vorher" photos={photos} editable={canWork} />
          <PhotoSection jobId={job.id} kind="nachher" title="Nachher" photos={photos} editable={canWork} />
          <PhotoSection jobId={job.id} kind="mangel" title="Mängel melden (optional)" photos={photos} editable={canWork} withCaption />

          <section>
            <h2 className="mb-2 font-semibold">Notiz an das Büro</h2>
            <Textarea
              rows={3}
              value={note}
              disabled={!canWork}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => canWork && void saveNote(job.id, note)}
              placeholder="z. B. Reinigungsmittel fast leer"
            />
          </section>
        </>
      )}

      {running && (
        <div className="sticky bottom-20 pt-2">
          <Button
            className="h-16 w-full text-lg"
            variant="default"
            onClick={onFinish}
            disabled={pending || count("vorher") < 1 || count("nachher") < 1}
          >
            {pending ? <Loader2 className="animate-spin" /> : <Square />} Einsatz beenden
          </Button>
          {(count("vorher") < 1 || count("nachher") < 1) && (
            <p className="mt-1 text-center text-xs text-muted-foreground">Zum Beenden mindestens 1 Vorher- und 1 Nachher-Foto aufnehmen.</p>
          )}
        </div>
      )}
    </div>
  );
}

function PhotoSection({
  jobId,
  kind,
  title,
  photos,
  editable,
  withCaption,
}: {
  jobId: string;
  kind: "vorher" | "nachher" | "mangel";
  title: string;
  photos: Photo[];
  editable: boolean;
  withCaption?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [caption, setCaption] = useState("");
  const list = photos.filter((p) => p.kind === kind);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      // Verkleinern und neu kodieren – entfernt dabei auch die EXIF-Metadaten
      const small = await imageCompression(file, { maxSizeMB: 0.5, maxWidthOrHeight: 1600, useWebWorker: true, fileType: "image/jpeg", initialQuality: 0.8 });
      // Kein Standort beim Foto – GPS wird nur beim Ein- und Ausstempeln erfasst (Datensparsamkeit)
      const fd = new FormData();
      fd.set("jobId", jobId);
      fd.set("kind", kind);
      fd.set("file", small, "foto.jpg");
      if (caption) fd.set("caption", caption);
      const res = await fetch("/api/photos", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Upload fehlgeschlagen");
      setCaption("");
      toast.success("Foto gespeichert");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="mb-2 font-semibold">
        {title} <span className="text-sm font-normal text-muted-foreground">({list.length})</span>
      </h2>
      <div className="grid grid-cols-3 gap-2">
        {list.map((p) => (
          <figure key={p.id} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/photos/${p.id}`} alt={p.caption ?? title} className="aspect-square w-full rounded-lg object-cover" />
            {p.caption && <figcaption className="mt-0.5 line-clamp-2 text-xs">{p.caption}</figcaption>}
            {editable && p.mine && (
              <button
                type="button"
                aria-label="Foto löschen"
                className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white"
                onClick={async () => {
                  if (!confirm("Foto löschen?")) return;
                  const r = await deletePhoto(p.id);
                  if (!r.ok) toast.error(r.error);
                  router.refresh();
                }}
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </figure>
        ))}
        {editable && (
          <label
            className={`flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-sm text-muted-foreground active:bg-muted ${busy ? "pointer-events-none opacity-60" : ""}`}
          >
            {busy ? <Loader2 className="size-6 animate-spin" /> : <Camera className="size-6" />}
            {busy ? "Lädt …" : "Foto"}
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
          </label>
        )}
      </div>
      {editable && withCaption && (
        <Input className="mt-2 h-10" placeholder="Was ist der Mangel? (vor dem Foto eintragen)" value={caption} onChange={(e) => setCaption(e.target.value)} />
      )}
    </section>
  );
}
