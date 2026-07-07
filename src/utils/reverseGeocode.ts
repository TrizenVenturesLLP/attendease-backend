type NominatimAddress = {
  road?: string;
  pedestrian?: string;
  footway?: string;
  residential?: string;
  neighbourhood?: string;
  suburb?: string;
  quarter?: string;
  city_district?: string;
  town?: string;
  village?: string;
  city?: string;
  county?: string;
  state?: string;
};

type NominatimResponse = {
  display_name?: string;
  address?: NominatimAddress;
};

function formatAreaName(data: NominatimResponse): string | undefined {
  const address = data.address;
  if (!address) {
    const short = data.display_name?.split(',').map((s) => s.trim()).slice(0, 2).join(', ');
    return short || undefined;
  }

  const street =
    address.road ||
    address.pedestrian ||
    address.footway ||
    address.residential;

  const locality =
    address.neighbourhood ||
    address.suburb ||
    address.quarter ||
    address.city_district ||
    address.village ||
    address.town ||
    address.city;

  const region = address.city || address.town || address.county || address.state;
  const parts = [...new Set([street, locality, region].filter(Boolean))] as string[];
  if (parts.length) return parts.slice(0, 3).join(', ');

  const fallback = data.display_name?.split(',').map((s) => s.trim()).slice(0, 2).join(', ');
  return fallback || undefined;
}

/** Resolve a human-readable area name from GPS coordinates (OpenStreetMap Nominatim). */
export async function reverseGeocodeAreaName(
  latitude: number,
  longitude: number
): Promise<string | undefined> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return undefined;
  }

  try {
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.searchParams.set('lat', String(latitude));
    url.searchParams.set('lon', String(longitude));
    url.searchParams.set('format', 'json');
    url.searchParams.set('zoom', '16');
    url.searchParams.set('addressdetails', '1');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'TrizenHR-Attendance/1.0',
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return undefined;
    const data = (await response.json()) as NominatimResponse;
    return formatAreaName(data);
  } catch {
    return undefined;
  }
}
