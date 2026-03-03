import React, { useState, useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { cellToBoundary } from "h3-js";

const TIER_COLORS = {
  SOVEREIGN: "#10B981", TRUSTED: "#3B82F6", VERIFIED: "#8B5CF6",
  BASIC: "#F59E0B", SHADOW: "#6B7280",
};

function getTierColor(score) {
  if (score >= 90) return TIER_COLORS.SOVEREIGN;
  if (score >= 70) return TIER_COLORS.TRUSTED;
  if (score >= 40) return TIER_COLORS.VERIFIED;
  if (score >= 20) return TIER_COLORS.BASIC;
  return TIER_COLORS.SHADOW;
}

function h3ToGeoJSON(cellId, properties = {}) {
  try {
    const boundary = cellToBoundary(cellId);
    const coords = boundary.map(([lat, lng]) => [lng, lat]);
    coords.push(coords[0]);
    return {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [coords] },
      properties,
    };
  } catch (err) {
    console.warn("Invalid H3 cell:", cellId, err);
    return null;
  }
}

export default function TerritoryMap({ agents, selectedAgent, onSelect }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [hoveredAgent, setHoveredAgent] = useState(null);

  useEffect(() => {
    const token = process.env.REACT_APP_MAPBOX_TOKEN;
    if (!token || !containerRef.current) return;
    mapboxgl.accessToken = token;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [12.5, 42.0],
      zoom: 5.2,
      pitch: 30,
      bearing: -5,
      antialias: true,
      attributionControl: false,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      mapRef.current = map;
      setMapReady(true);
    });

    return () => { mapRef.current = null; map.remove(); };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !agents.length) return;

    // Clear previous layers
    const cleanId = (a) => a.id.slice(0, 8);
    agents.forEach((a) => {
      const fId = "af-" + cleanId(a);
      const lId = "al-" + cleanId(a);
      const sId = "as-" + cleanId(a);
      if (map.getLayer(fId)) map.removeLayer(fId);
      if (map.getLayer(lId)) map.removeLayer(lId);
      if (map.getSource(sId)) map.removeSource(sId);
    });
    if (map.getLayer("del-lines")) map.removeLayer("del-lines");
    if (map.getSource("del-src")) map.removeSource("del-src");
    if (map.getLayer("agent-labels")) map.removeLayer("agent-labels");
    if (map.getSource("labels-src")) map.removeSource("labels-src");

    // Add H3 hexagons per agent
    agents.forEach((agent) => {
      const color = getTierColor(agent.score);
      const isSel = selectedAgent && selectedAgent.id === agent.id;
      const sId = "as-" + cleanId(agent);
      const fId = "af-" + cleanId(agent);
      const lId = "al-" + cleanId(agent);

      const features = (agent.h3Cells || [])
        .map((cell) => h3ToGeoJSON(cell, {
          agentId: agent.id, name: agent.displayName,
          score: agent.score, tier: agent.tier,
          territory: (agent.territory || []).join(", "),
          breadcrumbs: agent.breadcrumbs,
        }))
        .filter(Boolean);

      if (features.length === 0) return;

      map.addSource(sId, {
        type: "geojson",
        data: { type: "FeatureCollection", features },
      });

      map.addLayer({
        id: fId, type: "fill", source: sId,
        paint: { "fill-color": color, "fill-opacity": isSel ? 0.45 : 0.2 },
      });

      map.addLayer({
        id: lId, type: "line", source: sId,
        paint: { "line-color": color, "line-width": isSel ? 3 : 1.5, "line-opacity": isSel ? 1 : 0.6 },
      });

      map.on("click", fId, () => { if (onSelect) onSelect(agent); });
      map.on("mouseenter", fId, () => {
        map.getCanvas().style.cursor = "pointer";
        setHoveredAgent(agent);
      });
      map.on("mouseleave", fId, () => {
        map.getCanvas().style.cursor = "";
        setHoveredAgent(null);
      });
    });

    // Delegation lines
    const delFeatures = agents
      .filter((a) => a.delegatedBy && a.delegatedBy.type === "agent")
      .map((a) => {
        const parent = agents.find((p) => p.id === a.delegatedBy.id);
        if (!parent) return null;
        return {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [parent.h3Center[1], parent.h3Center[0]],
              [a.h3Center[1], a.h3Center[0]],
            ],
          },
          properties: {},
        };
      })
      .filter(Boolean);

    if (delFeatures.length > 0) {
      map.addSource("del-src", {
        type: "geojson",
        data: { type: "FeatureCollection", features: delFeatures },
      });
      map.addLayer({
        id: "del-lines", type: "line", source: "del-src",
        paint: { "line-color": "#1E3A5F", "line-width": 2, "line-dasharray": [4, 3], "line-opacity": 0.6 },
      });
    }

    // Agent labels
    const labelFeatures = agents.map((a) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [a.h3Center[1], a.h3Center[0]] },
      properties: { name: a.displayName, territory: (a.territory || []).join(", ") },
    }));

    map.addSource("labels-src", {
      type: "geojson",
      data: { type: "FeatureCollection", features: labelFeatures },
    });

    map.addLayer({
      id: "agent-labels", type: "symbol", source: "labels-src",
      layout: {
        "text-field": ["concat", ["get", "name"], "\n", ["get", "territory"]],
        "text-size": 11,
        "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
        "text-anchor": "center",
        "text-allow-overlap": true,
      },
      paint: { "text-color": "#E2E8F0", "text-halo-color": "#0A0F1A", "text-halo-width": 2 },
    });
  }, [agents, selectedAgent, mapReady, onSelect]);

  const token = process.env.REACT_APP_MAPBOX_TOKEN;

  if (!token) {
    return (
      <div style={{ background: "#0D1117", border: "1px solid #1E293B", borderRadius: 8, padding: 24, textAlign: "center" }}>
        <div style={{ fontSize: 14, color: "#F59E0B", marginBottom: 8 }}>Territory Map requires Mapbox token</div>
        <div style={{ fontSize: 11, color: "#6B7280" }}>
          Set REACT_APP_MAPBOX_TOKEN in your environment to enable the interactive H3 hexagon map.
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: "#0D1117", border: "1px solid #1E293B", borderRadius: 8, overflow: "hidden", position: "relative" }}>
      <div style={{ padding: "10px 16px", borderBottom: "1px solid #1E293B", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#F1F5F9" }}>
          H3 Territory Map (Mapbox GL)
        </span>
        <div style={{ display: "flex", gap: 12 }}>
          {Object.entries(TIER_COLORS).map(([k, c]) => (
            <span key={k} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: "#6B7280" }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: c, display: "inline-block" }} />
              {k}
            </span>
          ))}
        </div>
      </div>
      <div ref={containerRef} style={{ width: "100%", height: 480 }} />
      {hoveredAgent && (
        <div style={{
          position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)",
          background: "#1E293BE0", border: "1px solid #374151", borderRadius: 6,
          padding: "8px 14px", fontSize: 11, color: "#E2E8F0", pointerEvents: "none",
          zIndex: 10, display: "flex", gap: 12, backdropFilter: "blur(8px)",
        }}>
          <span style={{ fontWeight: 700 }}>{hoveredAgent.displayName}</span>
          <span style={{ color: getTierColor(hoveredAgent.score) }}>{hoveredAgent.tier}</span>
          <span>Score: {hoveredAgent.score}</span>
          <span>{hoveredAgent.breadcrumbs} breadcrumbs</span>
        </div>
      )}
    </div>
  );
}
