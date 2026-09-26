"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Network map.
 *
 * Deliberately hand-built from SVG rather than a tile-based map library: no
 * external tile provider is reachable in the deployment target, no API key is
 * needed, and the projection stays crisp at any zoom. Coordinates are projected
 * with an equirectangular projection scaled to the bounding box of the plotted
 * points, so relative positions are geographically correct.
 */

export interface MapStation {
  id: string;
  name: string;
  city: string;
  latitude: number;
  longitude: number;
  status: "online" | "offline" | "maintenance" | "archived";
  tankCount: number;
  totalFuel: number;
  capacity: number;
  activeAlerts: number;
  todayConsumption: number;
}

export interface MapVehicle {
  id: string;
  name: string;
  plateNumber: string;
  latitude: number | null;
  longitude: number | null;
  status: string;
  lastSeenAt: string | null;
}

interface Projected {
  station: MapStation;
  x: number;
  y: number;
  fillPct: number;
}

const STATUS_COLOR: Record<MapStation["status"], string> = {
  online: "var(--ok)",
  offline: "var(--crit)",
  maintenance: "var(--warn)",
  archived: "var(--ink-3)",
};

const STATUS_LABEL: Record<MapStation["status"], string> = {
  online: "Online",
  offline: "Offline",
  maintenance: "Maintenance",
  archived: "Archived",
};

/** Equirectangular projection into the given viewBox, preserving aspect ratio. */
function project(points: { latitude: number; longitude: number }[], width: number, height: number, padding: number) {
  if (points.length === 0) return { project: () => ({ x: 0, y: 0 }), bounds: null };
  const lats = points.map((point) => point.latitude);
  const lngs = points.map((point) => point.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  // Guard against a single-point or single-row dataset collapsing the scale.
  const latSpan = Math.max(maxLat - minLat, 0.01);
  const lngSpan = Math.max(maxLng - minLng, 0.01);

  // Longitude degrees are shorter than latitude degrees by cos(latitude).
  const latScale = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
  const aspect = Math.max((lngSpan * latScale) / latSpan, 0.05);

  const usableW = width - padding * 2;
  const usableH = height - padding * 2;
  let w = usableW;
  let h = w / aspect;
  if (h > usableH) {
    h = usableH;
    w = h * aspect;
  }
  const offsetX = (width - w) / 2;
  const offsetY = (height - h) / 2;

  return {
    bounds: { minLat, maxLat, minLng, maxLng },
    project: (point: { latitude: number; longitude: number }) => ({
      x: offsetX + ((point.longitude - minLng) / lngSpan) * w,
      y: offsetY + (1 - (point.latitude - minLat) / latSpan) * h,
    }),
  };
}

export function NetworkMap({
  stations,
  vehicles = [],
  selectedId,
  onSelect,
  height = 460,
  className,
}: {
  stations: MapStation[];
  vehicles?: MapVehicle[];
  selectedId?: string | null;
  onSelect?: (stationId: string) => void;
  height?: number;
  className?: string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  const width = 960;

  const projected = useMemo<Projected[]>(() => {
    const { project: toPoint } = project(stations, width, height, 48);
    return stations.map((station) => {
      const { x, y } = toPoint(station);
      const fillPct = station.capacity > 0 ? (station.totalFuel / station.capacity) * 100 : 0;
      return { station, x, y, fillPct };
    });
  }, [stations, height]);

  const vehiclesProjected = useMemo(() => {
    const withPosition = vehicles.filter(
      (vehicle): vehicle is MapVehicle & { latitude: number; longitude: number } =>
        vehicle.latitude != null && vehicle.longitude != null,
    );
    if (withPosition.length === 0) return [];
    const { project: toPoint } = project(
      [...stations, ...withPosition].map((entry) => ({ latitude: entry.latitude, longitude: entry.longitude })),
      width,
      height,
      48,
    );
    return withPosition.map((vehicle) => ({ vehicle, ...toPoint(vehicle) }));
  }, [stations, vehicles, height]);

  const active = hovered ?? selectedId ?? null;
  const activeProjection = projected.find((entry) => entry.station.id === active) ?? null;

  if (stations.length === 0) {
    return (
      <div
        className={cn("grid place-items-center rounded-2xl border border-dashed border-[var(--line-strong)] bg-[var(--surface-2)]", className)}
        style={{ height }}
      >
        <div className="max-w-sm px-6 text-center">
          <p className="text-[0.875rem] font-medium text-[var(--ink)]">No stations to plot yet</p>
          <p className="mt-2 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
            Stations appear here once they have coordinates. Add a station with its latitude and longitude and it will show
            up immediately.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("relative overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-2)]", className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="block w-full"
        style={{ height }}
        role="img"
        aria-label={`Network map showing ${stations.length} stations`}
      >
        <defs>
          <radialGradient id="map-glow" cx="50%" cy="40%" r="70%">
            <stop offset="0%" stopColor="var(--surface)" />
            <stop offset="100%" stopColor="var(--surface-2)" />
          </radialGradient>
          <pattern id="map-grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M 48 0 L 0 0 0 48" fill="none" stroke="var(--line)" strokeWidth="1" opacity="0.5" />
          </pattern>
        </defs>

        <rect width={width} height={height} fill="url(#map-glow)" />
        <rect width={width} height={height} fill="url(#map-grid)" />

        {/* Connections between nearby stations — purely a visual grouping aid. */}
        {projected.map((a, index) =>
          projected.slice(index + 1).map((b) => {
            const distance = Math.hypot(a.x - b.x, a.y - b.y);
            if (distance > 260) return null;
            return (
              <line
                key={`${a.station.id}-${b.station.id}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="var(--line-strong)"
                strokeWidth="1"
                strokeDasharray="3 5"
                opacity={0.55}
              />
            );
          }),
        )}

        {/* Station markers, sized by capacity. */}
        {projected.map(({ station, x, y, fillPct }) => {
          const radius = 8 + Math.min(10, Math.sqrt(station.capacity) / 12);
          const isActive = active === station.id;
          const color = STATUS_COLOR[station.status];
          return (
            <g
              key={station.id}
              transform={`translate(${x} ${y})`}
              className="cursor-pointer"
              onMouseEnter={() => setHovered(station.id)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(station.id)}
              onBlur={() => setHovered(null)}
              onClick={() => onSelect?.(station.id)}
              tabIndex={0}
              role="button"
              aria-label={`${station.name}, ${STATUS_LABEL[station.status]}, ${fillPct.toFixed(0)} percent full`}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect?.(station.id);
                }
              }}
            >
              {isActive ? (
                <circle r={radius + 9} fill={color} opacity={0.16} className="anim-pulse-ring" />
              ) : null}
              <circle
                r={radius}
                fill="var(--surface)"
                stroke={color}
                strokeWidth={isActive ? 3 : 2}
                className="transition-[stroke-width,r] duration-200"
              />
              {/* Fill ring shows stock level as a fraction of capacity. */}
              <circle
                r={radius - 3}
                fill="none"
                stroke={color}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * (radius - 3)}`}
                strokeDashoffset={`${2 * Math.PI * (radius - 3) * (1 - Math.min(1, fillPct / 100))}`}
                transform="rotate(-90)"
                opacity={0.9}
              />
              {station.activeAlerts > 0 ? (
                <g transform={`translate(${radius * 0.75} ${-radius * 0.75})`}>
                  <circle r={6} fill="var(--crit)" />
                  <text
                    textAnchor="middle"
                    y="3"
                    fontSize="8"
                    fontWeight="700"
                    fill="var(--on-crit)"
                    style={{ pointerEvents: "none" }}
                  >
                    {station.activeAlerts > 9 ? "9+" : station.activeAlerts}
                  </text>
                </g>
              ) : null}
              <text
                y={radius + 14}
                textAnchor="middle"
                fontSize="10.5"
                fontWeight={isActive ? 600 : 500}
                fill="var(--ink-2)"
                style={{ pointerEvents: "none" }}
              >
                {station.name.length > 18 ? `${station.name.slice(0, 17)}…` : station.name}
              </text>
            </g>
          );
        })}

        {/* Vehicles, when a position is known. */}
        {vehiclesProjected.map(({ vehicle, x, y }) => (
          <g key={vehicle.id} transform={`translate(${x} ${y})`} aria-hidden="true">
            <path
              d="M -4 -4 L 4 0 L -4 4 Z"
              fill="var(--brand)"
              stroke="var(--surface)"
              strokeWidth="1.2"
              transform={`rotate(${vehicle.status === "active" ? 0 : 180})`}
            />
          </g>
        ))}
      </svg>

      {/* Legend — never colour alone (PRD accessibility requirement). */}
      <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-x-4 gap-y-1.5 rounded-xl border border-[var(--line)] bg-[var(--surface)]/95 px-3 py-2 backdrop-blur">
        {(["online", "offline", "maintenance", "archived"] as const).map((status) => (
          <span key={status} className="flex items-center gap-1.5 text-[0.6875rem] text-[var(--ink-2)]">
            <span className="dot" style={{ background: STATUS_COLOR[status] }} />
            {STATUS_LABEL[status]}
          </span>
        ))}
        {vehicles.length > 0 ? (
          <span className="flex items-center gap-1.5 text-[0.6875rem] text-[var(--ink-2)]">
            <span className="dot" style={{ background: "var(--brand)" }} />
            Vehicle with position
          </span>
        ) : null}
      </div>

      {activeProjection ? (
        <div
          className="pointer-events-none absolute z-20 w-60 -translate-x-1/2 -translate-y-full rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 shadow-[var(--shadow-pop)]"
          style={{
            left: `${(activeProjection.x / width) * 100}%`,
            top: `${(activeProjection.y / height) * 100 - 3}%`,
          }}
          role="tooltip"
        >
          <p className="text-[0.8125rem] font-semibold text-[var(--ink)]">{activeProjection.station.name}</p>
          <p className="mt-0.5 text-[0.6875rem] text-[var(--ink-3)]">
            {activeProjection.station.city} · {STATUS_LABEL[activeProjection.station.status]}
          </p>
          <dl className="mt-2 space-y-1 text-[0.6875rem]">
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--ink-3)]">Stock</dt>
              <dd className="text-num font-medium text-[var(--ink)]">
                {Math.round(activeProjection.station.totalFuel).toLocaleString("en-US")} /{" "}
                {Math.round(activeProjection.station.capacity).toLocaleString("en-US")} L
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--ink-3)]">Fill</dt>
              <dd className="text-num font-medium text-[var(--ink)]">{activeProjection.fillPct.toFixed(0)}%</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--ink-3)]">Tanks</dt>
              <dd className="text-num font-medium text-[var(--ink)]">{activeProjection.station.tankCount}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--ink-3)]">Active alerts</dt>
              <dd className="text-num font-medium text-[var(--ink)]">{activeProjection.station.activeAlerts}</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </div>
  );
}
