import { describe, expect, it } from "vitest";
import { haversineMeters } from "@/lib/geo/distance";

describe("haversineMeters", () => {
  it("is zero for identical points", () => {
    expect(haversineMeters({ lat: 52.5163, lng: 13.3777 }, { lat: 52.5163, lng: 13.3777 })).toBe(0);
  });

  // The published haversine reference pair (Movable Type Scripts): Land's End 50°03′59″N 005°42′53″W to
  // John o' Groats 58°38′38″N 003°04′12″W is 968.9 km on a 6371 km sphere. The story suggested
  // Brandenburger Tor <-> Alexanderplatz "≈ 2.2 km"; those two points are ~2.47 km apart, so a guessed
  // figure is not used as the oracle here.
  it("matches the published reference pair", () => {
    const landsEnd = { lat: 50 + 3 / 60 + 59 / 3600, lng: -(5 + 42 / 60 + 53 / 3600) };
    const johnOGroats = { lat: 58 + 38 / 60 + 38 / 3600, lng: -(3 + 4 / 60 + 12 / 3600) };
    expect(haversineMeters(landsEnd, johnOGroats)).toBeGreaterThan(968_850);
    expect(haversineMeters(landsEnd, johnOGroats)).toBeLessThan(968_950);
  });

  it("is symmetric", () => {
    const a = { lat: 48.8584, lng: 2.2945 };
    const b = { lat: 51.5007, lng: -0.1246 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });

  // Two points ~0.2 degrees apart across the antimeridian near Fiji: ~22 km, not ~40000 km.
  it("measures across the antimeridian", () => {
    const meters = haversineMeters({ lat: -17, lng: 179.9 }, { lat: -17, lng: -179.9 });
    expect(meters).toBeGreaterThan(21000);
    expect(meters).toBeLessThan(22000);
  });

  // One degree of latitude is ~111.2 km on a 6371 km sphere.
  it("measures one degree of latitude", () => {
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111195, -1);
  });
});
