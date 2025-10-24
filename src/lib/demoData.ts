// src/lib/demoData.ts
export type DemoProp = {
  slug: string;
  title: string;
  price: number;
  photos: string[];
  features: string[];
};

function pick<T>(arr: T[]) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const CITIES = ["Dublin", "Cork", "Galway", "Limerick", "Waterford"];
const FEATURES = ["Balcony", "Sea view", "Parking", "Lift", "Gym", "Garden", "Ensuite"];

export function buildDemoProperties(count = 25): DemoProp[] {
  const out: DemoProp[] = [];
  for (let i = 0; i < count; i++) {
    const id = i + 1;
    const city = pick(CITIES);
    const price = 900 + Math.floor(Math.random() * 3500);
    const slug = `demo-${city.toLowerCase()}-${id}`;
    const title = `${city} Apartment #${id}`;

    const numPhotos = 3 + Math.floor(Math.random() * 4); // 3–6
    const photos = Array.from({ length: numPhotos }, (_, idx) =>
      `https://picsum.photos/seed/${slug}-${idx}/800/600`
    );

    const shuffled = [...FEATURES].sort(() => Math.random() - 0.5);
    const features = shuffled.slice(0, 2 + Math.floor(Math.random() * 3)); // 2–4

    out.push({
      slug,
      title,
      price,
      photos: photos.length ? photos : [""],        // never null
      features: features.length ? features : [""]    // never null
    });
  }
  return out;
}
