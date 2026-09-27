/** Sample data so new users can explore every feature. Safe to delete afterwards. */
import { addExpense, addRequirement, addSale, createItem, createProject, emptyRequirement } from './repo';
import { toISODate } from '@/lib/dates';

const daysAgo = (n: number) => toISODate(new Date(Date.now() - n * 86_400_000));

export async function loadDemoData(): Promise<void> {
  const tags = ['demo'];

  // Simple flips
  const headphones = await createItem({
    name: 'Sony WH-1000XM4 headphones',
    brand: 'Sony',
    model: 'WH-1000XM4',
    category: 'Audio',
    condition: 'good',
    purchasePrice: 85,
    purchaseDate: daysAgo(70),
    purchaseSource: 'Car boot sale',
    listPrice: 160,
    estimatedValue: 150,
    status: 'listed',
    listedAt: daysAgo(60),
    listingPlatform: 'eBay',
    storageLocation: 'Shelf A1',
    tags,
  });
  await addSale({
    itemId: headphones.id,
    quantity: 1,
    price: 149,
    shippingCharged: 5.5,
    shippingCost: 4.2,
    fees: 20.5,
    platform: 'ebay',
    date: daysAgo(40),
    buyer: '',
    notes: '',
  });

  const switchConsole = await createItem({
    name: 'Nintendo Switch OLED — joy-con drift',
    brand: 'Nintendo',
    model: 'HEG-001',
    category: 'Gaming',
    condition: 'fair',
    purchasePrice: 140,
    purchaseDate: daysAgo(20),
    purchaseSource: 'Facebook Marketplace',
    status: 'in_repair',
    estimatedValue: 230,
    storageLocation: 'Workbench',
    tags,
  });
  await addRequirement({
    ...emptyRequirement('item', switchConsole.id),
    name: 'Joy-con analog stick (pair)',
    quantity: 2,
    estimatedCost: 9,
    status: 'ordered',
    actualCost: 8.4,
    supplier: 'AliExpress',
  });
  await addRequirement({
    ...emptyRequirement('item', switchConsole.id),
    name: 'Y00 tri-wing screwdriver',
    estimatedCost: 5,
    status: 'needed',
  });

  const lot = await createItem({
    name: 'Lego minifigures (bulk)',
    category: 'Toys',
    condition: 'good',
    quantity: 20,
    purchasePrice: 30,
    purchaseDate: daysAgo(100),
    listPrice: 4,
    status: 'listed',
    listedAt: daysAgo(90),
    tags,
  });
  await addSale({
    itemId: lot.id,
    quantity: 12,
    price: 54,
    shippingCharged: 0,
    shippingCost: 6,
    fees: 0,
    platform: 'vinted',
    date: daysAgo(25),
    buyer: '',
    notes: 'Sold as a lot',
  });

  // Part-out project
  const car = await createProject({
    name: '2011 BMW 320d E90 — breaking',
    type: 'part_out',
    description: 'N47 engine, 180k miles, M-Sport, rear-end damage. Engine runs.',
    purchasePrice: 900,
    purchaseCosts: 120,
    purchaseDate: daysAgo(45),
    purchaseSource: 'Copart',
    tags,
  });
  const parts: [string, number, string, number | null][] = [
    ['Headlight left (xenon)', 250, 'Vehicle parts', 245],
    ['Headlight right (xenon)', 250, 'Vehicle parts', null],
    ['M-Sport 18" alloy wheels (set of 4)', 600, 'Vehicle parts', 590],
    ['N47 engine ECU', 150, 'Vehicle parts', null],
    ['iDrive screen', 120, 'Vehicle parts', 115],
    ['M-Sport steering wheel', 140, 'Vehicle parts', null],
    ['Rear seats (leather)', 200, 'Vehicle parts', null],
    ['Door mirrors (pair)', 90, 'Vehicle parts', null],
  ];
  for (const [name, value, category, sold] of parts) {
    const it = await createItem({
      name,
      category,
      estimatedValue: value,
      listPrice: value,
      projectId: car.id,
      status: 'listed',
      listedAt: daysAgo(35),
      purchaseDate: daysAgo(45),
      tags,
    });
    if (sold)
      await addSale({
        itemId: it.id,
        quantity: 1,
        price: sold,
        shippingCharged: 0,
        shippingCost: sold > 100 ? 25 : 8,
        fees: Math.round(sold * 0.13 * 100) / 100,
        platform: 'ebay',
        date: daysAgo(Math.round(5 + Math.random() * 25)),
        buyer: '',
        notes: '',
      });
  }
  await addExpense({
    ownerType: 'project',
    ownerId: car.id,
    label: 'Recovery truck',
    category: 'travel',
    amount: 80,
    date: daysAgo(44),
    notes: '',
  });

  // Repair project
  const laptop = await createProject({
    name: 'MacBook Pro 2019 — liquid damage',
    type: 'repair',
    description: 'A1990, no power after coffee spill. Board clean + likely backlight fuse.',
    purchasePrice: 220,
    purchaseDate: daysAgo(12),
    tags,
  });
  await createItem({
    name: 'MacBook Pro 15" 2019 (A1990)',
    category: 'Computers',
    brand: 'Apple',
    model: 'A1990',
    projectId: laptop.id,
    status: 'in_repair',
    estimatedValue: 650,
    condition: 'poor',
    purchaseDate: daysAgo(12),
    tags,
  });
  await addRequirement({
    ...emptyRequirement('project', laptop.id),
    name: 'Isopropyl alcohol 99%',
    estimatedCost: 12,
    status: 'in_stock',
    actualCost: 12,
  });
  await addRequirement({
    ...emptyRequirement('project', laptop.id),
    name: 'Backlight fuse F8080',
    quantity: 2,
    estimatedCost: 6,
    status: 'needed',
    priority: 'high',
  });
  await addRequirement({
    ...emptyRequirement('project', laptop.id),
    name: 'Replacement keyboard (UK)',
    estimatedCost: 45,
    status: 'needed',
  });

  // Sourcing wishlist + overheads
  await createItem({
    name: 'Dyson V11 (for parts)',
    category: 'Home & Garden',
    status: 'sourcing',
    estimatedValue: 120,
    notes: 'Look for ones with dead batteries',
    tags,
  });
  await addExpense({
    ownerType: 'general',
    ownerId: null,
    label: 'Bubble wrap + boxes',
    category: 'supplies',
    amount: 34.99,
    date: daysAgo(30),
    notes: '',
  });
  await addExpense({
    ownerType: 'general',
    ownerId: null,
    label: 'eBay shop subscription',
    category: 'subscription',
    amount: 25,
    date: daysAgo(15),
    notes: '',
  });
}
