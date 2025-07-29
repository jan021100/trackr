// importCleanItems.cjs
const admin = require('firebase-admin');
const fs = require('fs');

const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const db = admin.firestore();
const uid = '6PmAietwhBSVvRWH2CC8ZjAA1Ar1';

const rawData = fs.readFileSync('./items.json');
const items = JSON.parse(rawData);

// Mapping Tabellen
const sportToMainCategory = {
  'Radsport': 'Cycling',
  'Laufen': 'Running',
  'Casual': 'Casual',
  'Sport': 'Other Sports',
  '': 'Other Sports'
};

const categoryToLowerCategory = {
  'T-Shirt': 'T-Shirts',
  'Socken': 'Socks',
  'Unterhemd': 'Base Layers',
  'Jacke': 'Jackets',
  'Kopfbedeckung': 'Headwear',
  'Hemd': 'Shirts',
  'Pullover': 'Sweaters',
  'Polo Shirt': 'Polo Shirts',
  'Shorts': 'Shorts',
  'Hose': 'Pants',
  'Anderes': 'Others',
  'SS Trikot': 'SS Jerseys',
  'Hoodie': 'Hoodies',
  'Handschuhe': 'Gloves',
  'Laufschuhe': 'Running Shoes',
  'Brille': 'Glasses',
  'Jeans': 'Jeans',
  'SS Shirt': 'SS Shirts',
  'Schuhe': 'Shoes',
  'LS Trikot': 'LS Jerseys',
  'Weste': 'Vests',
  'Jogginghose': 'Joggers',
  'Chino': 'Chinos',
  'Rucksack': 'Backpacks',
  'Sneaker': 'Sneakers',
  'Schlappen': 'Slides',
  'Beinlinge': 'Leg Warmers',
  'LS Shirt': 'LS Shirts',
  'Leggings': 'Leggings',
  'Tasche': 'Bags',
  '': 'Others'
};

async function importItems() {
  const batch = db.batch();
  const itemsRef = db.collection('users').doc(uid).collection('items');

  items.forEach((item, index) => {
    const rawSport = (item.Sport ?? '').trim();
    const rawCategory = (item.Kategorie ?? '').trim();

    const mainCategory = sportToMainCategory[rawSport] ?? 'Other Sports';
    const lowerCategory = categoryToLowerCategory[rawCategory] ?? 'Others';

    const docRef = itemsRef.doc(); // auto-ID
    batch.set(docRef, {
      product: item.Produkt ?? '',
      brand: item.Marke ?? '',
      worn: Number(item["Getragen "] ?? 0),
      lastWorn: item["Last worn"] ?? null,
      condition: item.Condition ?? '',
      rating: item.Bewertung ?? null,
      mainCategory,
      lowerCategory,
      imageUrl: item["Image URL"] ?? '',
      size: item.Size ?? '',
      status: item.Status ?? '',
      season: item.Season ?? '',
      temperature: item.Temperature ?? '',
      price: Number(item.Preis ?? 0),
      purchaseDate: item.Kaufdatum ?? null,
      index: item["#"] ?? index
    });
  });

  await batch.commit();
  console.log(`✅ Import abgeschlossen mit ${items.length} Items`);
}

importItems().catch(console.error);