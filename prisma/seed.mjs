import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const demos = [
    {
      title: "Alder, Dunloe Upper, Beaufort, Killarney, Co. Kerry (V93 NN84)",
      slug: "alder-dunloe-upper-beaufort-killarney-co-kerry-v93nn84",
      address: "Alder, Dunloe Upper, Beaufort, Killarney, Co. Kerry",
      eircode: "V93NN84",
      status: "FOR_SALE",
      price: 495000,
      beds: 4,
      baths: 3,
      ber: "B2",
      latitude: 52.0567,
      longitude: -9.6031,
      photos: [
        "https://res.cloudinary.com/havn/image/upload/v1720000001/properties/demo1-1.jpg",
        "https://res.cloudinary.com/havn/image/upload/v1720000001/properties/demo1-2.jpg"
      ],
      floorplans: [],
      features: ["South-facing garden", "Underfloor heating", "EV charger", "Fibre broadband"],
      overview: "Bright 4-bed near the Gap of Dunloe with mountain views.",
      description: "Spacious home in Beaufort, minutes to Killarney."
    },
    {
      title: "13 The Grange, Raheen, Co. Limerick",
      slug: "13-the-grange-raheen-limerick",
      address: "13 The Grange, Raheen, Limerick",
      eircode: "V94XXXX",
      status: "FOR_SALE",
      price: 375000,
      beds: 3,
      baths: 3,
      ber: "B3",
      latitude: 52.6202,
      longitude: -8.6590,
      photos: [
        "https://res.cloudinary.com/havn/image/upload/v1720000001/properties/demo2-1.jpg",
        "https://res.cloudinary.com/havn/image/upload/v1720000001/properties/demo2-2.jpg"
      ],
      floorplans: [],
      features: ["Cul-de-sac", "Attic storage", "West garden"],
      overview: "Turn-key 3-bed semi-D in Raheen.",
      description: "Well-kept family home close to UHL and Crescent SC."
    },
    {
      title: "City Quay Apartment, Dublin 2",
      slug: "city-quay-apartment-dublin-2",
      address: "City Quay, Dublin 2",
      eircode: "D02XXXX",
      status: "FOR_SALE",
      price: 495000,
      beds: 2,
      baths: 2,
      ber: "B1",
      latitude: 53.3462,
      longitude: -6.2529,
      photos: [
        "https://res.cloudinary.com/havn/image/upload/v1720000001/properties/demo3-1.jpg",
        "https://res.cloudinary.com/havn/image/upload/v1720000001/properties/demo3-2.jpg"
      ],
      floorplans: [],
      features: ["Balcony", "Concierge", "Lift access"],
      overview: "River-view 2-bed with parking.",
      description: "Light-filled corner unit overlooking the Liffey."
    }
  ];

  for (const d of demos) {
    await prisma.property.upsert({ where: { slug: d.slug }, update: d, create: d });
  }
  console.log("Seeded demo properties.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
