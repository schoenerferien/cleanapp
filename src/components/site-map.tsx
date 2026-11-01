"use client";

import "leaflet/dist/leaflet.css";
import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";

export type MapPoint = {
  id: string;
  lat: number;
  lng: number;
  title: string;
  subtitle?: string;
  lines?: string[];
  color?: string;
  href?: string;
};

export default function SiteMap({ points, height = 420 }: { points: MapPoint[]; height?: number }) {
  if (points.length === 0) {
    return <div className="flex items-center justify-center rounded-xl border text-sm text-muted-foreground" style={{ height }}>Keine Objekte mit Koordinaten.</div>;
  }
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const bounds: [[number, number], [number, number]] = [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)],
  ];
  return (
    <MapContainer bounds={bounds} boundsOptions={{ padding: [40, 40], maxZoom: 14 }} style={{ height }} className="z-0 rounded-xl border">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {points.map((p) => (
        <CircleMarker key={p.id} center={[p.lat, p.lng]} radius={10} pathOptions={{ color: p.color ?? "#0f766e", fillOpacity: 0.7 }}>
          <Popup>
            <strong>{p.href ? <a href={p.href}>{p.title}</a> : p.title}</strong>
            {p.subtitle && <div>{p.subtitle}</div>}
            {p.lines?.map((l) => (
              <div key={l}>{l}</div>
            ))}
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
