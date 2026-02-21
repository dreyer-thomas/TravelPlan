"use client";

import { MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";
import { useEffect, useMemo } from "react";
import type { ReactElement } from "react";
// @ts-expect-error Leaflet types are not resolved in this build environment.
import L from "leaflet";
import type { TripDayMapPoint } from "@/components/features/trips/TripDayMapPanel";

const MapContainerCompat = MapContainer as unknown as (props: Record<string, unknown>) => ReactElement;
const MarkerCompat = Marker as unknown as (props: Record<string, unknown>) => ReactElement;
const PolylineCompat = Polyline as unknown as (props: Record<string, unknown>) => ReactElement;
const TileLayerCompat = TileLayer as unknown as (props: Record<string, unknown>) => ReactElement;

const FitToBounds = ({ points }: { points: TripDayMapPoint[] }) => {
  const map = useMap();

  useEffect(() => {
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points.map((point) => point.position));
    map.fitBounds(bounds, { padding: [24, 24] });
  }, [map, points]);

  return null;
};

const EnsureMapSized = () => {
  const map = useMap();

  useEffect(() => {
    const invalidate = () => {
      map.invalidateSize({ pan: false });
    };

    const timer = window.setTimeout(invalidate, 0);
    const raf = window.requestAnimationFrame(invalidate);
    window.addEventListener("resize", invalidate);

    return () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", invalidate);
    };
  }, [map]);

  return null;
};

type TripDayLeafletMapProps = {
  points: TripDayMapPoint[];
  polylinePositions?: [number, number][];
};

export default function TripDayLeafletMap({ points, polylinePositions }: TripDayLeafletMapProps) {
  const center = useMemo<[number, number]>(() => points[0]?.position ?? [0, 0], [points]);
  const fallbackPolylinePositions = useMemo(() => points.map((point) => point.position), [points]);
  const routePolyline = polylinePositions ?? fallbackPolylinePositions;
  const markerIcon = useMemo(
    () =>
      L.divIcon({
        className: "trip-day-marker",
        html: '<span style="display:block;width:14px;height:14px;border-radius:9999px;background:#f15a24;border:2px solid #ffffff;box-shadow:0 0 0 1px rgba(17,18,20,0.2);"></span>',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      }),
    [],
  );

  return (
    <MapContainerCompat center={center} zoom={12} style={{ height: 220, width: "100%" }} scrollWheelZoom={false}>
      <TileLayerCompat
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; OpenStreetMap contributors"
      />
      {points.map((point, index) => (
        <MarkerCompat key={point.id} position={point.position} icon={markerIcon} data-testid={`day-map-marker-${index}`} />
      ))}
      {routePolyline.length >= 2 && <PolylineCompat positions={routePolyline} data-testid="day-map-polyline" />}
      <EnsureMapSized />
      <FitToBounds points={points} />
    </MapContainerCompat>
  );
}
