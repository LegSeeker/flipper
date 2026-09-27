import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { addExpense, updateExpense } from '@/db/repo';
import { EXPENSE_CATEGORIES, type Expense, type ExpenseCategory, type OwnerType } from '@/db/schema';
import { Modal } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input, MoneyField, Select, Textarea } from '@/components/ui/field';
import { today } from '@/lib/dates';
import { round2 } from '@/lib/money';
import { titleCase } from '@/lib/utils';

export function ExpenseDialog({
  open,
  onClose,
  ownerType,
  ownerId,
  expense,
}: {
  open: boolean;
  onClose: () => void;
  ownerType?: OwnerType;
  ownerId?: string;
  expense?: Expense;
}) {
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [category, setCategory] = useState<ExpenseCategory>('other');
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!open) return;
    setLabel(expense?.label ?? '');
    setAmount(expense?.amount ?? null);
    setCategory(expense?.category ?? (ownerType ? 'parts' : 'supplies'));
    setDate(expense?.date ?? today());
    setNotes(expense?.notes ?? '');
  }, [open, expense, ownerType]);

  const save = async () => {
    if (!label.trim()) return toast.error('Describe the expense');
    if (amount === null) return toast.error('Enter an amount');
    const data = { label: label.trim(), amount: round2(amount), category, date, notes };
    if (expense) await updateExpense(expense.id, data);
    else await addExpense({ ...data, ownerType: ownerType ?? 'general', ownerId: ownerId ?? null });
    toast.success(expense ? 'Expense updated' : 'Expense added');
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={expense ? 'Edit expense' : ownerType ? 'Add cost' : 'Add business expense'}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Description">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={
              ownerType
                ? 'e.g. Cleaning supplies, test cable'
                : 'e.g. Bubble wrap, fuel, eBay shop subscription'
            }
            autoFocus
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <MoneyField label="Amount" value={amount} onChange={setAmount} />
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Category">
          <Select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)}>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {titleCase(c)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {!ownerType && !expense && (
          <p className="text-xs text-subtle">
            Business expenses (overheads) reduce net profit in reports. Costs for a specific item or project
            should be added on that item/project.
          </p>
        )}
      </div>
    </Modal>
  );
}
