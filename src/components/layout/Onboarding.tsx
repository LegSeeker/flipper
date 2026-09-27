import { useState } from 'react';
import { useApp } from '@/app/context';
import { COMMON_CURRENCIES, currencyForCountry, defaultMarketplaces, ebayForCountry } from '@/db/defaults';
import { updateSettings } from '@/db/repo';
import { Modal } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Logo } from './Logo';

const COUNTRIES = [
  'US',
  'GB',
  'IE',
  'CA',
  'AU',
  'NZ',
  'DE',
  'FR',
  'IT',
  'ES',
  'NL',
  'BE',
  'AT',
  'CH',
  'PL',
  'CZ',
  'SE',
  'NO',
  'DK',
  'FI',
  'EE',
  'LV',
  'LT',
  'PT',
  'GR',
  'RO',
  'HU',
  'BG',
  'HR',
  'SK',
  'SI',
];

function regionName(code: string) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** First-run: confirm country, currency and city (pre-filled from the browser locale). */
export function Onboarding() {
  const { settings } = useApp();
  const [country, setCountry] = useState(settings.country);
  const [currency, setCurrency] = useState(settings.currency);
  const [city, setCity] = useState(settings.city);

  if (settings.onboarded) return null;

  const finish = async () => {
    const ebay = ebayForCountry(country);
    await updateSettings({
      onboarded: true,
      country,
      currency,
      city: city.trim(),
      ebayMarketplaceId: ebay,
      marketplaces: [
        ...defaultMarketplaces(country, ebay),
        ...settings.marketplaces.filter((m) => !m.builtIn),
      ],
      weightUnit: country === 'US' ? 'lb' : 'kg',
    });
  };

  return (
    <Modal
      open
      onClose={finish}
      title="Welcome"
      size="sm"
      footer={
        <Button variant="primary" onClick={finish} className="w-full sm:w-auto">
          Get started
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Logo className="size-10" />
          <p className="text-sm text-muted">
            Let's set your region so prices, fees and marketplace links fit where you sell. You can change
            this any time in Settings.
          </p>
        </div>
        <Field label="Country">
          <Select
            value={country}
            onChange={(e) => {
              setCountry(e.target.value);
              setCurrency(currencyForCountry(e.target.value));
            }}
          >
            {[...new Set([country, ...COUNTRIES])].map((c) => (
              <option key={c} value={c}>
                {regionName(c)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Currency">
          <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {[...new Set([currency, ...COMMON_CURRENCIES])].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="City / area (optional)" hint="For local marketplace searches">
          <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Manchester" />
        </Field>
      </div>
    </Modal>
  );
}
