/**
 * PropertyMap — Leaflet map with smart Lagos geocoding + interactive pin-drop.
 *
 * Two modes:
 *  • Viewer (default)  — shows a pin at the property address for tenants.
 *  • Editor (pinDrop)  — landlord taps/clicks the map to place a pin; returns { lat, lng }.
 *
 * Geocoding strategy (viewer mode):
 *  1. Full address + "Lagos Nigeria" with Lagos viewbox bias
 *  2. Strip to last 2 comma-parts + "Lagos Nigeria"
 *  3. First comma-part only + "Lagos Nigeria"
 *  On any success, show the pin. On total failure, show map centred on Lagos +
 *  a message with a Google Maps deep-link.
 */

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, MapPin, Loader2, AlertCircle, Navigation, Check } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix default marker icons broken by bundlers
const iconProto = L.Icon.Default.prototype as unknown as Record<string, unknown>;
delete iconProto._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const greenIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// Lagos bounding box for viewbox bias
const LAGOS_VIEWBOX = '2.6,6.2,4.0,7.0'; // minLng, minLat, maxLng, maxLat
const LAGOS_CENTER: [number, number] = [6.5244, 3.3792];

export interface GeoResult {
  lat: number;
  lng: number;
  displayName: string;
}

/** Nominatim search with a single query string */
async function nominatimSearch(q: string): Promise<GeoResult | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=ng&viewbox=${LAGOS_VIEWBOX}&bounded=0`;
    const res = await fetch(url, {
      headers: { 'Accept-Language': 'en', 'User-Agent': 'HandovaApp/1.0 (+https://github.com/Gbangbolaoluwagbemiga/handova)' },
    });
    if (!res.ok) return null;
    const data = await res.json() as Array<{ lat: string; lon: string; display_name: string }>;
    if (!data.length) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), displayName: data[0].display_name };
  } catch {
    return null;
  }
}

/**
 * Progressive geocode: tries increasingly simple queries until one succeeds.
 * Also tries "area, Lagos, Nigeria" fallback.
 */
export async function geocodeAddress(address: string): Promise<GeoResult | null> {
  const base = address.trim();
  if (!base) return null;

  // Strategy 1: full address + Lagos Nigeria
  const r1 = await nominatimSearch(`${base}, Lagos, Nigeria`);
  if (r1) return r1;

  // Strategy 2: drop any house/flat number prefix — take everything after first comma
  const parts = base.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const simplified = parts.slice(1).join(', ') + ', Lagos, Nigeria';
    const r2 = await nominatimSearch(simplified);
    if (r2) return r2;
  }

  // Strategy 3: last 2 parts only (area + city)
  if (parts.length >= 3) {
    const r3 = await nominatimSearch(parts.slice(-2).join(', ') + ', Lagos, Nigeria');
    if (r3) return r3;
  }

  // Strategy 4: last part only (area name)
  const lastPart = parts[parts.length - 1];
  if (lastPart && lastPart.toLowerCase() !== 'lagos' && lastPart.toLowerCase() !== 'nigeria') {
    const r4 = await nominatimSearch(lastPart + ', Lagos, Nigeria');
    if (r4) return r4;
  }

  return null;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function FlyTo({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => { map.setView([lat, lng], 16, { animate: true }); }, [map, lat, lng]);
  return null;
}

interface PinDropHandlerProps {
  onPin: (lat: number, lng: number) => void;
}
function PinDropHandler({ onPin }: PinDropHandlerProps) {
  useMapEvents({
    click(e) { onPin(e.latlng.lat, e.latlng.lng); },
  });
  return null;
}

// ── Viewer mode ──────────────────────────────────────────────────────────────

export interface PropertyMapProps {
  address: string;
  /** Optional pre-resolved coordinates (skip geocoding) */
  lat?: number;
  lng?: number;
  title?: string;
  onClose: () => void;
}

export default function PropertyMap({ address, lat: initLat, lng: initLng, title, onClose }: PropertyMapProps) {
  const [geo, setGeo] = useState<GeoResult | null>(
    initLat !== undefined && initLng !== undefined
      ? { lat: initLat, lng: initLng, displayName: address }
      : null
  );
  const [loading, setLoading] = useState(initLat === undefined);
  const [softFail, setSoftFail] = useState(false); // geocode failed but show map anyway

  useEffect(() => {
    if (initLat !== undefined && initLng !== undefined) return; // already have coords
    geocodeAddress(address).then(result => {
      if (result) { setGeo(result); }
      else { setSoftFail(true); }
      setLoading(false);
    }).catch(() => { setSoftFail(true); setLoading(false); });
  }, [address, initLat, initLng]);

  const center: [number, number] = geo ? [geo.lat, geo.lng] : LAGOS_CENTER;
  const zoom = geo ? 16 : 12;

  function openGoogleMaps() {
    if (geo) {
      window.open(`https://www.google.com/maps?q=${geo.lat},${geo.lng}`, '_blank');
    } else {
      window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address + ', Lagos')}`, '_blank');
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        key="map-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
        onClick={onClose}
      >
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl overflow-hidden"
          style={{ background: 'var(--glass-card)', border: '1px solid var(--glass-border)' }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'var(--accent-soft)' }}>
                <MapPin className="w-4 h-4" style={{ color: 'var(--accent)' }} />
              </div>
              <div>
                <p className="font-bold text-sm" style={{ color: 'var(--ink)' }}>{title ?? 'Property Location'}</p>
                <p className="text-xs truncate max-w-[220px]" style={{ color: 'var(--muted)' }}>{address}</p>
              </div>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'var(--surface-strong)' }}>
              <X className="w-4 h-4" style={{ color: 'var(--ink)' }} />
            </button>
          </div>

          {/* Soft-fail banner */}
          {softFail && (
            <div className="mx-5 mb-2 px-4 py-3 rounded-2xl flex gap-2 items-start text-xs"
              style={{ background: 'rgba(245,158,11,0.12)', color: '#b45309' }}>
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Exact address not found on OpenStreetMap. Map is centred on Lagos — use <strong>Open in Google Maps</strong> for precise navigation.</span>
            </div>
          )}

          {/* Map */}
          <div className="relative" style={{ height: 320 }}>
            {loading ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3"
                style={{ background: 'var(--surface-muted)' }}>
                <Loader2 className="w-7 h-7 animate-spin" style={{ color: 'var(--accent)' }} />
                <p className="text-sm" style={{ color: 'var(--muted)' }}>Locating property…</p>
              </div>
            ) : (
              <MapContainer center={center} zoom={zoom} style={{ height: '100%', width: '100%' }} zoomControl={false} scrollWheelZoom={false}>
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {geo && (
                  <>
                    <Marker position={[geo.lat, geo.lng]} icon={greenIcon}>
                      <Popup><strong>{title ?? address}</strong></Popup>
                    </Marker>
                    <FlyTo lat={geo.lat} lng={geo.lng} />
                  </>
                )}
              </MapContainer>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 pb-5 pt-4 flex gap-3">
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={openGoogleMaps}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold text-sm text-white"
              style={{ background: 'var(--accent)', boxShadow: 'none' }}
            >
              <Navigation className="w-4 h-4" /> Open in Google Maps
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={onClose}
              className="px-5 py-3 rounded-2xl font-semibold text-sm"
              style={{ background: 'var(--surface-strong)', color: 'var(--ink)' }}
            >
              Close
            </motion.button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Pin-drop editor (used in LandlordDashboard) ──────────────────────────────

export interface PinDropResult {
  lat: number;
  lng: number;
}

export interface PinDropMapProps {
  onConfirm: (result: PinDropResult) => void;
  onClose: () => void;
  initialAddress?: string;
}

export function PinDropMap({ onConfirm, onClose, initialAddress }: PinDropMapProps) {
  const [pin, setPin] = useState<[number, number] | null>(null);
  const [searching, setSearching] = useState(false);

  // Auto-geocode the initial address so the map starts centred near it
  useEffect(() => {
    if (!initialAddress) return;
    setSearching(true);
    geocodeAddress(initialAddress).then(result => {
      if (result) setPin([result.lat, result.lng]);
      setSearching(false);
    }).catch(() => setSearching(false));
  }, [initialAddress]);

  const handlePin = useCallback((lat: number, lng: number) => {
    setPin([lat, lng]);
  }, []);

  return (
    <AnimatePresence>
      <motion.div
        key="pin-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
        onClick={onClose}
      >
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl overflow-hidden"
          style={{ background: 'var(--glass-card)', border: '1px solid var(--glass-border)' }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-2">
            <div>
              <p className="font-bold text-sm" style={{ color: 'var(--ink)' }}>Pin Your Property</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>Tap anywhere on the map to place a pin</p>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'var(--surface-strong)' }}>
              <X className="w-4 h-4" style={{ color: 'var(--ink)' }} />
            </button>
          </div>

          {/* Hint banner */}
          <div className="mx-5 mb-2 px-4 py-2.5 rounded-2xl text-xs flex items-center gap-2"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
            <MapPin className="w-3.5 h-3.5 shrink-0" />
            {pin ? 'Pin placed! Move it by tapping again, then tap Confirm.' : 'Tap on the map where your property is located.'}
          </div>

          {/* Map */}
          <div style={{ height: 340 }}>
            {searching ? (
              <div className="h-full flex items-center justify-center" style={{ background: 'var(--surface-muted)' }}>
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--accent)' }} />
              </div>
            ) : (
              <MapContainer
                center={pin ?? LAGOS_CENTER}
                zoom={pin ? 16 : 12}
                style={{ height: '100%', width: '100%' }}
                scrollWheelZoom
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <PinDropHandler onPin={handlePin} />
                {pin && (
                  <>
                    <Marker position={pin} icon={greenIcon}>
                      <Popup>Your property</Popup>
                    </Marker>
                    <FlyTo lat={pin[0]} lng={pin[1]} />
                  </>
                )}
              </MapContainer>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 pb-5 pt-4 flex gap-3">
            <motion.button
              whileTap={{ scale: 0.96 }}
              disabled={!pin}
              onClick={() => { if (pin) onConfirm({ lat: pin[0], lng: pin[1] }); }}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold text-sm text-white transition-all"
              style={{
                background: pin
                  ? 'var(--accent)'
                  : 'var(--subtle)',
                boxShadow: pin ? 'none' : 'none',
              }}
            >
              <Check className="w-4 h-4" /> Confirm Location
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={onClose}
              className="px-5 py-3 rounded-2xl font-semibold text-sm"
              style={{ background: 'var(--surface-strong)', color: 'var(--ink)' }}
            >
              Cancel
            </motion.button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
