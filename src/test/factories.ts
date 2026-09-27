import { emptyItem, emptyProject } from '@/db/defaults';
import type { Expense, Item, Project, Requirement, Sale } from '@/db/schema';

let n = 0;
const id = (p: string) => `${p}-${++n}`;

export function makeItem(patch: Partial<Item> = {}): Item {
  return {
    ...emptyItem(),
    id: id('item'),
    code: `FL-${String(n).padStart(5, '0')}`,
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  };
}

export function makeProject(patch: Partial<Project> = {}): Project {
  return { ...emptyProject(), id: id('proj'), code: `PR-${n}`, createdAt: 0, updatedAt: 0, ...patch };
}

export function makeSale(itemId: string, patch: Partial<Sale> = {}): Sale {
  return {
    id: id('sale'),
    itemId,
    quantity: 1,
    price: 0,
    shippingCharged: 0,
    shippingCost: 0,
    fees: 0,
    platform: 'ebay',
    date: '2026-01-15',
    buyer: '',
    notes: '',
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  };
}

export function makeExpense(patch: Partial<Expense> = {}): Expense {
  return {
    id: id('exp'),
    ownerType: 'general',
    ownerId: null,
    label: 'x',
    category: 'other',
    amount: 0,
    date: '2026-01-10',
    notes: '',
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  };
}

export function makeRequirement(
  patch: Partial<Requirement> & Pick<Requirement, 'ownerType' | 'ownerId'>,
): Requirement {
  return {
    id: id('req'),
    name: 'part',
    quantity: 1,
    status: 'needed',
    estimatedCost: null,
    actualCost: null,
    inventoryItemId: null,
    supplier: '',
    url: '',
    priority: 'normal',
    notes: '',
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  };
}
