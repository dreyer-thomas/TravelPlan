"use client";

import { MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";
import { useEffect, useMemo } from "react";
import type { ReactElement } from "react";
// @ts-expect-error Leaflet types are not resolved in this build environment.
import L from "leaflet";
import type { TripOverviewMapPoint } from "@/components/features/trips/TripOverviewMapData";

const MapContainerCompat = MapContainer as unknown as (props: Record<string, unknown>) => ReactElement;
const MarkerCompat = Marker as unknown as (props: Record<string, unknown>) => ReactElement;
const PolylineCompat = Polyline as unknown as (props: Record<string, unknown>) => ReactElement;
const TileLayerCompat = TileLayer as unknown as (props: Record<string, unknown>) => ReactElement;

const FitToBounds = ({ points }: { points: TripOverviewMapPoint[] }) => {
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

type TripOverviewLeafletMapProps = {
  points: TripOverviewMapPoint[];
  polylinePositions?: [number, number][];
  height?: number | string;
  onMarkerClick?: (point: TripOverviewMapPoint) => void;
};

const DEFAULT_TRIP_MAP_HEIGHT = 280;

export default function TripOverviewLeafletMap({
  points,
  polylinePositions,
  height = DEFAULT_TRIP_MAP_HEIGHT,
  onMarkerClick,
}: TripOverviewLeafletMapProps) {
  const center = useMemo<[number, number]>(() => points[0]?.position ?? [0, 0], [points]);
  const routePolyline = useMemo(() => polylinePositions ?? points.map((point) => point.position), [points, polylinePositions]);
  const markerIcon = useMemo(
    () =>
      L.divIcon({
        className: "trip-overview-marker",
        html: '<span style="display:block;width:14px;height:14px;border-radius:9999px;background:#0f6b6d;border:2px solid #ffffff;box-shadow:0 0 0 1px rgba(17,18,20,0.25);"></span>',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      }),
    [],
  );

  return (
    <MapContainerCompat center={center} zoom={5} style={{ height, width: "100%" }} scrollWheelZoom={false}>
      <TileLayerCompat
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; OpenStreetMap contributors"
      />
      {points.map((point, index) => (
        <MarkerCompat
          key={point.id}
          position={point.position}
          icon={markerIcon}
          data-testid={`overview-map-marker-${index}`}
          eventHandlers={onMarkerClick ? { click: () => onMarkerClick(point) } : undefined}
        />
      ))}
      {routePolyline.length >= 2 ? <PolylineCompat positions={routePolyline} data-testid="overview-map-polyline" /> : null}
      <EnsureMapSized />
      <FitToBounds points={points} />
    </MapContainerCompat>
  );
}
